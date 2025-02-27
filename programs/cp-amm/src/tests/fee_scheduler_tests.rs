use crate::state::fee::BaseFeeStruct;

#[test]
fn test_base_fee() {
    let base_fee = BaseFeeStruct {
        cliff_fee_numerator: 100_000,
        fee_scheduler_mode: 1,
        number_of_period: 50,
        period_frequency: 1,
        reduction_factor: 500, // 5% each second
        start_point: 0,
        ..Default::default()
    };
    let current_fee = base_fee.get_current_base_fee_numerator(100).unwrap();
    println!("{}", current_fee)
}
