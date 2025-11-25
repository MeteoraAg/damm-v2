import {
  createBurnInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  AccountInfoBytes,
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import CpAmmIDL from "../target/idl/cp_amm.json";
import {
  addLiquidity,
  AddLiquidityParams,
  buildSwapTestTxs,
  CP_AMM_PROGRAM_ID,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  getOrCreateAssociatedTokenAccount,
  getPool,
  getTokenBalance,
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
  Swap2Params,
  SwapMode,
  warpSlotBy,
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import { encodeFeeRateLimiterParams } from "./helpers/feeCodec";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
} from "./helpers/token2022";

describe("Pinnochio swap error code", () => {
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
  let swapParams: Swap2Params;
  let token2022: PublicKey;

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    inputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);
    outputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);
    const mKP = Keypair.generate();
    token2022 = createToken2022(
      svm,
      [createTransferFeeExtensionWithInstruction(mKP.publicKey)],
      mKP,
      admin.publicKey
    );

    mintSplTokenTo(svm, inputTokenMint, admin, creator.publicKey);
    mintSplTokenTo(svm, outputTokenMint, admin, creator.publicKey);
    mintSplTokenTo(svm, inputTokenMint, admin, user.publicKey);
    mintSplTokenTo(svm, outputTokenMint, admin, user.publicKey);

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
      collectFeeMode: 1,
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

    swapParams = {
      payer: user,
      pool,
      inputTokenMint,
      outputTokenMint,
      amount0: new BN(10),
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.ExactIn,
    };
  });

  it("validate pool authority", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const incorrectPoolAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_authority"), PublicKey.default.toBuffer()],
      CP_AMM_PROGRAM_ID
    )[0];

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      poolAuthority: incorrectPoolAuthority,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("validate pool owner", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const info = svm.getAccount(pool);
    const accountInfo: AccountInfoBytes = {
      data: info.data,
      executable: info.executable,
      lamports: info.lamports,
      owner: TOKEN_PROGRAM_ID, // change owner to token program id
    };

    svm.setAccount(pool, accountInfo);

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("pool constraint token a vault", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault: tokenBVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("pool constraint token b vault", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault: tokenAVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("input token account is not initialize", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );

    const tx = new Transaction().add(
      ...[
        createBurnInstruction(
          inputTokenAccount,
          tokenAMint,
          user.publicKey,
          BigInt(getTokenBalance(svm, inputTokenAccount).toString())
        ),
        createCloseAccountInstruction(
          inputTokenAccount,
          user.publicKey,
          user.publicKey
        ),
      ]
    );
    const res = sendTransaction(svm, tx, [user]);
    expect(res).instanceOf(TransactionMetadata);

    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("input token account wrong owner", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getOrCreateAssociatedTokenAccount(
      svm,
      user,
      token2022,
      user.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("output token account is not initialize", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );

    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const tx = new Transaction().add(
      ...[
        createBurnInstruction(
          outputTokenAccount,
          tokenBMint,
          user.publicKey,
          BigInt(getTokenBalance(svm, outputTokenAccount).toString())
        ),
        createCloseAccountInstruction(
          outputTokenAccount,
          user.publicKey,
          user.publicKey
        ),
      ]
    );
    const res = sendTransaction(svm, tx, [user]);
    expect(res).instanceOf(TransactionMetadata);

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("output token account wrong owner", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const outputTokenAccount = getOrCreateAssociatedTokenAccount(
      svm,
      user,
      token2022,
      user.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("token A vault owner not match with tokenAProgram", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_2022_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("token B vault owner not match with tokenBProgram", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_2022_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("token A mint is wrong", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint: tokenBMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("token B mint is wrong", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint: tokenAMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("event authority is wrong", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      eventAuthority: CP_AMM_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("programs are wrong but txs are still sucessful", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      programPk: user.publicKey,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    expect(swapResult).instanceOf(TransactionMetadata);
    expect(swapPinocchioResult).instanceOf(TransactionMetadata);

  });

  it("sysvar is wrong", async () => {
    const poolState = getPool(svm, pool);
    warpSlotBy(svm, poolState.activationPoint.addn(1));
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      sysvarInstructionPubkey: CP_AMM_PROGRAM_ID,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("referral account owner wrong", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralAccount: user.publicKey,
    });

    const swapResult = sendTransaction(svm, swapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, swapPinocchioTx, [user]);

    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("dezerializer parameters error code", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    // modify swap test instruction
    const swapTestData = Array.from(swapTestTx.instructions[0].data);
    let newIx = swapTestTx.instructions[0];
    newIx.data = Buffer.concat([
      Buffer.from(swapTestData.slice(0, 8)),
      Buffer.from(swapTestData.slice(10)),
    ]);
    const newSwapTestTx = new Transaction().add(
      new TransactionInstruction(swapTestTx.instructions[0])
    );

    // modify pinocchio swap test instruction
    const pinocSwapData = Array.from(swapPinocchioTx.instructions[0].data);
    let newPinoIx = swapPinocchioTx.instructions[0];
    newPinoIx.data = Buffer.concat([
      Buffer.from(
        CpAmmIDL.instructions.find((item) => item.name == "swap").discriminator
      ),
      Buffer.from(pinocSwapData.slice(10)),
    ]);
    const newSwapPinocchioTx = new Transaction().add(
      new TransactionInstruction(swapPinocchioTx.instructions[0])
    );

    const swapResult = sendTransaction(svm, newSwapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, newSwapPinocchioTx, [
      user,
    ]);
    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });

  it("dezerializer parameters2 error code", async () => {
    const poolState = getPool(svm, pool);
    const { tokenAMint, tokenBMint, tokenAVault, tokenBVault } = poolState;

    const inputTokenAccount = getAssociatedTokenAddressSync(
      tokenAMint,
      user.publicKey
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      tokenBMint,
      user.publicKey
    );

    const { swapTestTx, swapPinocchioTx } = await buildSwapTestTxs({
      payer: user.publicKey,
      pool,
      tokenAMint,
      tokenBMint,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      amount0: new BN(10),
      amount1: new BN(0),
      swapMode: SwapMode.ExactIn,
    });

    // modify swap test instruction
    const swapTestData = Array.from(swapTestTx.instructions[0].data);
    let newIx = swapTestTx.instructions[0];
    newIx.data = Buffer.concat([
      Buffer.from(swapTestData.slice(0, 8)),
      Buffer.from(swapTestData.slice(10)),
    ]);
    const newSwapTestTx = new Transaction().add(
      new TransactionInstruction(swapTestTx.instructions[0])
    );

    // modify pinocchio swap test instruction
    const pinocSwapData = Array.from(swapPinocchioTx.instructions[0].data);
    let newPinoIx = swapPinocchioTx.instructions[0];
    newPinoIx.data = Buffer.concat([
      Buffer.from(pinocSwapData.slice(0, 8)),
      Buffer.from(pinocSwapData.slice(10)),
    ]);
    const newSwapPinocchioTx = new Transaction().add(
      new TransactionInstruction(swapPinocchioTx.instructions[0])
    );

    const swapResult = sendTransaction(svm, newSwapTestTx, [user]);

    const swapPinocchioResult = sendTransaction(svm, newSwapPinocchioTx, [
      user,
    ]);
    assertErrorCode(
      swapResult as FailedTransactionMetadata,
      swapPinocchioResult as FailedTransactionMetadata
    );
  });
});

export function assertErrorCode(
  metadata1: FailedTransactionMetadata,
  metadata2: FailedTransactionMetadata,
  debug?: boolean,
) {
  if (debug) {
    console.log(metadata1);
    console.log(metadata2);
    console.log(metadata1.meta().logs());
    console.log(metadata2.meta().logs());
  }

  // @ts-ignore
  const errorCode1 = metadata1.err().err().code;
  // @ts-ignore
  const errorCode2 = metadata2.err().err().code;
  expect(errorCode1).not.to.be.null;
  expect(errorCode2).not.to.be.null;
  expect(errorCode1).eq(errorCode2);
}
