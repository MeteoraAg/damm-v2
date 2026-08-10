import {
  AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  CreateConfigParams,
  InitializeCustomizablePoolParams,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  createConfigIx,
  createToken,
  createTokenBadge,
  getPool,
  initializeCustomizablePool,
  initializePool,
  initializePool2,
  mintSplTokenTo,
  swapExactIn,
  swapInstruction,
  swap3,
  swap3Instruction,
  SwapMode,
  OperatorPermission,
  encodePermissions,
  createOperator,
  generateKpAndFund,
  randomID,
  warpSlotBy,
  startSvm,
  getCpAmmProgramErrorCode,
  sendTransaction,
  expectThrowsErrorCode,
} from "./helpers";
import {
  BaseFeeMode,
  decodePodAlignedFeeRateLimiter,
  encodeFeeTimeSchedulerParams,
} from "./helpers/feeCodec";
import {
  setDeprecatedRateLimiterPool,
  RateLimiterParams,
} from "./helpers/deprecatedRateLimiter";
import {
  createToken2022,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import {
  createExtraAccountMetaListAndCounter,
  getHookRemainingAccounts,
  readHookCounter,
} from "./helpers/transferHook";
import { LiteSVM } from "litesvm";

// Creating a pool with BaseFeeMode::RateLimiter is rejected as of cp_amm 0.2.3.
// Pools that predate the deprecation keep working, so every fixture here is
// set onto a pool created with a non-deprecated base fee mode. The fee
// assertions are unchanged from when these pools could be created directly.
describe("Rate limiter", () => {
  const referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
  const maxRateLimiterDuration = new BN(10);
  const maxFeeBps = new BN(5000);
  const cliffFeeNumerator = new BN(10_000_000);
  const feeIncrementBps = 10;

  const rateLimiter: RateLimiterParams = {
    cliffFeeNumerator,
    feeIncrementBps,
    maxLimiterDuration: maxRateLimiterDuration.toNumber(),
    maxFeeBps: maxFeeBps.toNumber(),
    referenceAmount,
  };

  let svm: LiteSVM;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
  let user: Keypair;
  let creator: Keypair;
  let tokenA: PublicKey;
  let tokenB: PublicKey;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenA = createToken(svm, admin.publicKey);
    tokenB = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenA, admin, user.publicKey);

    mintSplTokenTo(svm, tokenB, admin, user.publicKey);

    mintSplTokenTo(svm, tokenA, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenB, admin, creator.publicKey);
  });

  // placeholder only. the pool is later overriden as a rate limiter pool
  function placeholderBaseFee(): Buffer {
    return encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
  }

  function poolFees(data: Buffer) {
    return {
      baseFee: { data: Array.from(data) },
      compoundingFeeBps: 0,
      padding: 0,
      dynamicFee: null,
    };
  }

  async function deprecatedRateLimiterPoolFromConfig(): Promise<PublicKey> {
    const createConfigParams: CreateConfigParams = {
      poolFees: poolFees(placeholderBaseFee()),
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 1, // onlyB
    };

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    let config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
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

    setDeprecatedRateLimiterPool(svm, pool, rateLimiter);

    return pool;
  }

  async function deprecatedRateLimiterCustomizablePool(): Promise<PublicKey> {
    const initPoolParams: InitializeCustomizablePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      poolFees: poolFees(placeholderBaseFee()),
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
      hasAlphaVault: false,
      activationType: 0,
      collectFeeMode: 1, // onlyB
      activationPoint: null,
    };
    const { pool } = await initializeCustomizablePool(svm, initPoolParams);

    setDeprecatedRateLimiterPool(svm, pool, rateLimiter);

    return pool;
  }

  it("deprecated pool exposes its rate limiter parameters", async () => {
    const pool = await deprecatedRateLimiterPoolFromConfig();

    const poolState = getPool(svm, pool);
    const rateLimiterState = decodePodAlignedFeeRateLimiter(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    expect(rateLimiterState.baseFeeMode).eq(BaseFeeMode.RateLimiter);
    expect(rateLimiterState.cliffFeeNumerator.toString()).eq(
      cliffFeeNumerator.toString()
    );
    expect(rateLimiterState.feeIncrementBps).eq(feeIncrementBps);
    expect(rateLimiterState.maxLimiterDuration).eq(
      maxRateLimiterDuration.toNumber()
    );
    expect(rateLimiterState.maxFeeBps).eq(maxFeeBps.toNumber());
    expect(rateLimiterState.referenceAmount.toString()).eq(
      referenceAmount.toString()
    );
  });

  it("Rate limiter", async () => {
    const pool = await deprecatedRateLimiterPoolFromConfig();
    let poolState = await getPool(svm, pool);

    // swap with 1 SOL

    await swapExactIn(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount,
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = getPool(svm, pool);

    let totalTradingFee = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );

    expect(totalTradingFee.toNumber()).eq(
      referenceAmount.div(new BN(100)).toNumber()
    );

    // swap with 2 SOL

    await swapExactIn(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount.mul(new BN(2)),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(svm, pool);

    let totalTradingFee1 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee = totalTradingFee1.sub(totalTradingFee);

    expect(deltaTradingFee.toNumber()).gt(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );

    // wait until time pass the 10 slot
    warpSlotBy(svm, maxRateLimiterDuration.add(new BN(1)));

    // swap with 2 SOL

    await swapExactIn(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount.mul(new BN(2)),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(svm, pool);

    let totalTradingFee2 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee1 = totalTradingFee2.sub(totalTradingFee1);
    expect(deltaTradingFee1.toNumber()).eq(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );
  });

  it("Try to send multiple instructions", async () => {
    const pool = await deprecatedRateLimiterCustomizablePool();

    // swap with 1 SOL
    const swapIx = await swapInstruction(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount,
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    let transaction = new Transaction();
    for (let i = 0; i < 2; i++) {
      transaction.add(swapIx);
    }

    const errorCode = getCpAmmProgramErrorCode(
      "FailToValidateSingleSwapInstruction"
    );
    const result = sendTransaction(svm, transaction, [creator]);
    expectThrowsErrorCode(result, errorCode);
  });

  it("Rate limiter with swap3", async () => {
    const pool = await deprecatedRateLimiterPoolFromConfig();
    let poolState = await getPool(svm, pool);

    // swap with 1 SOL

    await swap3(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amount0: referenceAmount,
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
      includeInstructionsSysvar: true,
    });

    poolState = getPool(svm, pool);

    let totalTradingFee = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );

    expect(totalTradingFee.toNumber()).eq(
      referenceAmount.div(new BN(100)).toNumber()
    );

    // swap with 2 SOL

    await swap3(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amount0: referenceAmount.mul(new BN(2)),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
      includeInstructionsSysvar: true,
    });

    poolState = await getPool(svm, pool);

    let totalTradingFee1 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee = totalTradingFee1.sub(totalTradingFee);

    expect(deltaTradingFee.toNumber()).gt(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );

    // wait until time pass the 10 slot
    warpSlotBy(svm, maxRateLimiterDuration.add(new BN(1)));

    // swap with 2 SOL

    await swap3(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amount0: referenceAmount.mul(new BN(2)),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
      includeInstructionsSysvar: true,
    });

    poolState = await getPool(svm, pool);

    let totalTradingFee2 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee1 = totalTradingFee2.sub(totalTradingFee1);
    expect(deltaTradingFee1.toNumber()).eq(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );
  });

  it("swap3 fails without the instructions sysvar while the rate limiter is active", async () => {
    const pool = await deprecatedRateLimiterPoolFromConfig();

    const transaction = await swap3Instruction(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amount0: referenceAmount,
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });

    const errorCode = getCpAmmProgramErrorCode(
      "FailToValidateSingleSwapInstruction"
    );
    const result = sendTransaction(svm, transaction, [creator]);
    expectThrowsErrorCode(result, errorCode);
  });

  it("Try to send multiple swap3 instructions", async () => {
    const pool = await deprecatedRateLimiterCustomizablePool();

    // swap with 1 SOL
    const swapIx = await swap3Instruction(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amount0: referenceAmount,
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
      includeInstructionsSysvar: true,
    });

    let transaction = new Transaction();
    for (let i = 0; i < 2; i++) {
      transaction.add(swapIx);
    }

    const errorCode = getCpAmmProgramErrorCode(
      "FailToValidateSingleSwapInstruction"
    );
    const result = sendTransaction(svm, transaction, [creator]);
    expectThrowsErrorCode(result, errorCode);
  });

  it("Rate limiter with swap3 on a transfer hook pool", async () => {
    // the instructions sysvar goes at remaining accounts index 0, followed by the transfer hook slices
    const tokenAMintKeypair = Keypair.generate();
    const tokenBMintKeypair = Keypair.generate();
    const hookTokenA = tokenAMintKeypair.publicKey;
    const hookTokenB = tokenBMintKeypair.publicKey;

    await createToken2022(
      svm,
      [createTransferHookExtensionWithInstruction(hookTokenA, admin.publicKey)],
      tokenAMintKeypair,
      admin.publicKey
    );
    await createToken2022(
      svm,
      [createTransferHookExtensionWithInstruction(hookTokenB, admin.publicKey)],
      tokenBMintKeypair,
      admin.publicKey
    );

    await createExtraAccountMetaListAndCounter(svm, admin, hookTokenA);
    await createExtraAccountMetaListAndCounter(svm, admin, hookTokenB);

    const tokenAHookAccounts: AccountMeta[] =
      getHookRemainingAccounts(hookTokenA);
    const tokenBHookAccounts: AccountMeta[] =
      getHookRemainingAccounts(hookTokenB);

    await mintToToken2022(svm, hookTokenA, admin, creator.publicKey);
    await mintToToken2022(svm, hookTokenB, admin, creator.publicKey);

    const createConfigParams: CreateConfigParams = {
      poolFees: poolFees(placeholderBaseFee()),
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 1, // onlyB
    };

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.CreateTokenBadge,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    let config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );

    // active hook mints require a token badge for pool creation
    await createTokenBadge(svm, {
      tokenMint: hookTokenA,
      whitelistedAddress: whitelistedAccount,
    });
    await createTokenBadge(svm, {
      tokenMint: hookTokenB,
      whitelistedAddress: whitelistedAccount,
    });

    const { pool } = await initializePool2(svm, {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint: hookTokenA,
      tokenBMint: hookTokenB,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
      activationPoint: null,
      tokenAHookAccounts,
      tokenBHookAccounts,
    });

    setDeprecatedRateLimiterPool(svm, pool, rateLimiter);

    const beforeCounterA = readHookCounter(svm, hookTokenA);
    const beforeCounterB = readHookCounter(svm, hookTokenB);

    // swap with 1 SOL

    await swap3(svm, {
      payer: creator,
      pool,
      inputTokenMint: hookTokenB,
      outputTokenMint: hookTokenA,
      amount0: referenceAmount,
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
      tokenAHookAccounts,
      tokenBHookAccounts,
      includeInstructionsSysvar: true,
    });

    let poolState = getPool(svm, pool);

    let totalTradingFee = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );

    expect(totalTradingFee.toNumber()).eq(
      referenceAmount.div(new BN(100)).toNumber()
    );

    // one user->vault transfer of B, one vault->user transfer of A
    expect(readHookCounter(svm, hookTokenA)).eq(beforeCounterA + 1);
    expect(readHookCounter(svm, hookTokenB)).eq(beforeCounterB + 1);

    // swap with 2 SOL

    await swap3(svm, {
      payer: creator,
      pool,
      inputTokenMint: hookTokenB,
      outputTokenMint: hookTokenA,
      amount0: referenceAmount.mul(new BN(2)),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
      tokenAHookAccounts,
      tokenBHookAccounts,
      includeInstructionsSysvar: true,
    });

    poolState = getPool(svm, pool);

    let totalTradingFee1 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee = totalTradingFee1.sub(totalTradingFee);

    expect(deltaTradingFee.toNumber()).gt(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );

    expect(readHookCounter(svm, hookTokenA)).eq(beforeCounterA + 2);
    expect(readHookCounter(svm, hookTokenB)).eq(beforeCounterB + 2);
  });
});
