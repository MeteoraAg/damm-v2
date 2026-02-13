use crate::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, CollectFeeMode},
};

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
