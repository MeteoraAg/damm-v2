import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";
import Decimal from "decimal.js";
import { LiteSVM } from "litesvm";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  DECIMALS,
  deriveOperatorAddress,
  encodePermissions,
  generateKpAndFund,
  getOrCreateAssociatedTokenAccount,
  getPool,
  getTokenAccount,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  randomID,
  startSvm,
  swapExactIn,
  SwapParams,
  TREASURY,
  zapProtocolFee,
} from "./helpers";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  buildZapOutDammV2Instruction,
  buildZapOutJupV6UsingDammV2RouteInstruction,
  buildZapOutJupV6UsingDammV2SharedRouteInstruction,
  createCustomizableDammV2Pool,
  jupProgramAuthority,
} from "./helpers/zapUtils";

describe.only("Zap protocol fees", () => {
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
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

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

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.ZapProtocolFee,
    ]);

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
    sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
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

    const swapParams: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams);

    const swapParams2: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenBMint,
      outputTokenMint: tokenAMint,
      amountIn: new BN(10000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams2);
    await swapExactIn(svm, swapParams);
    await swapExactIn(svm, swapParams2);

    getOrCreateAssociatedTokenAccount(svm, admin, tokenAMint, TREASURY);
    getOrCreateAssociatedTokenAccount(svm, admin, tokenBMint, TREASURY);
    getOrCreateAssociatedTokenAccount(
      svm,
      admin,
      tokenAMint,
      whitelistedAccount.publicKey
    );
    getOrCreateAssociatedTokenAccount(
      svm,
      admin,
      tokenBMint,
      whitelistedAccount.publicKey
    );

    getOrCreateAssociatedTokenAccount(
      svm,
      admin,
      tokenAMint,
      jupProgramAuthority[0]
    );
    getOrCreateAssociatedTokenAccount(
      svm,
      admin,
      tokenBMint,
      jupProgramAuthority[0]
    );

    getOrCreateAssociatedTokenAccount(
      svm,
      admin,
      NATIVE_MINT,
      creator.publicKey
    );
    getOrCreateAssociatedTokenAccount(
      svm,
      admin,
      NATIVE_MINT,
      jupProgramAuthority[0]
    );

    getOrCreateAssociatedTokenAccount(svm, admin, NATIVE_MINT, TREASURY);
  });

  describe("ZapOut protocol fees via DAMM V2)", () => {
    const price = new Decimal(1);

    const sqrtPrice = price.sqrt();
    const sqrtPriceX64 = new BN(
      sqrtPrice.mul(new Decimal(2).pow(64)).floor().toString()
    );
    it("Zap protocol fee tokenA to token SOL", async () => {
      const isClaimTokenA = true;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        sqrtPriceX64,
        amountA: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountB: new BN(100).mul(new BN(10 ** 9)),
        tokenAMint,
        tokenBMint: NATIVE_MINT,
        payer: creator,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenA,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutDammV2Instruction
      );
    });

    it("Zap protocol fee tokenB to token SOL", async () => {
      const isClaimTokenA = false;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        sqrtPriceX64,
        amountA: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountB: new BN(100).mul(new BN(10 ** 9)),
        tokenAMint: tokenBMint,
        tokenBMint: NATIVE_MINT,
        payer: creator,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenA,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutDammV2Instruction
      );
    });
  });

  describe("Zapout protocol fees via JUP v6 route)", () => {
    const price = new Decimal(1);

    const sqrtPrice = price.sqrt();
    const sqrtPriceX64 = new BN(
      sqrtPrice.mul(new Decimal(2).pow(64)).floor().toString()
    );

    it("Zap protocol fee tokenA to token SOL", async () => {
      const isClaimTokenX = true;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        sqrtPriceX64,
        amountA: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountB: new BN(100).mul(new BN(10 ** 9)),
        tokenAMint,
        tokenBMint: NATIVE_MINT,
        payer: creator,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2RouteInstruction
      );
    });

    it("Zap protocol fee tokenB to token SOL", async () => {
      const isClaimTokenX = false;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        sqrtPriceX64,
        amountA: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountB: new BN(100).mul(new BN(10 ** 9)),
        tokenAMint: tokenBMint,
        tokenBMint: NATIVE_MINT,
        payer: creator,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2RouteInstruction
      );
    });
  });

  describe("ZapOut protocol fees via JUP v6 shared route)", () => {
    const price = new Decimal(1);

    const sqrtPrice = price.sqrt();
    const sqrtPriceX64 = new BN(
      sqrtPrice.mul(new Decimal(2).pow(64)).floor().toString()
    );

    it("Zap protocol fee X to token SOL", async () => {
      const isClaimTokenX = true;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        sqrtPriceX64,
        amountA: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountB: new BN(100).mul(new BN(10 ** 9)),
        tokenAMint,
        tokenBMint: NATIVE_MINT,
        payer: creator,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2SharedRouteInstruction
      );
    });

    it("Zap protocol fee Y to token SOL", async () => {
      const isClaimTokenX = false;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        sqrtPriceX64,
        amountA: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountB: new BN(100).mul(new BN(10 ** 9)),
        tokenAMint: tokenBMint,
        tokenBMint: NATIVE_MINT,
        payer: creator,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2SharedRouteInstruction
      );
    });
  });
});

