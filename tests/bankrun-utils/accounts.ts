import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { getFirstKey, getSecondKey } from "./cpAmm";
import { CP_AMM_PROGRAM_ID } from "./constants";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export function derivePoolAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority")],
    CP_AMM_PROGRAM_ID
  )[0];
}
export function deriveConfigAddress(index: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config"), index.toArrayLike(Buffer, "le", 8)],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function derivePoolAddress(
  config: PublicKey,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      config.toBuffer(),
      getFirstKey(tokenAMint, tokenBMint),
      getSecondKey(tokenAMint, tokenBMint),
    ],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function derivePositionAddress(
  positionNft: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), positionNft.toBuffer()],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function deriveTokenVaultAddress(
  tokenMint: PublicKey,
  pool: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), tokenMint.toBuffer(), pool.toBuffer()],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function deriveRewardVaultAddress(
  pool: PublicKey,
  rewardIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), pool.toBuffer(), Buffer.from([rewardIndex])],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function deriveCustomizablePoolAddress(
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("cpool"),
      getFirstKey(tokenAMint, tokenBMint),
      getSecondKey(tokenAMint, tokenBMint),
    ],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function deriveTokenBadgeAddress(tokenMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_badge"), tokenMint.toBuffer()],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function deriveClaimFeeOperatorAddress(operator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cf_operator"), operator.toBuffer()],
    CP_AMM_PROGRAM_ID
  )[0];
}

export function derivePositionNftAccount(positionNftMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position_nft_account"), positionNftMint.toBuffer()],
    CP_AMM_PROGRAM_ID
  )[0];
}
