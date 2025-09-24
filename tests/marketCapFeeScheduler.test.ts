import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  CreateConfigParams,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  OperatorPermission,
  buildMarketCapBaseFeeParams,
  createConfigIx,
  createOperator,
  createToken,
  encodePermissions,
  getPool,
  initializeCustomizablePool,
  initializePool,
  mintSplTokenTo,
  swapExactIn,
} from "./bankrun-utils";
import { generateKpAndFund, randomID, startTest } from "./bankrun-utils/common";

const minSqrtPrice = new BN("4880549731789001291");
const maxSqrtPrice = new BN("12236185739241331242");

const minSqrtPriceIndex = minSqrtPrice.div(MIN_SQRT_PRICE);
const maxSqrtPriceIndex = maxSqrtPrice.div(MIN_SQRT_PRICE);

const maxSqrtPriceDeltaVbps = new BN(10000);
const reductionFactor = new BN(10);
const schedulerExpirationDuration = new BN(3600);

describe("Market cap fee scheduler", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let whitelistedAccount: Keypair;

  before(async () => {
    const root = Keypair.generate();
    context = await startTest(root);
    admin = context.payer;
    operator = await generateKpAndFund(context.banksClient, context.payer);
    partner = await generateKpAndFund(context.banksClient, context.payer);
    user = await generateKpAndFund(context.banksClient, context.payer);
    poolCreator = await generateKpAndFund(context.banksClient, context.payer);
    whitelistedAccount = await generateKpAndFund(context.banksClient, context.payer);
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

    let permission = encodePermissions([OperatorPermission.CreateConfigKey, OperatorPermission.RemoveConfigKey])

    await createOperator(context.banksClient, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission
    })
  });

  it("Initialize customizable pool with market cap fee scheduler", async () => {
    const cliffFeeNumerator = new BN(100_000_000); // 10%

    const baseFee = buildMarketCapBaseFeeParams(
      cliffFeeNumerator,
      maxSqrtPriceDeltaVbps,
      maxSqrtPriceIndex,
      schedulerExpirationDuration,
      reductionFactor,
      3
    );

    await initializeCustomizablePool(context.banksClient, {
      poolFees: {
        baseFee,
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      activationType: 0,
      collectFeeMode: 1, // onlyB
      activationPoint: null,
      hasAlphaVault: false,
      payer: poolCreator,
      creator: poolCreator.publicKey,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
    });
  });

  it("Happy flow market cap fee scheduler with static config", async () => {
    const baseFee = buildMarketCapBaseFeeParams(
      new BN(100_000_000), // 10%
      maxSqrtPriceDeltaVbps,
      maxSqrtPriceIndex,
      schedulerExpirationDuration,
      reductionFactor,
      3
    );

    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee,
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 1, // onlyB
      minSqrtPriceIndex: minSqrtPriceIndex,
    };

    let config = await createConfigIx(
      context.banksClient,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );
    const liquidity = new BN(MIN_LP_AMOUNT);

    const initPoolParams: InitializePoolParams = {
      payer: poolCreator,
      creator: poolCreator.publicKey,
      config,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      liquidity,
      sqrtPrice: minSqrtPrice,
      activationPoint: null,
    };
    const { pool } = await initializePool(context.banksClient, initPoolParams);
    let poolState = await getPool(context.banksClient, pool);

    // Market cap increase
    await swapExactIn(context.banksClient, {
      payer: poolCreator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(context.banksClient, pool);

    const feePoint0 = poolState.metrics.totalLpBFee;

    // Market cap increase

    await swapExactIn(context.banksClient, {
      payer: poolCreator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(context.banksClient, pool);

    const feePoint1 = poolState.metrics.totalLpBFee.sub(feePoint0);

    // Fee decreases
    expect(feePoint1.lt(feePoint0)).to.be.true;
  });
});
