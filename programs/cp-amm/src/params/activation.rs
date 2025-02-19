use anchor_lang::prelude::*;

use crate::{
    activation_handler::{ActivationHandler, ActivationType},
    safe_math::SafeMath,
    state::{get_timing_constraint_by_activation_type, TimingConstraint},
    PoolError,
};

pub struct ActivationParams {
    /// The pool start trading.
    pub activation_point: Option<u64>,
    /// Whether the pool support alpha vault
    pub has_alpha_vault: bool,
    /// Activation type
    pub activation_type: u8,
}

impl ActivationParams {
    pub fn validate(&self) -> Result<()> {
        let clock = Clock::get()?;
        let activation_type = ActivationType::try_from(self.activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let TimingConstraint {
            current_point,
            min_activation_duration,
            max_activation_duration,
            pre_activation_swap_duration,
            last_join_buffer,
            ..
        } = get_timing_constraint_by_activation_type(activation_type, &clock);

        if self.has_alpha_vault {
            // Must specify activation point to prevent "unable" create alpha vault
            match self.activation_point {
                Some(activation_point) => {
                    require!(
                        activation_point > current_point,
                        PoolError::InvalidActivationPoint
                    );

                    // Must be within the range
                    let activation_duration = activation_point.safe_sub(current_point)?;
                    require!(
                        activation_duration >= min_activation_duration
                            && activation_duration <= max_activation_duration,
                        PoolError::InvalidActivationPoint
                    );

                    // Must have some join time
                    let activation_handler = ActivationHandler {
                        curr_point: current_point,
                        activation_point,
                        buffer_duration: pre_activation_swap_duration,
                        whitelisted_vault: Pubkey::default(),
                    };
                    let last_join_point = activation_handler.get_last_join_point()?;

                    let pre_last_join_point = last_join_point.safe_sub(last_join_buffer)?;
                    require!(
                        pre_last_join_point >= current_point,
                        PoolError::InvalidActivationPoint
                    );
                }
                None => {
                    return Err(PoolError::InvalidActivationPoint.into());
                }
            }
        } else if let Some(activation_point) = self.activation_point {
            // If no alpha vault, it's fine as long as the specified activation point is in the future, or now.
            // Prevent creation of forever untradable pool
            require!(
                activation_point >= current_point
                    && current_point.safe_add(max_activation_duration)? >= activation_point,
                PoolError::InvalidActivationPoint
            );
        }

        Ok(())
    }
}
