import { BN } from "@coral-xyz/anchor";

export function getLiquidityDeltaFromAmountA(
  maxAmountA: BN,
  lowerSqrtPrice: BN, // current sqrt price
  upperSqrtPrice: BN // max sqrt price
): BN {
  const prod = maxAmountA.mul(upperSqrtPrice.mul(lowerSqrtPrice));
  const delta = upperSqrtPrice.sub(lowerSqrtPrice);
  return prod.div(delta);
}

export function getLiquidityDeltaFromAmountB(
  maxAmountB: BN,
  lowerSqrtPrice: BN, // mint sqrt price
  upperSqrtPrice: BN // current sqrt price
): BN {
  const denominator = upperSqrtPrice.sub(lowerSqrtPrice);
  return maxAmountB.div(denominator);
}
