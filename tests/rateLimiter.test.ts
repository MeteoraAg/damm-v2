import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  CreateConfigParams,
  InitializeCustomizablePoolParams,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  createConfigIx,
  createToken,
  getCpAmmProgramErrorCodeHexString,
  getPool,
  initializeCustomizablePool,
  initializePool,
  mintSplTokenTo,
  swapExactIn,
  swapInstruction,
  OperatorPermission,
  encodePermissions,
  createOperator,
  generateKpAndFund,
  startTest,
  randomID,
  warpSlotBy,
  processTransactionMaybeThrow,
  expectThrowsAsync,
} from "./bankrun-utils";
import { encodeFeeRateLimiterParams } from "./bankrun-utils/feeCodec";

describe("Rate limiter", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let whitelistedAccount: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let tokenA: PublicKey;
  let tokenB: PublicKey;

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);
    admin = context.payer;
    operator = await generateKpAndFund(context.banksClient, context.payer);
    partner = await generateKpAndFund(context.banksClient, context.payer);
    user = await generateKpAndFund(context.banksClient, context.payer);
    poolCreator = await generateKpAndFund(context.banksClient, context.payer);
    whitelistedAccount = await generateKpAndFund(
      context.banksClient,
      context.payer
    );

    tokenA = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );
    tokenB = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenA,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenB,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenA,
      context.payer,
      poolCreator.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenB,
      context.payer,
      poolCreator.publicKey
    );
  });

  it("Rate limiter", async () => {
    const referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
    const maxRateLimiterDuration = new BN(10);
    const maxFeeBps = new BN(5000);

    const cliffFeeNumerator = new BN(10_000_000);
    const feeIncrementBps = 10;

    const data = encodeFeeRateLimiterParams(
      BigInt(cliffFeeNumerator.toString()),
      feeIncrementBps,
      maxRateLimiterDuration.toNumber(),
      maxFeeBps.toNumber(),
      BigInt(referenceAmount.toString())
    );

    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 1, // onlyB
    };

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(context.banksClient, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    let config = await createConfigIx(
      context.banksClient,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );
    const liquidity = new BN(MIN_LP_AMOUNT);
    const sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

    const initPoolParams: InitializePoolParams = {
      payer: poolCreator,
      creator: poolCreator.publicKey,
      config,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };
    const { pool } = await initializePool(context.banksClient, initPoolParams);
    let poolState = await getPool(context.banksClient, pool);

    // swap with 1 SOL

    await swapExactIn(context.banksClient, {
      payer: poolCreator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount,
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(context.banksClient, pool);

    let totalTradingFee = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );

    expect(totalTradingFee.toNumber()).eq(
      referenceAmount.div(new BN(100)).toNumber()
    );

    // swap with 2 SOL

    await swapExactIn(context.banksClient, {
      payer: poolCreator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount.mul(new BN(2)),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(context.banksClient, pool);

    let totalTradingFee1 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee = totalTradingFee1.sub(totalTradingFee);

    expect(deltaTradingFee.toNumber()).gt(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );

    // wait until time pass the 10 slot
    await warpSlotBy(context, maxRateLimiterDuration.add(new BN(1)));

    // swap with 2 SOL

    await swapExactIn(context.banksClient, {
      payer: poolCreator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: referenceAmount.mul(new BN(2)),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(context.banksClient, pool);

    let totalTradingFee2 = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );
    let deltaTradingFee1 = totalTradingFee2.sub(totalTradingFee1);
    expect(deltaTradingFee1.toNumber()).eq(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );
  });
  it("Try to send multiple instructions", async () => {
    const referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
    const maxRateLimiterDuration = new BN(10);
    const maxFeeBps = new BN(5000);

    const liquidity = new BN(MIN_LP_AMOUNT);
    const sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

    const cliffFeeNumerator = new BN(10_000_000);
    const feeIncrementBps = 10;

    const data = encodeFeeRateLimiterParams(
      BigInt(cliffFeeNumerator.toString()),
      feeIncrementBps,
      maxRateLimiterDuration.toNumber(),
      maxFeeBps.toNumber(),
      BigInt(referenceAmount.toString())
    );

    const initPoolParams: InitializeCustomizablePoolParams = {
      payer: poolCreator,
      creator: poolCreator.publicKey,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      liquidity,
      sqrtPrice,
      hasAlphaVault: false,
      activationType: 0,
      collectFeeMode: 1, // onlyB
      activationPoint: null,
    };
    const { pool } = await initializeCustomizablePool(
      context.banksClient,
      initPoolParams
    );

    // swap with 1 SOL
    const swapIx = await swapInstruction(context.banksClient, {
      payer: poolCreator,
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

    transaction.recentBlockhash = (
      await context.banksClient.getLatestBlockhash()
    )[0];
    transaction.sign(poolCreator);

    const errorCode = getCpAmmProgramErrorCodeHexString(
      "FailToValidateSingleSwapInstruction"
    );
    await expectThrowsAsync(async () => {
      await processTransactionMaybeThrow(context.banksClient, transaction);
    }, errorCode);
  });
});
