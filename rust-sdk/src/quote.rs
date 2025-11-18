use anyhow::{anyhow, ensure, Context, Result};
use cp_amm::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool, SwapResult},
    ActivationType,
};
use spl_token_2022::extension::{
    transfer_fee::{TransferFee, TransferFeeConfig},
    BaseStateWithExtensions, StateWithExtensions,
};
use spl_token_2022::state::Mint;

/// Off-chain quote for a potential swap.
#[derive(Debug, PartialEq)]
pub struct Quote {
    /// Resulting pool math prior to Token-2022 transfer fees being applied.
    pub swap_result: SwapResult,
    /// Amount that effectively reaches the pool after deducting input transfer fees.
    pub effective_amount_in: u64,
    /// Portion of the provided amount collected as input transfer fee.
    pub input_transfer_fee: u64,
    /// Amount the taker receives after output transfer fees are withheld.
    pub effective_amount_out: u64,
    /// Portion of the pool's output withheld as transfer fee.
    pub output_transfer_fee: u64,
}

/// Transfer-fee metadata extracted for each pool token mint.
#[derive(Clone, Debug, PartialEq)]
pub struct MintTransferFees {
    token_a: Option<TransferFee>,
    token_b: Option<TransferFee>,
    token_a_known: bool,
    token_b_known: bool,
}

impl Default for MintTransferFees {
    fn default() -> Self {
        Self {
            token_a: None,
            token_b: None,
            token_a_known: false,
            token_b_known: false,
        }
    }
}

impl MintTransferFees {
    /// Create a transfer-fee bundle when both token mints have already been inspected.
    pub fn new(token_a: Option<TransferFee>, token_b: Option<TransferFee>) -> Self {
        Self {
            token_a,
            token_b,
            token_a_known: true,
            token_b_known: true,
        }
    }

    pub fn input_fee(&self, a_to_b: bool) -> Option<&TransferFee> {
        if a_to_b {
            self.token_a.as_ref()
        } else {
            self.token_b.as_ref()
        }
    }

    pub fn output_fee(&self, a_to_b: bool) -> Option<&TransferFee> {
        if a_to_b {
            self.token_b.as_ref()
        } else {
            self.token_a.as_ref()
        }
    }

    fn input_known(&self, a_to_b: bool) -> bool {
        if a_to_b {
            self.token_a_known
        } else {
            self.token_b_known
        }
    }

    fn output_known(&self, a_to_b: bool) -> bool {
        if a_to_b {
            self.token_b_known
        } else {
            self.token_a_known
        }
    }

