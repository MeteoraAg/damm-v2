import { ProgramTestContext } from "solana-bankrun";
import {
  generateKpAndFund,
  randomID,
  startTest,
} from "../bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  swapExactIn,
  SwapParams,
  U64_MAX,
  OFFSET,
  encodePermissions,
  OperatorPermission,
  createOperator,
  swapInstruction,
  swapTestInstruction,
  SwapMode,
  swap2Instruction,
  Swap2Params,
} from "../bankrun-utils";
import BN from "bn.js";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "../bankrun-utils/token2022";
import {
  BaseFeeMode,
  encodeFeeTimeSchedulerParams,
} from "../bankrun-utils/feeCodec";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

describe.only("Pinnochio swap token 2022", () => {
  let context: ProgramTestContext;
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
    const root = Keypair.generate();
    context = await startTest(root);

    const inputTokenMintKeypair = Keypair.generate();
    const outputTokenMintKeypair = Keypair.generate();
    inputTokenMint = inputTokenMintKeypair.publicKey;
    outputTokenMint = outputTokenMintKeypair.publicKey;

    const inputMintExtension = [
      createTransferFeeExtensionWithInstruction(inputTokenMint),
    ];
    const outputMintExtension = [
      createTransferFeeExtensionWithInstruction(outputTokenMint),
    ];
    const extensions = [...inputMintExtension, ...outputMintExtension];
    user = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);
    creator = await generateKpAndFund(context.banksClient, context.payer);
    whitelistedAccount = await generateKpAndFund(
      context.banksClient,
      context.payer
    );

    await createToken2022(
      context.banksClient,
      context.payer,
      inputMintExtension,
      inputTokenMintKeypair
    );
    await createToken2022(
      context.banksClient,
      context.payer,
      outputMintExtension,
      outputTokenMintKeypair
    );

    await mintToToken2022(
      context.banksClient,
      context.payer,
      inputTokenMint,
      context.payer,
      user.publicKey
    );

    await mintToToken2022(
      context.banksClient,
      context.payer,
      outputTokenMint,
      context.payer,
      user.publicKey
    );

    await mintToToken2022(
      context.banksClient,
      context.payer,
      inputTokenMint,
      context.payer,
      creator.publicKey
    );

    await mintToToken2022(
      context.banksClient,
      context.payer,
      outputTokenMint,
      context.payer,
      creator.publicKey
    );

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

    await createOperator(context.banksClient, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createConfigIx(
      context.banksClient,
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

    const result = await initializePool(context.banksClient, initPoolParams);
    pool = result.pool;
    position = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(context.banksClient, addLiquidityParams);
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

    const transaction = await swap2Instruction(context.banksClient, swapParams);
    transaction.recentBlockhash = (
      await context.banksClient.getLatestBlockhash()
    )[0];
    transaction.sign(user);

    const transactionMeta = await context.banksClient.processTransaction(
      transaction
    );
    console.log(transactionMeta);

    ///
    const txTest = await swapTestInstruction(context.banksClient, swapParams);

    txTest.recentBlockhash = (
      await context.banksClient.getLatestBlockhash()
    )[0];
    txTest.sign(user);

    const transactionMeta2 = await context.banksClient.processTransaction(
      txTest
    );
    console.log(transactionMeta2.returnData);
  });
});