async function zapOutAndAssert(
  svm: LiteSVM,
  pool: PublicKey,
  isClaimTokenA: boolean,
  operatorKeypair: Keypair,
  treasuryAddress: PublicKey,
  zapPoolAddress: PublicKey,
  zapOutputMint: PublicKey,
  zapOutIxFn: (
    svm: LiteSVM,
    pool: PublicKey,
    protocolFeeAmount: BN,
    outputMint: PublicKey,
    operatorAddress: PublicKey,
    treasuryAddress: PublicKey
  ) => Promise<TransactionInstruction>
) {
  const poolState = getPool(svm, pool);
  const operatorAddress = operatorKeypair.publicKey;

  const treasuryZapTokenAddress = getAssociatedTokenAddressSync(
    zapOutputMint,
    treasuryAddress,
    true
  );

  const operatorTokenAAddress = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    operatorAddress
  );

  const operatorTokenBAddress = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    operatorAddress
  );

  // TODO: fix this
  const claimAmount = isClaimTokenA
    ? poolState.metrics.totalProtocolAFee
    : poolState.metrics.totalProtocolBFee;

  const receiverToken = isClaimTokenA
    ? operatorTokenAAddress
    : operatorTokenBAddress;

  const tokenVault = isClaimTokenA
    ? poolState.tokenAVault
    : poolState.tokenBVault;

  const tokenMint = isClaimTokenA ? poolState.tokenAMint : poolState.tokenBMint;

  const zapOutIx = await zapOutIxFn(
    svm,
    zapPoolAddress,
    claimAmount,
    zapOutputMint,
    operatorAddress,
    treasuryAddress
  );

  const beforeTreasuryTokenAccount = getTokenAccount(
    svm,
    treasuryZapTokenAddress
  );

  await zapProtocolFee({
    svm,
    pool,
    tokenVault,
    tokenMint,
    receiverToken,
    operator: deriveOperatorAddress(operatorAddress),
    signer: operatorKeypair,
    tokenProgram: TOKEN_PROGRAM_ID,
    maxAmount: claimAmount,
    postInstruction: zapOutIx,
  });

  const afterTreasuryTokenAccount = getTokenAccount(
    svm,
    treasuryZapTokenAddress
  );

  const beforeAmount = beforeTreasuryTokenAccount
    ? new BN(beforeTreasuryTokenAccount.amount.toString())
    : new BN(0);

  const afterAmount = afterTreasuryTokenAccount
    ? new BN(afterTreasuryTokenAccount.amount.toString())
    : new BN(0);

  console.log(
    `Treasury token account before: ${beforeAmount.toString()}, after: ${afterAmount.toString()}`
  );

  expect(afterAmount.gt(beforeAmount)).to.be.true;
}
