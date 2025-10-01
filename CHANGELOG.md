# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

### Breaking Changes


## cp_amm [0.1.5] [PR #122](https://github.com/MeteoraAg/damm-v2/pull/122)
### Added
- Allow partner to config another mode for base fee, called rate limiter. With the mode is enable, fee slope will increase if user buy with higher amount. The rate limiter mode is only available if collect fee mode is in token b token only, and when user buy token (not sell). Rate limiter doesn't allow user to send multiple swap instructions (or CPI) to the same pool in 1 transaction
- Add new endpoint `swap2`, that includes 3 `swap_mode`: 0 (ExactIn), 1 (PartialFill) and 2 (ExactOut)
- Emit new event in 2 swap endpoints `EvtSwap2`, that includes more information about `reserve_a_amount`, `reserve_b_amount`
- Emit new event `EvtLiquidityChange` when user add or remove liquidity

### Changed
- Support permissionless for token2022 with transfer hook extension if both transfer hook program and transfer hook authority have been revoked

### Deprecated
- Event `EvtSwap`, `EvtRemoveLiquidity` and `EvtAddLiquidity` are deprecated 

### Fixed
- Using `saturating_sub` instead of `safe_sub` for `elapsed` calculation

### Breaking Changes
- In swap instruction, if rate limiter is enable, user need to submit `instruction_sysvar_account` in remaining account, otherwise transaction will be failed
- Quote function can be changed by rate limiter

## cp_amm [0.1.4] 
### Added
- Add new endpoint `split_position2` that allows position's owner to split position with better resolution

### Breaking Changes
- `split_position` will not emit event `EvtSplitPosition`, instead of emitting event `EvtSplitPosition2`

## cp_amm [0.1.3]

### Added
- Add new endpoint `split_position` that allows position's owner to split position.

### Changed
- Loosen protocol and partner fee validation on program
- Optimize for pool authority seed calculation
- Make swap fields public
- Update quote function in sdk, add a condition for swap enabled 

### Breaking Changes
- `EvtInitializeReward` emit more fields: `creator`, `reward_duration_end`, `pre_reward_rate` and `post_reward_rate`

## cp_amm [0.1.2]

### Added
- New endpoint for admin to close token badge `close_token_badge`
- Pool state add a new field `creator`, that records address for pool creator 

### Changed
- Allow pool creator to initialize reward at index 0 permissionlessly
- Endpoint `update_reward_duration` update `admin` account to `signer` account
- Endpoint `update_reward_funder` update `admin` account to `signer` account
- Some bug fixs from audtior

### Breaking Changes
- Endpoint `claim_protocol_fee` add new parameters `max_amount_a` and `max_amount_b` to limit number of tokens to claim from a pool
- Endpoint `initialize_reward` update `admin` account to `signer` account, and add `payer` account in instruction
- Endpoint `claim_reward` requires new parameter `skip_reward`, when user submit instruction with that flag, then if `reward_vault` is frozen, user can still reset pending rewards


## cp_amm [0.1.1]

### Added
- New endpoint for admin to create a dynamic config key
- New endpoint to create pool from a dynamic config key
- Config state add a new field config_type, that defines static config or dynamic config

### Changed
- Change parameters for endpoint create_config