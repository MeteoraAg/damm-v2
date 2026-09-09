use crate::{
    constants::STABLE_MINTS,
    params::swap::TradeDirection,
    state::{fee::FeeMode, CollectFeeMode},
    validate_token_order_for_collect_fee_mode, PoolError,
};
use anchor_lang::prelude::Pubkey;

#[test]
fn test_fee_mode_output_token_a_to_b() {
    let fee_mode = FeeMode::get_fee_mode(CollectFeeMode::BothToken, TradeDirection::AtoB, false);

    assert_eq!(fee_mode.fees_on_input, false);
    assert_eq!(fee_mode.fees_on_token_a, false);
    assert_eq!(fee_mode.has_referral, false);
}

#[test]
fn test_fee_mode_output_token_b_to_a() {
    let fee_mode = FeeMode::get_fee_mode(CollectFeeMode::BothToken, TradeDirection::BtoA, true);

    assert_eq!(fee_mode.fees_on_input, false);
    assert_eq!(fee_mode.fees_on_token_a, true);
    assert_eq!(fee_mode.has_referral, true);
}

#[test]
fn test_fee_mode_quote_token_a_to_b() {
    let fee_mode = FeeMode::get_fee_mode(CollectFeeMode::OnlyB, TradeDirection::AtoB, false);

    assert_eq!(fee_mode.fees_on_input, false);
    assert_eq!(fee_mode.fees_on_token_a, false);
    assert_eq!(fee_mode.has_referral, false);
}

#[test]
fn test_fee_mode_quote_token_b_to_a() {
    let fee_mode = FeeMode::get_fee_mode(CollectFeeMode::OnlyB, TradeDirection::BtoA, true);

    assert_eq!(fee_mode.fees_on_input, true);
    assert_eq!(fee_mode.fees_on_token_a, false);
    assert_eq!(fee_mode.has_referral, true);
}

#[test]
fn test_fee_mode_default() {
    let fee_mode = FeeMode::default();

    assert_eq!(fee_mode.fees_on_input, false);
    assert_eq!(fee_mode.fees_on_token_a, false);
    assert_eq!(fee_mode.has_referral, false);
}

// Property-based test to ensure consistent behavior
#[test]
fn test_fee_mode_properties() {
    // When trading BaseToQuote, fees should never be on input
    let fee_mode = FeeMode::get_fee_mode(CollectFeeMode::OnlyB, TradeDirection::AtoB, true);
    assert_eq!(fee_mode.fees_on_input, false);

    // When using QuoteToken mode, base_token should always be false
    let fee_mode = FeeMode::get_fee_mode(CollectFeeMode::OnlyB, TradeDirection::BtoA, false);
    assert_eq!(fee_mode.fees_on_token_a, false);
}

#[test]
fn test_validate_token_order_for_collect_fee_mode() {
    let wsol = STABLE_MINTS[0];
    let usdc = STABLE_MINTS[1];
    let usdt = STABLE_MINTS[2];
    let meme_1 = Pubkey::new_unique();
    let meme_2 = Pubkey::new_unique();

    // collect_fee_mode, token_a, token_b, is_allowed
    let cases: [(CollectFeeMode, Pubkey, Pubkey, bool); 10] = [
        (CollectFeeMode::OnlyB, wsol, meme_1, false),
        (CollectFeeMode::OnlyB, usdc, meme_1, false),
        (CollectFeeMode::OnlyB, usdt, meme_1, false),
        (CollectFeeMode::Compounding, wsol, meme_1, false),
        (CollectFeeMode::BothToken, wsol, meme_1, true),
        (CollectFeeMode::OnlyB, meme_1, wsol, true),
        (CollectFeeMode::Compounding, meme_1, wsol, true),
        (CollectFeeMode::OnlyB, meme_1, meme_2, true),
        (CollectFeeMode::OnlyB, wsol, usdc, true),
        (CollectFeeMode::Compounding, usdc, wsol, true),
    ];

    for (collect_fee_mode, token_a_mint, token_b_mint, is_allowed) in cases {
        let result = validate_token_order_for_collect_fee_mode(
            collect_fee_mode,
            &token_a_mint,
            &token_b_mint,
        );
        if is_allowed {
            assert!(
                result.is_ok(),
                "expected allowed: {:?} {} {}",
                collect_fee_mode,
                token_a_mint,
                token_b_mint
            );
        } else {
            let error = result.unwrap_err();
            assert_eq!(
                error,
                PoolError::UnsupportedTokenOrderForCollectFeeMode.into(),
                "expected UnsupportedTokenOrderForCollectFeeMode: {:?} {} {}",
                collect_fee_mode,
                token_a_mint,
                token_b_mint
            );
        }
    }
}
