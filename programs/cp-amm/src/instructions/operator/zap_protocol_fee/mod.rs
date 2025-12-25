use anchor_lang::prelude::*;
use zap::types::ZapOutParameters;

use crate::{
    constants::zap::{
        DAMM_V2_SWAP_DISC_REF, DLMM, DLMM_SWAP2_DISC_REF, JUP_V6, JUP_V6_ROUTE_DISC_REF,
        JUP_V6_SHARED_ACCOUNT_ROUTE_DISC_REF,
    },
    zap_protocol_fee::{
        damm_v2_zap::ZapDammV2InfoProcessor,
        dlmm_zap::ZapDlmmInfoProcessor,
        jup_v6_zap::{ZapJupV6RouteInfoProcessor, ZapJupV6SharedRouteInfoProcessor},
    },
    PoolError,
};
mod damm_v2_zap;
mod dlmm_zap;
mod process_zap_protocol_fee;
pub use process_zap_protocol_fee::*;

// for testing purpose
#[cfg(feature = "local")]
pub mod jup_v6_zap;

#[cfg(not(feature = "local"))]
mod jup_v6_zap;

pub struct RawZapOutAmmInfo {
    source_index: usize,
    destination_index: usize,
    amount_in_offset: u16,
}

pub trait ZapInfoProcessor {
    fn validate_payload(&self, payload: &[u8]) -> Result<()>;
    fn extract_raw_zap_out_amm_info(
        &self,
        zap_params: &ZapOutParameters,
    ) -> Result<RawZapOutAmmInfo>;
}

pub fn get_zap_amm_processor(
    amm_disc: &[u8],
    amm_program_address: Pubkey,
) -> Result<Box<dyn ZapInfoProcessor>> {
    match (amm_disc, amm_program_address) {
        (DLMM_SWAP2_DISC_REF, DLMM) => Ok(Box::new(ZapDlmmInfoProcessor)),
        (DAMM_V2_SWAP_DISC_REF, crate::ID_CONST) => Ok(Box::new(ZapDammV2InfoProcessor)),
        (JUP_V6_ROUTE_DISC_REF, JUP_V6) => Ok(Box::new(ZapJupV6RouteInfoProcessor)),
        (JUP_V6_SHARED_ACCOUNT_ROUTE_DISC_REF, JUP_V6) => {
            Ok(Box::new(ZapJupV6SharedRouteInfoProcessor))
        }
        _ => Err(PoolError::InvalidZapOutParameters.into()),
    }
}
