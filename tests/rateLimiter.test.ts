import {
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
  randomID,
  warpSlotBy,
  startSvm,
  getCpAmmProgramErrorCode,
  sendTransaction,
  expectThrowsErrorCode,
} from "./helpers";
import { encodeFeeRateLimiterParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Rate limiter", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let whitelistedAccount: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let tokenA: PublicKey;
  let tokenB: PublicKey;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    operator = generateKpAndFund(svm);
    partner = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    poolCreator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenA = createToken(svm, admin.publicKey);
    tokenB = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenA, admin, user.publicKey);

    mintSplTokenTo(svm, tokenB, admin, user.publicKey);

    mintSplTokenTo(svm, tokenA, admin, poolCreator.publicKey);

    mintSplTokenTo(svm, tokenB, admin, poolCreator.publicKey);
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
    const { pool } = await initializePool(svm, initPoolParams);
    let poolState = await getPool(svm, pool);

    // swap with 1 SOL

    await swapExactIn(svm, {
      payer: poolCreator,
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
      payer: poolCreator,
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
      payer: poolCreator,
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
    const { pool } = await initializeCustomizablePool(svm, initPoolParams);

    // swap with 1 SOL
    const swapIx = await swapInstruction(svm, {
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

    const errorCode = getCpAmmProgramErrorCode(
      "FailToValidateSingleSwapInstruction"
    );
    const result = sendTransaction(svm, transaction, [poolCreator]);
    expectThrowsErrorCode(result, errorCode);
  });
});
