import { CpAmm } from "../../target/types/cp_amm";
import { IdlTypes } from "@coral-xyz/anchor";
import { createCpAmmProgram } from "./cpAmm";
import { BN } from "bn.js";

type PodAlignedFeeTimeScheduler = IdlTypes<CpAmm>["podAlignedFeeTimeScheduler"];
type PodAlignedFeeMarketCapScheduler =
  IdlTypes<CpAmm>["podAlignedFeeMarketCapScheduler"];
type PodAlignedRateLimiter = IdlTypes<CpAmm>["podAlignedFeeRateLimiter"];

type BorshFeeTimeScheduler = IdlTypes<CpAmm>["borshFeeTimeScheduler"];
type BorshFeeMarketCapScheduler = IdlTypes<CpAmm>["borshFeeMarketCapScheduler"];
type BorshRateLimiter = IdlTypes<CpAmm>["borshFeeRateLimiter"];

export enum BaseFeeMode {
  FeeTimeSchedulerLinear,
  FeeTimeSchedulerExponential,
  RateLimiter,
  FeeMarketCapSchedulerLinear,
  FeeMarketCapSchedulerExponential,
}

export function encodeFeeTimeSchedulerParams(
  cliffFeeNumerator: bigint,
  numberOfPeriod: number,
  periodFrequency: bigint,
  reductionFactor: bigint,
  baseFeeMode:
    | BaseFeeMode.FeeTimeSchedulerLinear
    | BaseFeeMode.FeeTimeSchedulerExponential
): Buffer {
  const feeTimeScheduler: BorshFeeTimeScheduler = {
    cliffFeeNumerator: new BN(cliffFeeNumerator.toString()),
    numberOfPeriod,
    periodFrequency: new BN(periodFrequency.toString()),
    reductionFactor: new BN(reductionFactor.toString()),
    baseFeeMode,
  };

  const program = createCpAmmProgram();
  return program.coder.types.encode("borshFeeTimeScheduler", feeTimeScheduler);
}

export function decodeFeeTimeSchedulerParams(
  data: Buffer
): BorshFeeTimeScheduler {
  const program = createCpAmmProgram();
  return program.coder.types.decode("borshFeeTimeScheduler", data);
}

export function decodePodAlignedFeeTimeScheduler(
  data: Buffer
): PodAlignedFeeTimeScheduler {
  const program = createCpAmmProgram();
  return program.coder.types.decode("podAlignedFeeTimeScheduler", data);
}

export function encodeFeeMarketCapSchedulerParams(
  cliffFeeNumerator: bigint,
  numberOfPeriod: number,
  sqrtPriceStepBps: number,
  schedulerExpirationDuration: number,
  reductionFactor: bigint,
  baseFeeMode:
    | BaseFeeMode.FeeMarketCapSchedulerExponential
    | BaseFeeMode.FeeMarketCapSchedulerLinear
): Buffer {
  const feeMarketCapScheduler: BorshFeeMarketCapScheduler = {
    cliffFeeNumerator: new BN(cliffFeeNumerator.toString()),
    numberOfPeriod,
    sqrtPriceStepBps,
    schedulerExpirationDuration,
    reductionFactor: new BN(reductionFactor.toString()),
    baseFeeMode,
  };

  const program = createCpAmmProgram();
  return program.coder.types.encode(
    "borshFeeMarketCapScheduler",
    feeMarketCapScheduler
  );
}

export function decodeFeeMarketCapSchedulerParams(
  data: Buffer
): BorshFeeMarketCapScheduler {
  const program = createCpAmmProgram();
  return program.coder.types.decode("borshFeeMarketCapScheduler", data);
}

export function decodePodAlignedFeeMarketCapScheduler(
  data: Buffer
): PodAlignedFeeMarketCapScheduler {
  const program = createCpAmmProgram();
  return program.coder.types.decode("podAlignedFeeMarketCapScheduler", data);
}

export function encodeFeeRateLimiterParams(
  cliffFeeNumerator: bigint,
  feeIncrementBps: number,
  maxLimiterDuration: number,
  maxFeeBps: number,
  referenceAmount: bigint
) {
  const feeRateLimiter: BorshRateLimiter = {
    cliffFeeNumerator: new BN(cliffFeeNumerator.toString()),
    feeIncrementBps,
    maxLimiterDuration,
    maxFeeBps,
    referenceAmount: new BN(referenceAmount.toString()),
    baseFeeMode: BaseFeeMode.RateLimiter,
  };

  const program = createCpAmmProgram();
  return program.coder.types.encode("borshFeeRateLimiter", feeRateLimiter);
}

export function decodeFeeRateLimiterParams(data: Buffer): BorshRateLimiter {
  const program = createCpAmmProgram();
  return program.coder.types.decode("borshFeeRateLimiter", data);
}

export function decodePodAlignedFeeRateLimiter(
  data: Buffer
): PodAlignedRateLimiter {
  const program = createCpAmmProgram();
  return program.coder.types.decode("podAlignedFeeRateLimiter", data);
}
