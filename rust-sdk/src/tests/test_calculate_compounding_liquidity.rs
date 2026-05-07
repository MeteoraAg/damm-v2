use crate::calculate_initial_sqrt_price::calculate_compounding_initial_sqrt_price_and_liquidity;
use cp_amm::get_initial_pool_information;
use cp_amm::state::CollectFeeMode;
use cp_amm::InitialPoolInformation;
use proptest::prelude::*;
proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_compounding_liquidity_initialization(
        a in 1..u64::MAX,
        b in 1..u64::MAX,
    ) {
        let result = calculate_compounding_initial_sqrt_price_and_liquidity(a, b);
        if result.is_none() {
            return Ok(());
        }
        let (sqrt_price, liquidity) = result.unwrap();
        let InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            sqrt_price: _,
            initial_liquidity: _,
            sqrt_min_price: _,
            sqrt_max_price: _,
        } = get_initial_pool_information(
            CollectFeeMode::Compounding,
            0,
            0,
            sqrt_price,
            liquidity,
        ).unwrap();

        println!("a {} {}", token_a_amount, a);
        assert!(token_a_amount <= a);
        println!("b {} {}", token_b_amount, b);
        assert!(token_b_amount <= b);
    }
}
