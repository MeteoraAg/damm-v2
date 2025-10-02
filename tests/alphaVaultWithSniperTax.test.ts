import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  BaseFee,
  FEE_DENOMINATOR,
  InitializeCustomizablePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  createToken,
  getPool,
  initializeCustomizablePool,
  mintSplTokenTo,
} from "./bankrun-utils";
import {
  depositAlphaVault,
  fillDammV2,
  getVaultState,
  setupProrataAlphaVault,
} from "./bankrun-utils/alphaVault";
import {
  convertToByteArray,
  convertToRateLimiterSecondFactor,
  generateKpAndFund,
  startTest,
  warpSlotBy,
} from "./bankrun-utils/common";
import { Rounding, mulDiv } from "./bankrun-utils/math";
import {
  BaseFeeMode,
  decodePodAlignedFeeRateLimiter,
  decodePodAlignedFeeTimeScheduler,
  encodeFeeRateLimiterParams,
  encodeFeeTimeSchedulerParams,
} from "./bankrun-utils/feeCodec";

describe("Alpha vault with sniper tax", () => {
  describe("Fee Scheduler", () => {
    let context: ProgramTestContext;
    let user: Keypair;
    let creator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      const root = Keypair.generate();
      context = await startTest(root);

      user = await generateKpAndFund(context.banksClient, context.payer);
      creator = await generateKpAndFund(context.banksClient, context.payer);

      tokenAMint = await createToken(
        context.banksClient,
        context.payer,
        context.payer.publicKey
      );
      tokenBMint = NATIVE_MINT;

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        tokenAMint,
        context.payer,
        creator.publicKey
      );
    });

    it("Alpha vault can buy before activation point with minimum fee", async () => {
      const cliffFeeNumerator = new BN(500_000_000);
      const numberOfPeriods = 100;
      const periodFrequency = new BN(1);
      const reductionFactor = new BN(4875000);

      const data = encodeFeeTimeSchedulerParams(
        BigInt(cliffFeeNumerator.toString()),
        numberOfPeriods,
        BigInt(periodFrequency.toString()),
        BigInt(reductionFactor.toString()),
        BaseFeeMode.FeeTimeSchedulerLinear
      );

      const { pool, alphaVault } = await alphaVaultWithSniperTaxFullFlow(
        context,
        user,
        creator,
        tokenAMint,
        tokenBMint,
        {
          data: Array.from(data),
        }
      );

      const alphaVaultState = await getVaultState(
        context.banksClient,
        alphaVault
      );
      const poolState = await getPool(context.banksClient, pool);
      let totalTradingFee = poolState.metrics.totalLpBFee.add(
        poolState.metrics.totalProtocolBFee
      );
      const totalDeposit = new BN(alphaVaultState.totalDeposit);

      // flat base fee
      // linear fee scheduler
      const linearFeeTimeScheduler = decodePodAlignedFeeTimeScheduler(
        Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
      );
      const feeNumeratorDecay = new BN(
        linearFeeTimeScheduler.numberOfPeriod
      ).mul(linearFeeTimeScheduler.reductionFactor);

      const feeNumerator =
        linearFeeTimeScheduler.cliffFeeNumerator.sub(feeNumeratorDecay);

      const lpFee = mulDiv(
        totalDeposit,
        feeNumerator,
        new BN(FEE_DENOMINATOR),
        Rounding.Up
      );

      // alpha vault can buy with minimum fee (fee scheduler don't applied)
      // expect total trading fee equal minimum base fee
      expect(totalTradingFee.toNumber()).eq(lpFee.toNumber());
    });
  });

  describe("Rate limiter", () => {
    let context: ProgramTestContext;
    let user: Keypair;
    let creator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      const root = Keypair.generate();
      context = await startTest(root);

      user = await generateKpAndFund(context.banksClient, context.payer);
      creator = await generateKpAndFund(context.banksClient, context.payer);

      tokenAMint = await createToken(
        context.banksClient,
        context.payer,
        context.payer.publicKey
      );
      tokenBMint = NATIVE_MINT;

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        tokenAMint,
        context.payer,
        creator.publicKey
      );
    });

    it("Alpha vault can buy before activation point with minimum fee", async () => {
      const referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
      const maxRateLimiterDuration = new BN(10);
      const maxFeeBps = new BN(5000);
      const feeIncrementBps = 10;
      const cliffFeeNumerator = new BN(10_000_000);

      const data = encodeFeeRateLimiterParams(
        BigInt(cliffFeeNumerator.toString()),
        feeIncrementBps,
        maxRateLimiterDuration.toNumber(),
        maxFeeBps.toNumber(),
        BigInt(referenceAmount.toString())
      );

      const { pool, alphaVault } = await alphaVaultWithSniperTaxFullFlow(
        context,
        user,
        creator,
        tokenAMint,
        tokenBMint,
        {
          data: Array.from(data),
        }
      );

      const alphaVaultState = await getVaultState(
        context.banksClient,
        alphaVault
      );
      const poolState = await getPool(context.banksClient, pool);
      let totalTradingFee = poolState.metrics.totalLpBFee.add(
        poolState.metrics.totalProtocolBFee
      );
      const totalDeposit = new BN(alphaVaultState.totalDeposit);

      const rateLimiterScheduler = decodePodAlignedFeeRateLimiter(
        Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
      );

      const lpFee = mulDiv(
        totalDeposit,
        rateLimiterScheduler.cliffFeeNumerator,
        new BN(FEE_DENOMINATOR),
        Rounding.Up
      );
      // alpha vault can buy with minimum fee (rate limiter don't applied)
      // expect total trading fee equal minimum base fee
      expect(totalTradingFee.toNumber()).eq(lpFee.toNumber());
    });
  });
});

