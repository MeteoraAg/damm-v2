import { IdlTypes } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { LiteSVM } from "litesvm";
import { CpAmm } from "../../target/types/cp_amm";
import { createCpAmmProgram } from "./cpAmm";
import { BaseFeeMode } from "./feeCodec";

type PodAlignedRateLimiter = IdlTypes<CpAmm>["podAlignedFeeRateLimiter"];

export type RateLimiterParams = {
  cliffFeeNumerator: BN;
  feeIncrementBps: number;
  maxLimiterDuration: number;
  maxFeeBps: number;
  referenceAmount: BN;
};

const POOL_BASE_FEE_INFO_OFFSET = 8;
const CONFIG_BASE_FEE_INFO_OFFSET = 72;
const BASE_FEE_INFO_LEN = 32;

export function encodePodAlignedRateLimiter(params: RateLimiterParams): Buffer {
  const podAligned: PodAlignedRateLimiter = {
    cliffFeeNumerator: params.cliffFeeNumerator,
    baseFeeMode: BaseFeeMode.RateLimiter,
    padding: [0, 0, 0, 0, 0],
    feeIncrementBps: params.feeIncrementBps,
    maxLimiterDuration: params.maxLimiterDuration,
    maxFeeBps: params.maxFeeBps,
    referenceAmount: params.referenceAmount,
  };

  const program = createCpAmmProgram();
  const encoded = program.coder.types.encode(
    "podAlignedFeeRateLimiter",
    podAligned
  );

  if (encoded.length !== BASE_FEE_INFO_LEN) {
    throw new Error(
      `Expected ${BASE_FEE_INFO_LEN} bytes of pod aligned rate limiter, got ${encoded.length}`
    );
  }

  return encoded;
}

function setDeprecatedRateLimiter(
  svm: LiteSVM,
  address: PublicKey,
  offset: number,
  params: RateLimiterParams
) {
  const account = svm.getAccount(address);
  if (!account) {
    throw new Error(`Account ${address.toBase58()} does not exist`);
  }

  const data = Buffer.from(account.data);
  if (data.length < offset + BASE_FEE_INFO_LEN) {
    throw new Error(
      `Account ${address.toBase58()} is ${
        data.length
      } bytes, too short to hold a base fee at offset ${offset}`
    );
  }

  encodePodAlignedRateLimiter(params).copy(data, offset);

  svm.setAccount(address, {
    ...account,
    data: new Uint8Array(data),
  });
}

/// Overwrite a pool's base fee with a rate limiter, leaving other field untouched
export function setDeprecatedRateLimiterPool(
  svm: LiteSVM,
  pool: PublicKey,
  params: RateLimiterParams
) {
  setDeprecatedRateLimiter(svm, pool, POOL_BASE_FEE_INFO_OFFSET, params);
}

/// Overwrite a static config's base fee with a rate limiter
export function setDeprecatedRateLimiterConfig(
  svm: LiteSVM,
  config: PublicKey,
  params: RateLimiterParams
) {
  setDeprecatedRateLimiter(svm, config, CONFIG_BASE_FEE_INFO_OFFSET, params);
}
