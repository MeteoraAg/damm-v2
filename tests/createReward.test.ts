import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  randomID,
  setupTestContext,
  setupTokenMint,
  startTest,
  transferSol,
} from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, wrapSOL } from "./bankrun-utils/token";
import {
  createConfigIx,
  CreateConfigParams,
  getPool,
  getPosition,
  initializePool,
  InitializePoolParams,
  initializeReward,
  InitializeRewardParams,
  LOCK_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from "./bankrun-utils";
import BN from "bn.js";

describe("Initialize reward", () => {
  let context: ProgramTestContext;
  let payer: Keypair;
  let creator: PublicKey;
  let config: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let rewardMint: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    context = await startTest();
    const prepareContext = await setupTestContext(
      context.banksClient,
      context.payer
    );

    creator = prepareContext.poolCreator.publicKey;
    payer = prepareContext.payer;
    tokenAMint = prepareContext.tokenAMint;
    tokenBMint = prepareContext.tokenBMint;
    rewardMint = prepareContext.rewardMint;
    // create config
    const createConfigParams: CreateConfigParams = {
      index: new BN(configId),
      poolFees: {
        tradeFeeNumerator: new BN(2_500_000),
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

    config = await createConfigIx(
      context.banksClient,
      prepareContext.admin,
      createConfigParams
    );
  });

  it("Admin initialize reward with", async () => {
    liquidity = new BN(LOCK_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE);

    const initPoolParams: InitializePoolParams = {
      payer: payer,
      creator: creator,
      config,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };

    const { pool } = await initializePool(context.banksClient, initPoolParams);

    // init reward
    const index = 0;
    const initRewardParams: InitializeRewardParams = {
      index: 0,
      payer: payer,
      rewardDuration: new BN(24 * 60 * 60),
      pool,
      rewardMint,
    };
    await initializeReward(context.banksClient, initRewardParams);
  });
});
