import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  CreateConfigParams,
  createConfigIx,
  createDynamicConfigIx,
  createOperator,
  createToken,
  encodePermissions,
  expectThrowsErrorCode,
  generateKpAndFund,
  getCpAmmProgramErrorCode,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  initializePool,
  InitializePoolParams,
  initializePoolWithCustomizeConfig,
  InitializePoolWithCustomizeConfigParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  randomID,
  startSvm,
} from "./helpers";
import {
  BaseFeeMode,
  encodeFeeMarketCapSchedulerParams,
  encodeFeeRateLimiterParams,
  encodeFeeTimeSchedulerParams,
} from "./helpers/feeCodec";
import {
  setDeprecatedRateLimiterConfig,
  RateLimiterParams,
} from "./helpers/deprecatedRateLimiter";
import { LiteSVM } from "litesvm";

const DEPRECATED_BASE_FEE_MODE = getCpAmmProgramErrorCode(
  "DeprecatedBaseFeeMode"
);

const rateLimiter: RateLimiterParams = {
  cliffFeeNumerator: new BN(10_000_000),
  feeIncrementBps: 10,
  maxLimiterDuration: 10,
  maxFeeBps: 5000,
  referenceAmount: new BN(LAMPORTS_PER_SOL),
};

describe("Deprecated base fee mode: rate limiter", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
  let creator: Keypair;
  let tokenA: PublicKey;
  let tokenB: PublicKey;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenA = createToken(svm, admin.publicKey);
    tokenB = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenA, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenB, admin, creator.publicKey);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([OperatorPermission.CreateConfigKey]),
    });
  });

  it("rejects create_config with a rate limiter base fee", async () => {
    const data = encodeFeeRateLimiterParams(
      BigInt(10_000_000),
      10,
      10,
      5000,
      BigInt(LAMPORTS_PER_SOL)
    );

    const params: CreateConfigParams = {
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 1, // OnlyB — the only mode a rate limiter ever accepted
    };

    await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      params,
      DEPRECATED_BASE_FEE_MODE
    );
  });

  it("rejects initialize_customizable_pool with a rate limiter base fee", async () => {
    const data = encodeFeeRateLimiterParams(
      BigInt(10_000_000),
      10,
      10,
      5000,
      BigInt(LAMPORTS_PER_SOL)
    );

    const params: InitializeCustomizablePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
      hasAlphaVault: false,
      activationType: 0,
      collectFeeMode: 1,
      activationPoint: null,
    };

    await initializeCustomizablePool(svm, params, DEPRECATED_BASE_FEE_MODE);
  });

  it("rejects initialize_pool_with_dynamic_config with a rate limiter base fee", async () => {
    const config = await createDynamicConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      { poolCreatorAuthority: creator.publicKey }
    );

    const data = encodeFeeRateLimiterParams(
      BigInt(10_000_000),
      10,
      10,
      5000,
      BigInt(LAMPORTS_PER_SOL)
    );

    const params: InitializePoolWithCustomizeConfigParams = {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 1,
    };

    await initializePoolWithCustomizeConfig(
      svm,
      params,
      DEPRECATED_BASE_FEE_MODE
    );
  });

  it("rejects initialize_pool against a pre-existing rate limiter config", async () => {
    // placeholder config. overriden as rate limiter
    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

    const configParams: CreateConfigParams = {
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 1,
    };

    const placeholder = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      configParams
    );
    setDeprecatedRateLimiterConfig(svm, placeholder, rateLimiter);

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config: placeholder,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
      activationPoint: null,
    };

    const { result } = await initializePool(svm, initPoolParams);

    expectThrowsErrorCode(result, DEPRECATED_BASE_FEE_MODE);
  });
});
