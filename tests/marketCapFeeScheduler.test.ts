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
import {
  BaseFeeMode,
  encodeFeeMarketCapSchedulerParams,
} from "./bankrun-utils/feeCodec";

const sqrtPrice = new BN("4880549731789001291");
const numberOfPeriod = 100;
const priceStepBps = 10;
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

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.RemoveConfigKey,
    ]);

    await createOperator(context.banksClient, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });
  });

  it("Initialize customizable pool with market cap fee scheduler", async () => {
    const cliffFeeNumerator = new BN(100_000_000); // 10%

    const data = encodeFeeMarketCapSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod,
      priceStepBps,
      schedulerExpirationDuration.toNumber(),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeMarketCapSchedulerLinear
    );

    await initializeCustomizablePool(context.banksClient, {
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
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
    const cliffFeeNumerator = new BN(100_000_000); // 10%

    const data = encodeFeeMarketCapSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod,
      priceStepBps,
      schedulerExpirationDuration.toNumber(),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeMarketCapSchedulerLinear
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
      sqrtPrice,
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

  it("Market cap linear fee scheduler with max fee 99%", async () => {
    const cliffFeeNumerator = new BN(990_000_000); // 10%

    const data = encodeFeeMarketCapSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod,
      priceStepBps,
      schedulerExpirationDuration.toNumber(),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeMarketCapSchedulerLinear
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
      sqrtPrice,
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

    let totalTradingFee = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );

    const actualFee = new BN(LAMPORTS_PER_SOL).muln(99).divn(100)

    expect(actualFee.toString()).eq(totalTradingFee.toString())
  });

  it("Market cap exponential fee scheduler with max fee 99%", async () => {
    const cliffFeeNumerator = new BN(990_000_000); // 10%

    const data = encodeFeeMarketCapSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod,
      priceStepBps,
      schedulerExpirationDuration.toNumber(),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeMarketCapSchedulerExponential
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
      sqrtPrice,
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

    let totalTradingFee = poolState.metrics.totalLpBFee.add(
      poolState.metrics.totalProtocolBFee
    );

    const actualFee = new BN(LAMPORTS_PER_SOL).muln(99).divn(100)

    expect(actualFee.toString()).eq(totalTradingFee.toString())
  });
});
