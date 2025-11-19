import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { LiteSVM } from "litesvm";
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
  sendTransaction,
  startSvm,
  swap2Instruction,
  Swap2Params,
  SwapMode,
  swapTestInstruction,
} from "../helpers";
import { generateKpAndFund, randomID } from "../helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "../helpers/feeCodec";

describe.only("Pinnochio swap error code", () => {
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

  it("Event swap", async () => {
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
  });
});
