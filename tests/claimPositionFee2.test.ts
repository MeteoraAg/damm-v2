import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import { generateKpAndFund, startTest } from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createConfigIx,
  getPool,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  createToken,
  mintSplTokenTo,
  SwapParams,
  swap,
  claimPositionFee2,
} from "./bankrun-utils";
import BN from "bn.js";
import { NATIVE_MINT } from "@solana/spl-token";

describe("Claim position fee 2", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let creator: Keypair;
  let user: Keypair;
  let feeReceiver: Keypair;
  let tokenAMint: PublicKey;

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);
    creator = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);
    user = await generateKpAndFund(context.banksClient, context.payer);
    feeReceiver = await generateKpAndFund(context.banksClient, context.payer);

    tokenAMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      creator.publicKey
    );
  });

  it("Claim position fee with pool collect fee mode both token", async () => {
    const collectFeeMode = 0; // both token
    await fullFlow(
      context.banksClient,
      admin,
      creator,
      user,
      feeReceiver.publicKey,
      tokenAMint,
      collectFeeMode
    );
  });

  it("Claim position fee with pool collect fee mode only quote", async () => {
    const collectFeeMode = 1; // only quote
    await fullFlow(
      context.banksClient,
      admin,
      creator,
      user,
      feeReceiver.publicKey,
      tokenAMint,
      collectFeeMode
    );
  });
});

async function fullFlow(
  banksClient: BanksClient,
  admin: Keypair,
  creator: Keypair,
  user: Keypair,
  feeReceiver: PublicKey,
  tokenAMint: PublicKey,
  collectFeeMode: number
) {
  const createConfigParams = {
    poolFees: {
      baseFee: {
        cliffFeeNumerator: new BN(2_500_000),
        numberOfPeriod: 0,
        reductionFactor: new BN(0),
        periodFrequency: new BN(0),
        feeSchedulerMode: 0,
      },
      protocolFeePercent: 10,
      partnerFeePercent: 0,
      referralFeePercent: 0,
      dynamicFee: null,
    },
    sqrtMinPrice: new BN(MIN_SQRT_PRICE),
    sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
    vaultConfigKey: PublicKey.default,
    poolCreatorAuthority: PublicKey.default,
    activationType: 0,
    collectFeeMode: 0,
  };

  const configId = Math.floor(Math.random() * 1000);
  createConfigParams.collectFeeMode = collectFeeMode;
  const config = await createConfigIx(
    banksClient,
    admin,
    new BN(configId),
    createConfigParams
  );
  const liquidity = new BN(MIN_LP_AMOUNT);
  const sqrtPrice = new BN(MIN_SQRT_PRICE);

  const initPoolParams: InitializePoolParams = {
    payer: creator,
    creator: creator.publicKey,
    config,
    tokenAMint,
    tokenBMint: NATIVE_MINT,
    liquidity,
    sqrtPrice,
    activationPoint: null,
  };

  const { pool, position } = await initializePool(banksClient, initPoolParams);

  const poolState = await getPool(banksClient, pool);

  let swapParams: SwapParams = {
    payer: user,
    pool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: poolState.tokenAMint,
    amountIn: new BN(LAMPORTS_PER_SOL),
    minimumAmountOut: new BN(0),
    referralTokenAccount: null,
  };

  await swap(banksClient, swapParams);

  swapParams.inputTokenMint = poolState.tokenAMint;
  swapParams.outputTokenMint = NATIVE_MINT;
  swapParams.amountIn = new BN(100 * 10 ** 9);

  await swap(banksClient, swapParams);

  // claim fee
  await claimPositionFee2(banksClient, {
    owner: creator,
    pool,
    position,
    payer: admin,
    feeReceiver: feeReceiver,
  });
}
