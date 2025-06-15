import { BanksClient, ProgramTestContext } from "solana-bankrun";
import { generateKpAndFund, startTest, warpSlotBy } from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  swap,
  SwapParams,
  createToken,
  mintSplTokenTo,
  InitializeCustomizeablePoolParams,
  createCpAmmProgram,
  initializeCustomizeablePool,
} from "./bankrun-utils";
import BN from "bn.js";
import {
  depositAlphaVault,
  fillDammV2,
  setupProrataAlphaVault,
} from "./bankrun-utils/alphaVault";
import { NATIVE_MINT } from "@solana/spl-token";

describe("Alpha vault with damm v2", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let user: Keypair;
  let creator: Keypair;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);

    user = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);
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
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      creator.publicKey
    );
    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      admin.publicKey
    );
  });

  it("Alpha vault can buy before activation point with minimum fee", async () => {
    await fullFlow(context, admin, creator, tokenAMint, tokenBMint);
  });
});

const fullFlow = async (
  context: ProgramTestContext,
  admin: Keypair,
  creator: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
) => {
  let activationPointDiff = 20;
  let startVestingPointDiff = 25;
  let endVestingPointDiff = 30;

  let currentSlot = await context.banksClient.getSlot("processed");
  let activationPoint = new BN(Number(currentSlot) + activationPointDiff);

  console.log("setup permission pool");
  let referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
  let maxRateLimiterDuration = new BN(10);

  const params: InitializeCustomizeablePoolParams = {
    payer: admin,
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
      baseFee: {
        cliffFeeNumerator: new BN(10_000_000), // 100bps
        firstFactor: 10, // 10 bps
        secondFactor: maxRateLimiterDuration, // 10 slot
        thirdFactor: referenceAmount, // 1 sol
        baseFeeMode: 2, // rate limiter mode
      },
      protocolFeePercent: 20,
      partnerFeePercent: 0,
      referralFeePercent: 20,
      dynamicFee: null,
    },
    activationType: 0, // slot
    collectFeeMode: 1, // onlyB
  };
  const { pool } = await initializeCustomizeablePool(context.banksClient, params);

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
    payer: admin,
    escrowFee: new BN(0),
    whitelistMode: 0, // Permissionless
    baseKeypair: admin,
  });

  console.log("User deposit in alpha vault");
  let depositAmount = new BN(10 * LAMPORTS_PER_SOL);
  await depositAlphaVault(context.banksClient, {
    amount: depositAmount,
    ownerKeypair: admin,
    alphaVault,
    payer: admin,
  });

  // warp slot to pre-activation point
  // alpha vault can buy before activation point
  const preactivationPoint = activationPoint.sub(new BN(5));
  await warpSlotBy(context, preactivationPoint)

  console.log("fill damm v2");
  await fillDammV2(
    context.banksClient,
    pool,
    alphaVault,
    admin,
    maxBuyingCap
  );

  

};
