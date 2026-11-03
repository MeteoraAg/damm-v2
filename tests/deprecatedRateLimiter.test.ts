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
  swapExactIn,
  zeroPoolRateLimiter,
  parseEventInstruction,
  getPool,
} from "./helpers";
import {
  BaseFeeMode,
  decodePodAlignedFeeRateLimiter,
  encodeFeeRateLimiterParams,
  encodeFeeTimeSchedulerParams,
} from "./helpers/feeCodec";
import {
  setDeprecatedRateLimiterConfig,
  setDeprecatedRateLimiterPool,
  RateLimiterParams,
} from "./helpers/deprecatedRateLimiter";
import { LiteSVM } from "./helpers/litesvmCompat";
import { expect } from "chai";
import { TransactionMetadata } from "litesvm";

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

  describe("zero_pool_rate_limiter", () => {
    const INVALID_BASE_FEE_MODE =
      getCpAmmProgramErrorCode("InvalidBaseFeeMode");
    const INVALID_PERMISSION = getCpAmmProgramErrorCode("InvalidPermission");

    let fixPoolOperator: Keypair;

    beforeEach(async () => {
      fixPoolOperator = generateKpAndFund(svm);
      await createOperator(svm, {
        admin,
        whitelistAddress: fixPoolOperator.publicKey,
        permission: encodePermissions([OperatorPermission.FixPool]),
      });
    });

    // placeholder pool with a fee time scheduler base fee. tests override it as a rate limiter pool
    async function placeholderPool(): Promise<PublicKey> {
      const data = encodeFeeTimeSchedulerParams(
        BigInt(rateLimiter.cliffFeeNumerator.toString()),
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

      const config = await createConfigIx(
        svm,
        whitelistedAccount,
        new BN(randomID()),
        configParams
      );

      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: tokenA,
        tokenBMint: tokenB,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
        activationPoint: null,
      };
      const { pool } = await initializePool(svm, initPoolParams);
      return pool;
    }

    function rateLimiterState(pool: PublicKey) {
      const poolState = getPool(svm, pool);
      return decodePodAlignedFeeRateLimiter(
        Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
      );
    }

    async function swapFee(pool: PublicKey, amountIn: BN): Promise<BN> {
      const before = getPool(svm, pool).metrics;
      await swapExactIn(svm, {
        payer: creator,
        pool,
        inputTokenMint: tokenB,
        outputTokenMint: tokenA,
        amountIn,
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      });
      const after = getPool(svm, pool).metrics;
      return after.totalLpBFee
        .add(after.totalProtocolBFee)
        .sub(before.totalLpBFee)
        .sub(before.totalProtocolBFee);
    }

    it("rejects a pool whose base fee mode is not RateLimiter", async () => {
      const pool = await placeholderPool();

      const result = await zeroPoolRateLimiter(svm, {
        pool,
        whitelistedOperator: fixPoolOperator,
      });

      expectThrowsErrorCode(result, INVALID_BASE_FEE_MODE);
    });

    it("rejects an operator without the FixPool permission", async () => {
      const pool = await placeholderPool();
      setDeprecatedRateLimiterPool(svm, pool, rateLimiter);

      const result = await zeroPoolRateLimiter(svm, {
        pool,
        whitelistedOperator: whitelistedAccount,
      });

      expectThrowsErrorCode(result, INVALID_PERMISSION);
    });

    it("zeroes the rate limiter parameters and emits EvtZeroPoolRateLimiter", async () => {
      const pool = await placeholderPool();
      setDeprecatedRateLimiterPool(svm, pool, rateLimiter);

      const amountIn = new BN(LAMPORTS_PER_SOL).muln(2);
      const feeBefore = await swapFee(pool, amountIn);

      const result = await zeroPoolRateLimiter(svm, {
        pool,
        whitelistedOperator: fixPoolOperator,
      });
      expect(result).instanceOf(TransactionMetadata);

      const state = rateLimiterState(pool);
      expect(state.baseFeeMode).eq(BaseFeeMode.RateLimiter);
      expect(state.cliffFeeNumerator.toString()).eq(
        rateLimiter.cliffFeeNumerator.toString()
      );
      expect(state.feeIncrementBps).eq(0);
      expect(state.maxLimiterDuration).eq(0);
      expect(state.maxFeeBps).eq(0);
      expect(state.referenceAmount.toString()).eq("0");

      const event = parseEventInstruction(
        result as TransactionMetadata,
        "evtZeroPoolRateLimiter"
      );
      expect(event).not.null;
      expect(event!.data.pool.toString()).eq(pool.toString());
      expect(event!.data.operator.toString()).eq(
        fixPoolOperator.publicKey.toString()
      );

      const feeAfter = await swapFee(pool, amountIn);
      expect(feeAfter.toString()).eq(feeBefore.toString());
      expect(feeAfter.toString()).eq(amountIn.divn(100).toString());
    });

    it("is a no-op on a pool whose rate limiter parameters are already zero", async () => {
      const pool = await placeholderPool();
      setDeprecatedRateLimiterPool(svm, pool, {
        ...rateLimiter,
        feeIncrementBps: 0,
        maxLimiterDuration: 0,
        maxFeeBps: 0,
        referenceAmount: new BN(0),
      });
      const dataBefore = Buffer.from(svm.getAccount(pool)!.data);

      const result = await zeroPoolRateLimiter(svm, {
        pool,
        whitelistedOperator: fixPoolOperator,
      });
      expect(result).instanceOf(TransactionMetadata);

      const dataAfter = Buffer.from(svm.getAccount(pool)!.data);
      expect(dataAfter.equals(dataBefore)).true;

      const event = parseEventInstruction(
        result as TransactionMetadata,
        "evtZeroPoolRateLimiter"
      );
      expect(event).null;
    });
  });
});