const alphaVaultWithSniperTaxFullFlow = async (
  context: ProgramTestContext,
  user: Keypair,
  creator: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  baseFee: BaseFee
): Promise<{ pool: PublicKey; alphaVault: PublicKey }> => {
  let activationPointDiff = 20;
  let startVestingPointDiff = 25;
  let endVestingPointDiff = 30;

  let currentSlot = await context.banksClient.getSlot("processed");
  let activationPoint = new BN(Number(currentSlot) + activationPointDiff);

  console.log("setup permission pool");

  const params: InitializeCustomizablePoolParams = {
    payer: creator,
    creator: creator.publicKey,
    tokenAMint,
    tokenBMint,
    liquidity: MIN_LP_AMOUNT,
    sqrtPrice: MIN_SQRT_PRICE,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    hasAlphaVault: true,
    activationPoint,
    poolFees: {
      baseFee,
      padding: [],
      dynamicFee: null,
    },
    activationType: 0, // slot
    collectFeeMode: 1, // onlyB
  };
  const { pool } = await initializeCustomizablePool(
    context.banksClient,
    params
  );

  console.log("setup prorata vault");
  let startVestingPoint = new BN(Number(currentSlot) + startVestingPointDiff);
  let endVestingPoint = new BN(Number(currentSlot) + endVestingPointDiff);
  let maxBuyingCap = new BN(10 * LAMPORTS_PER_SOL);

  let alphaVault = await setupProrataAlphaVault(context.banksClient, {
    baseMint: tokenAMint,
    quoteMint: tokenBMint,
    pool,
    poolType: 2, // 0: DLMM, 1: Dynamic Pool, 2: DammV2
    startVestingPoint,
    endVestingPoint,
    maxBuyingCap,
    payer: creator,
    escrowFee: new BN(0),
    whitelistMode: 0, // Permissionless
    baseKeypair: creator,
  });

  console.log("User deposit in alpha vault");
  let depositAmount = new BN(10 * LAMPORTS_PER_SOL);
  await depositAlphaVault(context.banksClient, {
    amount: depositAmount,
    ownerKeypair: user,
    alphaVault,
    payer: user,
  });

  // warp slot to pre-activation point
  // alpha vault can buy before activation point
  const preactivationPoint = activationPoint.sub(new BN(5));
  await warpSlotBy(context, preactivationPoint);

  console.log("fill damm v2");
  await fillDammV2(
    context.banksClient,
    pool,
    alphaVault,
    creator,
    maxBuyingCap
  );

  return {
    pool,
    alphaVault,
  };
};
