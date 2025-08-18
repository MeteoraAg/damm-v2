use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeHandler, FeeRateLimiter},
    constants::fee::{FEE_DENOMINATOR, MAX_FEE_NUMERATOR_V1, MIN_FEE_NUMERATOR},
    params::{
        fee_parameters::{to_bps, to_numerator, BaseFeeParameters, PoolFeeParameters},
        swap::TradeDirection,
    },
    state::CollectFeeMode,
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
};

#[test]
fn test_validate_rate_limiter() {
    // validate collect fee mode
    {
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 1_000_000_000, // 1SOL
            max_limiter_duration: 60,        // 60 seconds
            max_fee_bps: 5000,               // 50 %
            fee_increment_bps: 10,           // 10 bps
        };
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(0).unwrap(), ActivationType::Slot)
            .is_err());
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(1).unwrap(), ActivationType::Slot)
            .is_ok());
    }

    // validate zero rate limiter
    {
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 1,     // 1SOL
            max_limiter_duration: 0, // 60 seconds
            max_fee_bps: 5000,       // 50 %
            fee_increment_bps: 0,    // 10 bps
        };
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(0).unwrap(), ActivationType::Slot)
            .is_err());
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 0,     // 1SOL
            max_limiter_duration: 1, // 60 seconds
            max_fee_bps: 5000,       // 50 %
            fee_increment_bps: 0,    // 10 bps
        };
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(0).unwrap(), ActivationType::Slot)
            .is_err());
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 0,     // 1SOL
            max_limiter_duration: 0, // 60 seconds
            max_fee_bps: 5000,       // 50 %
            fee_increment_bps: 1,    // 10 bps
        };
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(0).unwrap(), ActivationType::Slot)
            .is_err());
    }

    // validate cliff fee numerator
    {
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: MIN_FEE_NUMERATOR - 1,
            reference_amount: 1_000_000_000, // 1SOL
            max_limiter_duration: 60,        // 60 seconds
            max_fee_bps: 5000,               // 50 %
            fee_increment_bps: 10,           // 10 bps
        };
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(0).unwrap(), ActivationType::Slot)
            .is_err());
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: MAX_FEE_NUMERATOR_V1 + 1,
            reference_amount: 1_000_000_000, // 1SOL
            max_limiter_duration: 60,        // 60 seconds
            max_fee_bps: 5000,               // 50 %
            fee_increment_bps: 10,           // 10 bps
        };
        assert!(rate_limiter
            .validate(CollectFeeMode::try_from(0).unwrap(), ActivationType::Slot)
            .is_err());
    }
}

#[test]
fn test_rate_limiter_from_pool_fee_params() {
    let max_limiter_duration: u32 = 60u32;
    let max_fee_bps: u32 = 5000u32;
    let mut second_factor = [0u8; 8];
    second_factor[0..4].copy_from_slice(&max_limiter_duration.to_le_bytes());
    second_factor[4..8].copy_from_slice(&max_fee_bps.to_le_bytes());

    let base_fee = BaseFeeParameters {
        cliff_fee_numerator: 10_0000,
        first_factor: 10, // fee increasement bps
        second_factor,
        third_factor: 1_000_000_000, // reference_amount 1SOL
        base_fee_mode: 2,
    };

    let pool_fees = PoolFeeParameters {
        base_fee,
        dynamic_fee: None,
        ..Default::default()
    };

    let base_fee_struct = pool_fees.to_pool_fees_struct().base_fee;
    let rate_limiter = base_fee_struct.get_fee_rate_limiter().unwrap();

    assert_eq!(rate_limiter.max_fee_bps, max_fee_bps);
    assert_eq!(rate_limiter.max_limiter_duration, max_limiter_duration);
}
// that test show that more amount, then more fee numerator
#[test]
fn test_rate_limiter_behavior() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();

    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        max_fee_bps: 5000,        // 50 %
        fee_increment_bps,        // 10 bps
    };
    assert!(rate_limiter
        .validate(CollectFeeMode::try_from(1).unwrap(), ActivationType::Slot)
        .is_ok());

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, base_fee_bps);
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 3 / 2)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 133);

        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 2)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 150); // 1.5%, (1+1+1) / 2
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 3)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 200); // 2%, (1+1+1+1) / 2
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 4)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 250); // 2.5% (1+1+1+1+1) / 2
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(u64::MAX)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();

        assert_eq!(fee_bps, u64::from(rate_limiter.max_fee_bps)); // fee_bps cap equal max_fee_bps
    }
}

fn calculate_output_amount(rate_limiter: &FeeRateLimiter, input_amount: u64) -> u64 {
    let trade_fee_numerator = rate_limiter
        .get_base_fee_numerator_from_included_fee_amount(0, 0, TradeDirection::BtoA, input_amount)
        .unwrap();
    let trading_fee: u64 = safe_mul_div_cast_u64(
        input_amount,
        trade_fee_numerator,
        FEE_DENOMINATOR,
        Rounding::Up,
    )
    .unwrap();
    input_amount.checked_sub(trading_fee).unwrap()
}
// that test show that, more input amount, then more output amount
#[test]
fn test_rate_limiter_routing_friendly() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();

    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        max_fee_bps: 5000,        // 50 %
        fee_increment_bps,        // 10 bps
    };

    let mut input_amount = reference_amount - 10;
    let mut currrent_output_amount = calculate_output_amount(&rate_limiter, input_amount);

    for _i in 0..500 {
        input_amount = input_amount + reference_amount / 2;
        let output_amount = calculate_output_amount(&rate_limiter, input_amount);
        assert!(output_amount > currrent_output_amount);
        currrent_output_amount = output_amount
    }
}

#[test]
fn test_rate_limiter_base_fee_numerator() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();

    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        max_fee_bps: 5000,        // 50 %
        fee_increment_bps,        // 10 bps
    };

    {
        // trade from base to quote
        let fee_numerator = rate_limiter
            .get_base_fee_numerator_from_included_fee_amount(
                0,
                0,
                TradeDirection::AtoB,
                2_000_000_000,
            )
            .unwrap();

        assert_eq!(fee_numerator, rate_limiter.cliff_fee_numerator);
    }

    {
        // trade pass last effective point
        let fee_numerator = rate_limiter
            .get_base_fee_numerator_from_included_fee_amount(
                (rate_limiter.max_limiter_duration + 1).into(),
                0,
                TradeDirection::BtoA,
                2_000_000_000,
            )
            .unwrap();

        assert_eq!(fee_numerator, rate_limiter.cliff_fee_numerator);
    }

    {
        // trade in effective point
        let fee_numerator = rate_limiter
            .get_base_fee_numerator_from_included_fee_amount(
                rate_limiter.max_limiter_duration.into(),
                0,
                TradeDirection::BtoA,
                2_000_000_000,
            )
            .unwrap();

        assert!(fee_numerator > rate_limiter.cliff_fee_numerator);
    }
}
