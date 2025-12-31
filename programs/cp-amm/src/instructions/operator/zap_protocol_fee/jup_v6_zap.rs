use crate::{
    constants::zap::{
        JUP_V6_ROUTE_AMOUNT_IN_REVERSE_OFFSET, JUP_V6_ROUTE_DESTINATION_ACCOUNT_INDEX,
        JUP_V6_ROUTE_SOURCE_ACCOUNT_INDEX, JUP_V6_SHARED_ACCOUNT_ROUTE_AMOUNT_IN_REVERSE_OFFSET,
        JUP_V6_SHARED_ACCOUNT_ROUTE_DESTINATION_ACCOUNT_INDEX,
        JUP_V6_SHARED_ACCOUNT_ROUTE_SOURCE_ACCOUNT_INDEX,
    },
    instructions::zap_protocol_fee::{RawZapOutAmmInfo, ZapInfoProcessor},
    math::safe_math::{SafeCast, SafeMath},
    PoolError,
};
use anchor_lang::prelude::*;
use jupiter::types::RoutePlanStep;
use jupiter::types::Swap;
use zap::types::ZapOutParameters;

pub struct ZapJupV6RouteInfoProcessor;

fn ensure_whitelisted_swap_leg(route_plan_steps: &[RoutePlanStep]) -> Result<()> {
    for step in route_plan_steps {
        match step.swap {
            Swap::Meteora
            | Swap::MeteoraDammV2
            | Swap::MeteoraDammV2WithRemainingAccounts
            | Swap::MeteoraDlmm
            | Swap::MeteoraDlmmSwapV2 { .. }
            | Swap::Mercurial
            | Swap::Whirlpool { .. }
            | Swap::WhirlpoolSwapV2 { .. }
            | Swap::Raydium
            | Swap::RaydiumV2
            | Swap::RaydiumCP
            | Swap::RaydiumClmm
            | Swap::RaydiumClmmV2 => {
                // whitelisted swap leg
            }
            _ => return Err(PoolError::InvalidZapOutParameters.into()),
        }
    }

    Ok(())
}

impl ZapInfoProcessor for ZapJupV6RouteInfoProcessor {
    fn validate_payload(&self, payload: &[u8]) -> Result<()> {
        let route_params = jupiter::client::args::Route::try_from_slice(payload)?;
        ensure_whitelisted_swap_leg(&route_params.route_plan)?;

        Ok(())
    }

    fn extract_raw_zap_out_amm_info(
        &self,
        zap_params: &ZapOutParameters,
    ) -> Result<RawZapOutAmmInfo> {
        let amount_in_offset = zap_params
            .payload_data
            .len()
            .safe_sub(JUP_V6_ROUTE_AMOUNT_IN_REVERSE_OFFSET)?
            .safe_cast()?;

        Ok(RawZapOutAmmInfo {
            source_index: JUP_V6_ROUTE_SOURCE_ACCOUNT_INDEX,
            destination_index: JUP_V6_ROUTE_DESTINATION_ACCOUNT_INDEX,
            amount_in_offset,
        })
    }
}

pub struct ZapJupV6SharedRouteInfoProcessor;

impl ZapInfoProcessor for ZapJupV6SharedRouteInfoProcessor {
    fn validate_payload(&self, payload: &[u8]) -> Result<()> {
        let route_params = jupiter::client::args::SharedAccountsRoute::try_from_slice(payload)?;
        ensure_whitelisted_swap_leg(&route_params.route_plan)?;
        Ok(())
    }

    fn extract_raw_zap_out_amm_info(
        &self,
        zap_params: &ZapOutParameters,
    ) -> Result<RawZapOutAmmInfo> {
        let amount_in_offset = zap_params
            .payload_data
            .len()
            .safe_sub(JUP_V6_SHARED_ACCOUNT_ROUTE_AMOUNT_IN_REVERSE_OFFSET)?
            .safe_cast()?;

        Ok(RawZapOutAmmInfo {
            source_index: JUP_V6_SHARED_ACCOUNT_ROUTE_SOURCE_ACCOUNT_INDEX,
            destination_index: JUP_V6_SHARED_ACCOUNT_ROUTE_DESTINATION_ACCOUNT_INDEX,
            amount_in_offset,
        })
    }
}
