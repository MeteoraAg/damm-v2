use crate::{
    constants::zap::{
        DLMM_SWAP2_AMOUNT_IN_OFFSET, DLMM_SWAP2_DESTINATION_ACCOUNT_INDEX,
        DLMM_SWAP2_SOURCE_ACCOUNT_INDEX,
    },
    instructions::zap_protocol_fee::{RawZapOutAmmInfo, ZapInfoProcessor},
};
use anchor_lang::prelude::*;
use zap::types::ZapOutParameters;

pub struct ZapDlmmInfoProcessor;

impl ZapInfoProcessor for ZapDlmmInfoProcessor {
    fn validate_payload(&self, _payload: &[u8]) -> Result<()> {
        Ok(())
    }

    fn extract_raw_zap_out_amm_info(
        &self,
        _zap_params: &ZapOutParameters,
    ) -> Result<RawZapOutAmmInfo> {
        Ok(RawZapOutAmmInfo {
            source_index: DLMM_SWAP2_SOURCE_ACCOUNT_INDEX,
            destination_index: DLMM_SWAP2_DESTINATION_ACCOUNT_INDEX,
            amount_in_offset: DLMM_SWAP2_AMOUNT_IN_OFFSET,
        })
    }
}