    /// Construct transfer-fee metadata by parsing on-chain mint accounts.
    pub fn from_pool_mints(
        pool: &Pool,
        current_epoch: u64,
        token_a_mint_account: Option<&[u8]>,
        token_b_mint_account: Option<&[u8]>,
    ) -> Result<Self> {
        let token_a_flag = TokenProgramFlag::try_from(pool.token_a_flag)?;
        let token_b_flag = TokenProgramFlag::try_from(pool.token_b_flag)?;

        let (token_a, token_a_known) = match token_a_flag {
            TokenProgramFlag::TokenProgram => (None, true),
            TokenProgramFlag::TokenProgram2022 => {
                let mint_data = token_a_mint_account
                    .context("token A mint account data required for Token-2022 pools")?;
                (load_transfer_fee(mint_data, current_epoch)?, true)
            }
        };

        let (token_b, token_b_known) = match token_b_flag {
            TokenProgramFlag::TokenProgram => (None, true),
            TokenProgramFlag::TokenProgram2022 => {
                let mint_data = token_b_mint_account
                    .context("token B mint account data required for Token-2022 pools")?;
                (load_transfer_fee(mint_data, current_epoch)?, true)
            }
        };

        Ok(Self {
            token_a,
            token_b,
            token_a_known,
            token_b_known,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TokenProgramFlag {
    TokenProgram,
    TokenProgram2022,
}

impl TryFrom<u8> for TokenProgramFlag {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::TokenProgram),
            1 => Ok(Self::TokenProgram2022),
            _ => Err(anyhow!("unknown token program flag: {value}")),
        }
    }
}

/// Compute an off-chain quote, mirroring on-chain transfer-fee behaviour.
///
/// The `transfer_fees` argument should be populated with [`MintTransferFees::from_pool_mints`]
/// or another source that reflects the current epoch's Token-2022 transfer rules. Quotes for
/// Token-2022 pools error out when the relevant mint data has not been provided, preventing
/// callers from accidentally ignoring the additional fees enforced on-chain.
pub fn get_quote(
    pool: &Pool,
    current_timestamp: u64,
    current_slot: u64,
    actual_amount_in: u64,
    a_to_b: bool,
    has_referral: bool,
    transfer_fees: &MintTransferFees,
) -> Result<Quote> {
    ensure!(actual_amount_in > 0, "amount is zero");

    let activation_type =
        ActivationType::try_from(pool.activation_type).context("invalid activation type")?;

    let current_point = match activation_type {
        ActivationType::Slot => current_slot,
        ActivationType::Timestamp => current_timestamp,
    };

    ensure!(
        pool.pool_status == 0 && pool.activation_point <= current_point,
        "Swap is disabled",
    );

    let trade_direction = if a_to_b {
        TradeDirection::AtoB
    } else {
        TradeDirection::BtoA
    };

    let (input_fee, output_fee) = transfer_fees_for_direction(pool, transfer_fees, trade_direction)?;

    let TransferFeeAmount {
        amount: effective_amount_in,
        transfer_fee: input_transfer_fee,
    } = calculate_transfer_fee_excluded_amount(input_fee, actual_amount_in)?;

    ensure!(effective_amount_in > 0, "amount is zero after transfer fees");

    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = pool.get_swap_result(
        effective_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    let TransferFeeAmount {
        amount: effective_amount_out,
        transfer_fee: output_transfer_fee,
    } = calculate_transfer_fee_excluded_amount(output_fee, swap_result.output_amount)?;

    Ok(Quote {
        swap_result,
        effective_amount_in,
        input_transfer_fee,
        effective_amount_out,
        output_transfer_fee,
    })
}

fn transfer_fees_for_direction<'a>(
    pool: &Pool,
    transfer_fees: &'a MintTransferFees,
    trade_direction: TradeDirection,
) -> Result<(Option<&'a TransferFee>, Option<&'a TransferFee>)> {
    match trade_direction {
        TradeDirection::AtoB => Ok((
            require_transfer_fee(
                TokenProgramFlag::try_from(pool.token_a_flag)?,
                transfer_fees.input_known(true),
                transfer_fees.input_fee(true),
                "token A",
            )?,
            require_transfer_fee(
                TokenProgramFlag::try_from(pool.token_b_flag)?,
                transfer_fees.output_known(true),
                transfer_fees.output_fee(true),
                "token B",
            )?,
        )),
        TradeDirection::BtoA => Ok((
            require_transfer_fee(
                TokenProgramFlag::try_from(pool.token_b_flag)?,
                transfer_fees.input_known(false),
                transfer_fees.input_fee(false),
                "token B",
            )?,
            require_transfer_fee(
                TokenProgramFlag::try_from(pool.token_a_flag)?,
                transfer_fees.output_known(false),
                transfer_fees.output_fee(false),
                "token A",
            )?,
        )),
    }
}

fn require_transfer_fee<'a>(
    flag: TokenProgramFlag,
    is_known: bool,
    transfer_fee: Option<&'a TransferFee>,
    label: &str,
) -> Result<Option<&'a TransferFee>> {
    match flag {
        TokenProgramFlag::TokenProgram => Ok(None),
        TokenProgramFlag::TokenProgram2022 => {
            ensure!(
                is_known,
                "missing transfer-fee data for {label} Token-2022 mint"
            );
            Ok(transfer_fee)
        }
    }
}

#[derive(Debug, PartialEq)]
struct TransferFeeAmount {
    amount: u64,
    transfer_fee: u64,
}

fn calculate_transfer_fee_excluded_amount(
    transfer_fee: Option<&TransferFee>,
    transfer_fee_included_amount: u64,
) -> Result<TransferFeeAmount> {
    if let Some(transfer_fee) = transfer_fee {
        let transfer_fee_amount = transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .ok_or_else(|| anyhow!("transfer fee calculation overflow"))?;
        let transfer_fee_excluded_amount = transfer_fee_included_amount
            .checked_sub(transfer_fee_amount)
            .ok_or_else(|| anyhow!("transfer fee exceeds provided amount"))?;
        Ok(TransferFeeAmount {
            amount: transfer_fee_excluded_amount,
            transfer_fee: transfer_fee_amount,
        })
    } else {
        Ok(TransferFeeAmount {
            amount: transfer_fee_included_amount,
            transfer_fee: 0,
        })
    }
}

fn load_transfer_fee(mint_account_data: &[u8], epoch: u64) -> Result<Option<TransferFee>> {
    let mint = StateWithExtensions::<Mint>::unpack(mint_account_data)?;
    if let Ok(config) = mint.get_extension::<TransferFeeConfig>() {
        Ok(Some(config.get_epoch_fee(epoch).clone()))
    } else {
        Ok(None)
    }
}

