import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { AccountInfoBytes, FailedTransactionMetadata, LiteSVM } from "litesvm";
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
  getPool,
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

  it("pool owner is wrong", async () => {
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

  it("token A vault is wrong", async () => {
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

  it("token B vault is wrong", async () => {
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
});

export function assertErrorCode(
  metadata1: FailedTransactionMetadata,
  metadata2: FailedTransactionMetadata
) {
  // console.log(metadata1.meta().logs());
  // console.log(metadata2.meta().logs());
  // @ts-ignore
  const errorCode1 = metadata1.err().err().code;
  // @ts-ignore
  const errorCode2 = metadata2.err().err().code;

  expect(errorCode1).not.to.be.null;
  expect(errorCode2).not.to.be.null;
  expect(errorCode1).eq(errorCode2);
}
