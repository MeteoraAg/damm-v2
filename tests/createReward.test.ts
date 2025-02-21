import { expect } from "chai";
import { BanksClient, Clock, ProgramTestContext } from "solana-bankrun";
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
  addLiquidity,
  AddLiquidityParams,
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  fundReward,
  getPool,
  getPosition,
  initializePool,
  InitializePoolParams,
  initializeReward,
  InitializeRewardParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  updateRewardDuration,
  updateRewardFunder,
  withdrawIneligibleReward,
} from "./bankrun-utils";
import BN from "bn.js";

describe("Initialize reward", () => {
  let context: ProgramTestContext;
  let payer: Keypair;
  let creator: PublicKey;
  let config: PublicKey;
  let funder: Keypair;
  let user: Keypair;
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
    funder = prepareContext.funder;
    user = prepareContext.user;
    // create config
    const createConfigParams: CreateConfigParams = {
      index: new BN(configId),
      poolFees: {
        baseFee: {
          cliffFeeNumerator: new BN(2_500_000),
          numberOfPeriod: 0,
          deltaPerPeriod: new BN(0),
          periodFrequency: new BN(0)
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

    config = await createConfigIx(
      context.banksClient,
      prepareContext.admin,
      createConfigParams
    );
  });

  it("Full flow for reward", async () => {
    liquidity = new BN(MIN_LP_AMOUNT);
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

    // user create postion and add liquidity
    const position = await createPosition(
      context.banksClient,
      payer,
      user.publicKey,
      pool
    );

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(100),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(context.banksClient, addLiquidityParams);

    // init reward
    const index = 0;
    const initRewardParams: InitializeRewardParams = {
      index,
      payer: payer,
      rewardDuration: new BN(24 * 60 * 60),
      pool,
      rewardMint,
    };
    await initializeReward(context.banksClient, initRewardParams);

    // update duration
    await updateRewardDuration(context.banksClient, {
      index,
      admin: payer,
      pool,
      newDuration: new BN(1),
    });

    // update new funder
    await updateRewardFunder(context.banksClient, {
      index,
      admin: payer,
      pool,
      newFunder: funder.publicKey,
    });

    // fund reward
    await fundReward(context.banksClient, {
      index,
      funder: funder,
      pool,
      carryForward: true,
      amount: new BN("100"),
    });

    // claim reward

    await claimReward(context.banksClient, {
      index,
      user,
      pool,
    });

    // claim ineligible reward
    // const poolState = await getPool(context.banksClient, pool);
    // // set new timestamp to pass reward duration end
    // const timestamp = poolState.rewardInfos[index].rewardDurationEnd.addn(5000);
    // const currentClock = await context.banksClient.getClock();
    // context.setClock(
    //   new Clock(
    //     currentClock.slot,
    //     currentClock.epochStartTimestamp,
    //     currentClock.epoch,
    //     currentClock.leaderScheduleEpoch,
    //     BigInt(timestamp.toString())
    //   )
    // );
    // await withdrawIneligibleReward(context.banksClient, {
    //   index,
    //   funder,
    //   pool,
    // });
  });
});