import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OFFSET,
  OperatorPermission,
  parseEventInstruction,
  sendTransaction,
  startSvm,
  swap2Instruction,
  Swap2Params,
  SwapMode,
  swapTestInstruction,
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

describe("Pinnochio swap", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;

  let inputTokenMint: PublicKey;
  let outputTokenMint: PublicKey;

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    inputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);
    outputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);

    mintSplTokenTo(svm, inputTokenMint, admin, creator.publicKey);
    mintSplTokenTo(svm, outputTokenMint, admin, creator.publicKey);
    mintSplTokenTo(svm, inputTokenMint, admin, user.publicKey);
    mintSplTokenTo(svm, outputTokenMint, admin, user.publicKey);

    const cliffFeeNumerator = new BN(2_500_000);
    const numberOfPeriod = new BN(0);
    const periodFrequency = new BN(0);
    const reductionFactor = new BN(0);

    const data = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      BigInt(periodFrequency.toString()),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

    // create config
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
      collectFeeMode: 0,
    };

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(1).shln(OFFSET);

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint: inputTokenMint,
      tokenBMint: outputTokenMint,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };

    const result = await initializePool(svm, initPoolParams);
    pool = result.pool;
    position = await createPosition(svm, user, user.publicKey, pool);

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(svm, addLiquidityParams);
  });

  it("Swap event parsing backward compatible", async () => {
    const swapParams: Swap2Params = {
      payer: user,
      pool,
      inputTokenMint,
      outputTokenMint,
      amount0: new BN(10),
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.ExactIn,
    };

    const txSwapPinocchio = await swap2Instruction(svm, swapParams);

    const metadata1 = sendTransaction(svm, txSwapPinocchio, [user]);
    //
    const txSwapTest = await swapTestInstruction(svm, swapParams);

    const metadata2 = sendTransaction(svm, txSwapTest, [user]);

    expect(metadata1).instanceOf(TransactionMetadata);
    expect(metadata2).instanceOf(TransactionMetadata);

    const event1 = parseEventInstruction(
      metadata1 as TransactionMetadata,
      "evtSwap2"
    );

    const event2 = parseEventInstruction(
      metadata2 as TransactionMetadata,
      "evtSwap2"
    );

    expect(event1).not.to.be.null;
    expect(event2).not.to.be.null;

    // check layout decoded
    expect(
      JSON.stringify(Object.keys(event1.data)) ===
        JSON.stringify(Object.keys(event2.data))
    ).to.be.true;

    expect(event1.data.pool.toString()).eq(event2.data.pool.toString());
    expect(event1.data.tradeDirection).eq(event2.data.tradeDirection);
    expect(event1.data.collectFeeMode).eq(event2.data.collectFeeMode);
    expect(event1.data.hasReferral).eq(event2.data.hasReferral);
    // params
    expect(event1.data.params.amount0.toString()).eq(
      event2.data.params.amount0.toString()
    );

    expect(event1.data.params.amount1.toString()).eq(
      event2.data.params.amount1.toString()
    );

    expect(event1.data.params.swapMode.toString()).eq(
      event2.data.params.swapMode.toString()
    );

    expect(event2.data.includedTransferFeeAmountIn).not.undefined;
    expect(event2.data.includedTransferFeeAmountOut).not.undefined;
    expect(event2.data.excludedTransferFeeAmountOut).not.undefined;
    expect(event2.data.currentTimestamp).not.undefined;
    expect(event2.data.reserveAAmount).not.undefined;
    expect(event2.data.reserveBAmount).not.undefined;
    // swap result
    expect(event2.data.swapResult).not.undefined;
    expect(event2.data.swapResult.includedFeeInputAmount).not.undefined;
    expect(event2.data.swapResult.excludedFeeInputAmount).not.undefined;
    expect(event2.data.swapResult.amountLeft).not.undefined;
    expect(event2.data.swapResult.outputAmount).not.undefined;
    expect(event2.data.swapResult.nextSqrtPrice).not.undefined;
    expect(event2.data.swapResult.tradingFee).not.undefined;
    expect(event2.data.swapResult.protocolFee).not.undefined;
    expect(event2.data.swapResult.partnerFee).not.undefined;
    expect(event2.data.swapResult.referralFee).not.undefined;
  });

  it("Swap event parsing backward compatible", async () => {
    const swapParams: Swap2Params = {
      payer: user,
      pool,
      inputTokenMint,
      outputTokenMint,
      amount0: new BN(100000),
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.ExactIn,
    };

    const txSwapPinocchio = await swap2Instruction(svm, swapParams);

    const swapPinocchioResult = sendTransaction(svm, txSwapPinocchio, [
      user,
    ]) as TransactionMetadata;
    //
    const txSwapTest = await swapTestInstruction(svm, swapParams);

    const swapResult = sendTransaction(svm, txSwapTest, [
      user,
    ]) as TransactionMetadata;

    const pinocchioCUsConsumed = swapPinocchioResult
      .computeUnitsConsumed()
      .toString();
    const swapCUsConsumed = swapResult.computeUnitsConsumed().toString();

    // { pinocchioCUsConsumed: '26_756', swapCUsConsumed: '44_933' }
    console.log({
      pinocchioCUsConsumed,
      swapCUsConsumed,
    });
  });
});
