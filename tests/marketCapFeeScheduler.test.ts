import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
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
  startSvm,
  swapExactIn,
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import {
  BaseFeeMode,
  encodeFeeMarketCapSchedulerParams,
} from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

const sqrtPrice = new BN("4880549731789001291");
const numberOfPeriod = 100;
const priceStepBps = 10;
const reductionFactor = new BN(10);
const schedulerExpirationDuration = new BN(3600);

describe("Market cap fee scheduler", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let creator: Keypair;
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let whitelistedAccount: Keypair;

  before(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);
    tokenA = createToken(svm, admin.publicKey, admin.publicKey);
    tokenB = createToken(svm, admin.publicKey, admin.publicKey);

    mintSplTokenTo(svm, tokenA, admin, user.publicKey);

    mintSplTokenTo(svm, tokenB, admin, user.publicKey);

    mintSplTokenTo(svm, tokenA, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenB, admin, creator.publicKey);

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.RemoveConfigKey,
    ]);

    await createOperator(svm, {
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

    await initializeCustomizablePool(svm, {
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
      payer: creator,
      creator: creator.publicKey,
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
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );
    const liquidity = new BN(MIN_LP_AMOUNT);

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint: tokenA,
      tokenBMint: tokenB,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };
    const { pool } = await initializePool(svm, initPoolParams);
    let poolState = getPool(svm, pool);

    // Market cap increase
    await swapExactIn(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(svm, pool);

    const feePoint0 = poolState.metrics.totalLpBFee;

    // Market cap increase
    await swapExactIn(svm, {
      payer: creator,
      pool,
      inputTokenMint: tokenB,
      outputTokenMint: tokenA,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    poolState = await getPool(svm, pool);

    const feePoint1 = poolState.metrics.totalLpBFee.sub(feePoint0);

    // Fee decreases
    expect(feePoint1.lt(feePoint0)).to.be.true;
  });
});
