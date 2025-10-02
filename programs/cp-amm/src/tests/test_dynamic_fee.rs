use crate::tests::price_math::get_price_from_id;

const BASIS_POINT_MAX: u64 = 10_000;

#[derive(Debug, Default)]
struct DynamicFeeModel {
    base_fee: u128,
    bin_step: u16,
    sqrt_price_reference: u128, // reference sqrt price
    sqrt_price_current: u128,
    volatility_accumulator: u128,
    max_volatility_accumulator: u128,
    volatility_reference: u128, // decayed volatility accumulator
    filter_period: u16,
    decay_period: u16,
    reduction_factor: u16,
    variable_fee_control: u128,
    last_update_timestamp: u64,
}

impl DynamicFeeModel {
    pub fn get_detal_price(&mut self, sqrt_price: u128) -> u128 {
        let bin_step = (self.bin_step as u128)
            .checked_shl(64)
            .unwrap()
            .checked_div(BASIS_POINT_MAX.into())
            .unwrap();
        if self.sqrt_price_reference > sqrt_price {
            self.sqrt_price_reference
                .checked_sub(sqrt_price)
                .unwrap()
                .checked_div(bin_step)
                .unwrap()
        } else {
            sqrt_price
                .checked_sub(self.sqrt_price_reference)
                .unwrap()
                .checked_div(bin_step)
                .unwrap()
        }
    }
    pub fn update_volatility_accumulator(&mut self, sqrt_price: u128) {
        // Upscale to prevent overflow caused by swapping from left most bin to right most bin.
        let delta_price = self.get_detal_price(sqrt_price);

        println!("delta id {}", delta_price);

        let volatility_accumulator = self
            .volatility_reference
            .checked_add(delta_price.checked_mul(BASIS_POINT_MAX.into()).unwrap())
            .unwrap();

        self.volatility_accumulator =
            std::cmp::min(volatility_accumulator, self.max_volatility_accumulator)
    }

    // simulate swap function
    pub fn swap(&mut self, sqrt_price: u128, current_timestamp: u64) -> u128 {
        // update reference
        self.update_references(current_timestamp);

        let price = self.get_total_fee();
        self.update_volatility_accumulator(sqrt_price);

        self.sqrt_price_current = sqrt_price;
        self.last_update_timestamp = current_timestamp;
        return price;
    }
    pub fn update_references(&mut self, current_timestamp: u64) {
        let elapsed = current_timestamp
            .checked_sub(self.last_update_timestamp)
            .unwrap();

        // Not high frequency trade
        if elapsed >= self.filter_period as u64 {
            // Update sqrt of last transaction
            self.sqrt_price_reference = self.sqrt_price_current;
            // filter period < t < decay_period. Decay time window.
            if elapsed < self.decay_period as u64 {
                let volatility_reference = self
                    .volatility_accumulator
                    .checked_mul(self.reduction_factor as u128)
                    .unwrap()
                    .checked_div(BASIS_POINT_MAX as u128)
                    .unwrap();

                self.volatility_reference = volatility_reference;
            }
            // Out of decay time window
            else {
                self.volatility_reference = 0;
            }
        }
    }

    pub fn get_variable_fee(&self) -> u128 {
        if self.variable_fee_control > 0 {
            let square_vfa_bin = self
                .volatility_accumulator
                .checked_mul(self.bin_step.into())
                .unwrap()
                .checked_pow(2)
                .unwrap();
            // Variable fee control, volatility accumulator, bin step are in basis point unit (10_000)
            // This is 1e20. Which > 1e9. Scale down it to 1e9 unit and ceiling the remaining.
            let v_fee = self
                .variable_fee_control
                .checked_mul(square_vfa_bin)
                .unwrap();

            println!("v_fee {}", v_fee);

            let scaled_v_fee = v_fee
                .checked_add(99_999_999_999)
                .unwrap()
                .checked_div(100_000_000_000)
                .unwrap();
            return scaled_v_fee;
        }
        0
    }

    pub fn get_total_fee(&self) -> u128 {
        self.base_fee.checked_add(self.get_variable_fee()).unwrap()
    }
}

#[test]
fn test_from_price_to_bin_id() {
    // find i to satisfied (1+bin_step) ^ i <= sqrt_price < (1+bin_step) ^ (i+1)
    let bin_step = 80; // 80bps
    let sqrt_active_id = 100;
    let sqrt_price_current: u128 = get_price_from_id(sqrt_active_id, bin_step).unwrap();
    let base_fee = 1_000_000;

    let mut model = DynamicFeeModel {
        base_fee,
        bin_step,
        sqrt_price_reference: sqrt_price_current, // reference sqrt price
        sqrt_price_current,
        volatility_accumulator: 0,
        max_volatility_accumulator: 150_000,
        volatility_reference: 0, // decayed volatility accumulator
        filter_period: 10,       // 10 sec
        decay_period: 120,       // 2 min
        reduction_factor: 5000,
        variable_fee_control: 50_000,
        last_update_timestamp: 0,
    };

    {
        let current_timestamp = 2;
        let sqrt_price_update = get_price_from_id(sqrt_active_id - 1, bin_step).unwrap();
        let fee = model.swap(sqrt_price_update, current_timestamp);
        println!("fee {}", fee);
    }
    {
        let current_timestamp = 3;
        let sqrt_price_update = get_price_from_id(sqrt_active_id - 2, bin_step).unwrap();
        let fee = model.swap(sqrt_price_update, current_timestamp);
        println!("fee {}", fee);
    }
    {
        let current_timestamp = 15;
        let sqrt_price_update = get_price_from_id(sqrt_active_id - 2, bin_step).unwrap();
        let fee = model.swap(sqrt_price_update, current_timestamp);
        println!("fee {}", fee);
    }
    {
        let current_timestamp = 16;
        let sqrt_price_update = get_price_from_id(sqrt_active_id - 2, bin_step).unwrap();
        let fee = model.swap(sqrt_price_update, current_timestamp);
        println!("fee {}", fee);
    }

    println!("{:?}", model);
}
