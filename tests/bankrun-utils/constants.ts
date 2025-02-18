import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const CP_AMM_PROGRAM_ID = new PublicKey(
  "9sh3gorJVsWgpdJo317PqnoWoTuDN2LkxiyYUUTu4sNJ"
);

export const MIN_SQRT_PRICE = new BN("4295048016");
export const MAX_SQRT_PRICE = new BN("79226673521066979257578248091");

export const LIQUIDITY_MAX = new BN("34028236692093846346337460743");
export const DECIMALS = 6;
export const BASIS_POINT_MAX = 10_000;
export const OFFSET = 64;
