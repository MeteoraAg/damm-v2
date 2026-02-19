import { generateKpAndFund } from "./helpers/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  InitializeCustomizablePoolParams,
  initializeCustomizablePool,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  createToken,
  updatePoolFeesParameters,
  getDynamicFeeParams,
  getFeeShedulerParams,
  encodePermissions,
  createOperator,
  OperatorPermission,
  DynamicFee,
  getDefaultDynamicFee,
  getPool,
  createCpAmmProgram,
  swapExactIn,
  SwapParams,
  startSvm,
  getCpAmmProgramErrorCode,
  expectThrowsErrorCode,
  warpSlotBy,
  warpTimestampToPassfilterPeriod,
} from "./helpers";
import BN from "bn.js";
import {
  BaseFeeMode,
  decodeFeeMarketCapSchedulerParams,
  decodeFeeRateLimiterParams,
  decodeFeeTimeSchedulerParams,
  encodeFeeMarketCapSchedulerParams,
  encodeFeeRateLimiterParams,
  encodeFeeTimeSchedulerParams,
} from "./helpers/feeCodec";
import { expect } from "chai";
import { LiteSVM } from "litesvm";

describe("Admin update pool fees parameters", () => {
  let svm: LiteSVM;
  let creator: Keypair;
  let admin: Keypair;
  let whitelistedOperator: Keypair;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let program: any;

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedOperator = generateKpAndFund(svm);
    program = createCpAmmProgram();

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    let permission = encodePermissions([OperatorPermission.UpdatePoolFees]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedOperator.publicKey,
      permission,
    });
  });

  it("disable dynamic fee ", async () => {
    const cliffFeeNumerator = new BN(2_500_000);
    const numberOfPeriod = new BN(0);
    const periodFrequency = new BN(0);
    const reductionFactor = new BN(0);

    const poolFeesData = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      BigInt(periodFrequency.toString()),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      poolFeesData,
      getDynamicFeeParams(new BN(2_500_000))
    );
    warpTimestampToPassfilterPeriod(svm, poolAddress);
    // do swap
    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator: null,
      dynamicFee: getDefaultDynamicFee(),
    });

    await swapExactIn(svm, swapParams);

    const poolState = getPool(svm, poolAddress);

    const dynamicFeeStruct = poolState.poolFees.dynamicFee;
    expect(dynamicFeeStruct.initialized).eq(0);
    expect(dynamicFeeStruct.maxVolatilityAccumulator).eq(0);
    expect(dynamicFeeStruct.variableFeeControl).eq(0);
    expect(dynamicFeeStruct.binStep).eq(0);
    expect(dynamicFeeStruct.filterPeriod).eq(0);
    expect(dynamicFeeStruct.decayPeriod).eq(0);
    expect(dynamicFeeStruct.reductionFactor).eq(0);
    expect(dynamicFeeStruct.lastUpdateTimestamp.toNumber()).eq(0);
    expect(dynamicFeeStruct.binStepU128.toNumber()).eq(0);
    expect(dynamicFeeStruct.sqrtPriceReference.toNumber()).eq(0);
    expect(dynamicFeeStruct.volatilityAccumulator.toNumber()).eq(0);
    expect(dynamicFeeStruct.volatilityReference.toNumber()).eq(0);
  });

  it("enable dynamic fee ", async () => {
    const cliffFeeNumerator = new BN(2_500_000);
    const numberOfPeriod = new BN(0);
    const periodFrequency = new BN(0);
    const reductionFactor = new BN(0);

    const poolFeesData = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      BigInt(periodFrequency.toString()),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      poolFeesData,
      null
    );

    warpTimestampToPassfilterPeriod(svm, poolAddress);

    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    const dynamicFee = getDynamicFeeParams(new BN(2_500_000));
    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator: null,
      dynamicFee,
    });

    warpTimestampToPassfilterPeriod(svm, poolAddress);

    await swapExactIn(svm, swapParams);

    let poolState = getPool(svm, poolAddress);

    const dynamicFeeStruct = poolState.poolFees.dynamicFee;
    expect(dynamicFeeStruct.initialized).eq(1);
    expect(dynamicFeeStruct.maxVolatilityAccumulator).eq(
      dynamicFee.maxVolatilityAccumulator
    );
    expect(dynamicFeeStruct.variableFeeControl).eq(
      dynamicFee.variableFeeControl
    );
    expect(dynamicFeeStruct.binStep).eq(dynamicFee.binStep);
    expect(dynamicFeeStruct.filterPeriod).eq(dynamicFee.filterPeriod);
    expect(dynamicFeeStruct.decayPeriod).eq(dynamicFee.decayPeriod);
    expect(dynamicFeeStruct.reductionFactor).eq(dynamicFee.reductionFactor);
    expect(dynamicFeeStruct.binStepU128.toString()).eq(
      dynamicFee.binStepU128.toString()
    );
  });

  it("update new dynamic fee parameters", async () => {
    const cliffFeeNumerator = new BN(2_500_000);
    const numberOfPeriod = new BN(0);
    const periodFrequency = new BN(0);
    const reductionFactor = new BN(0);

    const poolFeesData = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      BigInt(periodFrequency.toString()),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      poolFeesData,
      getDynamicFeeParams(new BN(2_500_000))
    );
    warpTimestampToPassfilterPeriod(svm, poolAddress);
    const newDynamicFeeParams = getDynamicFeeParams(new BN(5_000_000));
    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator: null,
      dynamicFee: newDynamicFeeParams,
    });

    const poolState = getPool(svm, poolAddress);

    const dynamicFeeStruct = poolState.poolFees.dynamicFee;
    expect(dynamicFeeStruct.initialized).eq(1);
    expect(dynamicFeeStruct.maxVolatilityAccumulator).eq(
      newDynamicFeeParams.maxVolatilityAccumulator
    );
    expect(dynamicFeeStruct.variableFeeControl).eq(
      newDynamicFeeParams.variableFeeControl
    );
    expect(dynamicFeeStruct.binStep).eq(newDynamicFeeParams.binStep);
    expect(dynamicFeeStruct.filterPeriod).eq(newDynamicFeeParams.filterPeriod);
    expect(dynamicFeeStruct.decayPeriod).eq(newDynamicFeeParams.decayPeriod);
    expect(dynamicFeeStruct.reductionFactor).eq(
      newDynamicFeeParams.reductionFactor
    );
    expect(dynamicFeeStruct.binStepU128.toString()).eq(
      newDynamicFeeParams.binStepU128.toString()
    );
    expect(dynamicFeeStruct.lastUpdateTimestamp.toNumber()).eq(0);
    expect(dynamicFeeStruct.sqrtPriceReference.toNumber()).eq(0);
    expect(dynamicFeeStruct.volatilityAccumulator.toNumber()).eq(0);
    expect(dynamicFeeStruct.volatilityReference.toNumber()).eq(0);

    // can swap after update
    await swapExactIn(svm, swapParams);
  });

  it("update pool fees for pool with linear fee scheduler", async () => {
    const feeTimeSchedulerParams = getFeeShedulerParams(
      new BN(10_000_000),
      new BN(2_500_000),
      BaseFeeMode.FeeTimeSchedulerLinear,
      10,
      1000
    );
    const poolFeesData = encodeFeeTimeSchedulerParams(
      BigInt(feeTimeSchedulerParams.cliffFeeNumerator.toString()),
      feeTimeSchedulerParams.numberOfPeriod,
      BigInt(feeTimeSchedulerParams.periodFrequency.toString()),
      BigInt(feeTimeSchedulerParams.reductionFactor.toString()),
      feeTimeSchedulerParams.baseFeeMode
    );
    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      poolFeesData,
      null
    );

    // update new cliff fee numerator
    const cliffFeeNumerator = new BN(8_000_000);

    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    const errorCode = getCpAmmProgramErrorCode("CannotUpdateBaseFee");
    const res = await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });
    expectThrowsErrorCode(res, errorCode);

    warpSlotBy(svm, new BN(10000));

    let poolState = getPool(svm, poolAddress);

    const beforeBaseFee = decodeFeeTimeSchedulerParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });
    await swapExactIn(svm, swapParams);
    poolState = getPool(svm, poolAddress);

    const postBaseFee = decodeFeeTimeSchedulerParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    expect(postBaseFee.cliffFeeNumerator.toString()).eq(
      cliffFeeNumerator.toString()
    );
    expect(postBaseFee.numberOfPeriod).eq(beforeBaseFee.numberOfPeriod);
    expect(postBaseFee.periodFrequency.toString()).eq(
      beforeBaseFee.periodFrequency.toString()
    );
    expect(postBaseFee.reductionFactor.toString()).eq(
      beforeBaseFee.reductionFactor.toString()
    );
  });

  it("update pool fees for pool with exponential fee scheduler", async () => {
    const feeSchedulerParams = getFeeShedulerParams(
      new BN(10_000_000),
      new BN(2_500_000),
      BaseFeeMode.FeeTimeSchedulerExponential,
      10,
      1000
    );

    const poolFeesData = encodeFeeTimeSchedulerParams(
      BigInt(feeSchedulerParams.cliffFeeNumerator.toString()),
      feeSchedulerParams.numberOfPeriod,
      BigInt(feeSchedulerParams.periodFrequency.toString()),
      BigInt(feeSchedulerParams.reductionFactor.toString()),
      BaseFeeMode.FeeTimeSchedulerExponential
    );

    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      poolFeesData,
      null
    );

    // update new cliff fee numerator
    const cliffFeeNumerator = new BN(5_000_000);
    const errorCode = getCpAmmProgramErrorCode("CannotUpdateBaseFee");
    const res = await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });
    expectThrowsErrorCode(res, errorCode);

    warpSlotBy(svm, new BN(10000));

    let poolState = getPool(svm, poolAddress);

    const beforeBaseFee = decodeFeeTimeSchedulerParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });

    await swapExactIn(svm, swapParams);

    poolState = getPool(svm, poolAddress);

    const postBaseFee = decodeFeeTimeSchedulerParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    expect(postBaseFee.cliffFeeNumerator.toString()).eq(
      cliffFeeNumerator.toString()
    );
    expect(postBaseFee.numberOfPeriod).eq(beforeBaseFee.numberOfPeriod);
    expect(postBaseFee.periodFrequency.toString()).eq(
      beforeBaseFee.periodFrequency.toString()
    );
    expect(postBaseFee.reductionFactor.toString()).eq(
      beforeBaseFee.reductionFactor.toString()
    );
  });

  it("update pool fees for pool with rate limiter", async () => {
    let referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
    let maxRateLimiterDuration = new BN(10);
    let maxFeeBps = new BN(5000);

    const baseFeeData = encodeFeeRateLimiterParams(
      BigInt(10_000_000),
      10, // feeIncrementBps,
      maxRateLimiterDuration.toNumber(),
      maxFeeBps.toNumber(),
      BigInt(referenceAmount.toString())
    );

    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      baseFeeData,
      null
    );

    // update new cliff fee numerator
    const cliffFeeNumerator = new BN(5_000_000);

    const errorCode = getCpAmmProgramErrorCode("CannotUpdateBaseFee");
    const res = await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });
    expectThrowsErrorCode(res, errorCode);

    warpSlotBy(svm, maxRateLimiterDuration.addn(1));

    let poolState = getPool(svm, poolAddress);

    const beforeBaseFee = decodeFeeRateLimiterParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });

    await swapExactIn(svm, swapParams);

    poolState = getPool(svm, poolAddress);

    const postBaseFee = decodeFeeRateLimiterParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    expect(postBaseFee.cliffFeeNumerator.toString()).eq(
      cliffFeeNumerator.toString()
    );
    expect(postBaseFee.feeIncrementBps).eq(beforeBaseFee.feeIncrementBps);
    expect(postBaseFee.maxFeeBps).eq(beforeBaseFee.maxFeeBps);
    expect(postBaseFee.maxLimiterDuration).eq(beforeBaseFee.maxLimiterDuration);
    expect(postBaseFee.referenceAmount.toString()).eq(
      beforeBaseFee.referenceAmount.toString()
    );
  });

  it("update pool fees for pool with fee market cap scheduler linear", async () => {
    let cliffFeeNumerator = new BN(100_000_000); // 10%
    const numberOfPeriod = 100;
    const priceStepBps = 10;
    const reductionFactor = new BN(10);
    const schedulerExpirationDuration = new BN(3600);
    const baseFeeData = encodeFeeMarketCapSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod,
      priceStepBps,
      schedulerExpirationDuration.toNumber(),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeMarketCapSchedulerLinear
    );

    const poolAddress = await createPool(
      svm,
      creator,
      tokenAMint,
      tokenBMint,
      baseFeeData,
      null
    );

    // update new cliff fee numerator
    cliffFeeNumerator = new BN(5_000_000);
    const dynamicFeeParams = getDynamicFeeParams(cliffFeeNumerator);

    const errorCode = getCpAmmProgramErrorCode("CannotUpdateBaseFee");
    const res = await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: dynamicFeeParams,
    });
    expectThrowsErrorCode(res, errorCode);

    warpSlotBy(svm, schedulerExpirationDuration.addn(1));

    let poolState = getPool(svm, poolAddress);

    const beforeBaseFee = decodeFeeMarketCapSchedulerParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    const swapParams: SwapParams = {
      payer: creator,
      pool: poolAddress,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    await swapExactIn(svm, swapParams);

    await updatePoolFeesParameters(svm, {
      whitelistedOperator,
      pool: poolAddress,
      cliffFeeNumerator,
      dynamicFee: null,
    });

    await swapExactIn(svm, swapParams);

    poolState = getPool(svm, poolAddress);

    const postBaseFee = decodeFeeMarketCapSchedulerParams(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    expect(postBaseFee.cliffFeeNumerator.toString()).eq(
      cliffFeeNumerator.toString()
    );
    expect(postBaseFee.numberOfPeriod).eq(beforeBaseFee.numberOfPeriod);
    expect(postBaseFee.schedulerExpirationDuration).eq(
      beforeBaseFee.schedulerExpirationDuration
    );
    expect(postBaseFee.reductionFactor.toString()).eq(
      beforeBaseFee.reductionFactor.toString()
    );
  });
});

async function createPool(
  svm: LiteSVM,
  creator: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  baseFeeData: Buffer,
  dynamicFee: DynamicFee | null
) {
  const params: InitializeCustomizablePoolParams = {
    payer: creator,
    creator: creator.publicKey,
    tokenAMint,
    tokenBMint,
    liquidity: MIN_LP_AMOUNT,
    sqrtPrice: MIN_SQRT_PRICE.muln(2),
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    hasAlphaVault: false,
    activationPoint: null,
    poolFees: {
      baseFee: {
        data: Array.from(baseFeeData),
      },
      padding: [],
      dynamicFee,
    },
    activationType: 0,
    collectFeeMode: 1,
  };

  const { pool } = await initializeCustomizablePool(svm, params);

  return pool;
}
