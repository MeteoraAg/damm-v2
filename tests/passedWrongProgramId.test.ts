import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  addLiquidity,
  AddLiquidityParams,
  CP_AMM_PROGRAM_ID,
  createConfigIx,
  CreateConfigParams,
  createCpAmmProgram,
  createPosition,
  createToken,
  derivePoolAuthority,
  getPool,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
} from "./bankrun-utils";
import {
  convertToByteArray,
  generateKpAndFund,
  processTransactionMaybeThrow,
  randomID,
  startTest,
} from "./bankrun-utils/common";

describe.only("Passed wrong program id still work", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let user: Keypair;
  let creator: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;
  let inputTokenMint: PublicKey;
  let outputTokenMint: PublicKey;
  const program = createCpAmmProgram();

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);

    user = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);
    creator = await generateKpAndFund(context.banksClient, context.payer);

    inputTokenMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );
    outputTokenMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      inputTokenMint,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      outputTokenMint,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      inputTokenMint,
      context.payer,
      creator.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      outputTokenMint,
      context.payer,
      creator.publicKey
    );

    // create config
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          cliffFeeNumerator: new BN(2_500_000),
          firstFactor: 0,
          secondFactor: convertToByteArray(new BN(0)),
          thirdFactor: new BN(0),
          baseFeeMode: 0,
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

    config = await createConfigIx(
      context.banksClient,
      admin,
      new BN(randomID()),
      createConfigParams
    );

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

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

  it("Passed wrong program id still work", async () => {
    const poolState = await getPool(context.banksClient, pool);

    const poolAuthority = derivePoolAuthority();
    const inputTokenAccount = getAssociatedTokenAddressSync(
      inputTokenMint,
      user.publicKey,
      true,
      TOKEN_PROGRAM_ID
    );
    const outputTokenAccount = getAssociatedTokenAddressSync(
      outputTokenMint,
      user.publicKey,
      true,
      TOKEN_PROGRAM_ID
    );
    const tokenAVault = poolState.tokenAVault;
    const tokenBVault = poolState.tokenBVault;
    const tokenAMint = poolState.tokenAMint;
    const tokenBMint = poolState.tokenBMint;

    const fakeProgramId = Keypair.generate().publicKey;
    console.log("fake program id: ", fakeProgramId.toString());

    const transaction = await program.methods
      .swap({
        amountIn: new BN(10),
        minimumAmountOut: new BN(0),
      })
      .accountsStrict({
        poolAuthority,
        pool,
        payer: user.publicKey,
        inputTokenAccount,
        outputTokenAccount,
        tokenAVault,
        tokenBVault,
        tokenAProgram: TOKEN_PROGRAM_ID,
        tokenBProgram: TOKEN_PROGRAM_ID,
        tokenAMint,
        tokenBMint,
        referralTokenAccount: null,
        program: fakeProgramId,
        eventAuthority: PublicKey.findProgramAddressSync(
          [Buffer.from("__event_authority")],
          CP_AMM_PROGRAM_ID
        )[0],
      })
      .transaction();

    transaction.recentBlockhash = (
      await context.banksClient.getLatestBlockhash()
    )[0];
    transaction.sign(user);

    await processTransactionMaybeThrow(context.banksClient, transaction);
  });
});
