import { Clock, ProgramTestContext } from "solana-bankrun";
import {
  expectThrowsAsync,
  generateKpAndFund,
  startTest,
} from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  addLiquidity,
  AddLiquidityParams,
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  fundReward,
  initializePool,
  InitializePoolParams,
  initializeReward,
  InitializeRewardParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  createToken,
  mintSplTokenTo,
  freezeTokenAccount,
  deriveRewardVaultAddress,
  getTokenAccount,
  U64_MAX,
  getCpAmmProgramErrorCodeHexString,
  getPosition,
} from "./bankrun-utils";
import BN from "bn.js";
import { describe } from "mocha";
import { expect } from "chai";

describe("Frozen reward vault", () => {
  let context: ProgramTestContext;
  let creator: Keypair;
  let admin: Keypair;
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
    const root = Keypair.generate();
    context = await startTest(root);

    user = await generateKpAndFund(context.banksClient, context.payer);
    funder = await generateKpAndFund(context.banksClient, context.payer);
    creator = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);

    tokenAMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );
    tokenBMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    rewardMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey,
      creator.publicKey
    );

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
      tokenBMint,
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
      tokenBMint,
      context.payer,
      creator.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      rewardMint,
      context.payer,
      funder.publicKey
    );
    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      rewardMint,
      context.payer,
      admin.publicKey
    );
    // create config
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          cliffFeeNumerator: new BN(2_500_000),
          numberOfPeriod: 0,
          reductionFactor: new BN(0),
          periodFrequency: new BN(0),
          feeSchedulerMode: 0,
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
      new BN(configId),
      createConfigParams
    );
  });

  it("Full flow for frozen reward vault", async () => {
    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE);

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

    const { pool } = await initializePool(context.banksClient, initPoolParams);

    // user create postion and add liquidity
    const position = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: MIN_LP_AMOUNT,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(context.banksClient, addLiquidityParams);

    // init reward
    const index = 0;
    const initRewardParams: InitializeRewardParams = {
      index,
      payer: creator,
      rewardDuration: new BN(24 * 60 * 60),
      pool,
      rewardMint,
    };
    await initializeReward(context.banksClient, initRewardParams);

    // fund reward
    await fundReward(context.banksClient, {
      index,
      funder: funder,
      pool,
      carryForward: true,
      amount: new BN("1000000000"),
    });

    const currentClock = await context.banksClient.getClock();

    const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        BigInt(newTimestamp.toString())
      )
    );
    // freeze reward vault
    let rewardVault = deriveRewardVaultAddress(pool, index);
    await freezeTokenAccount(
      context.banksClient,
      creator,
      rewardMint,
      rewardVault
    );
    const rewardVaultInfo = await getTokenAccount(
      context.banksClient,
      rewardVault
    );
    expect(rewardVaultInfo.state).eq(2); // frozen

    // check error
    const errorCode = getCpAmmProgramErrorCodeHexString("RewardVaultFrozenSkipRequired")
    await expectThrowsAsync(async () => {
      await claimReward(context.banksClient, {
        index,
        user,
        pool,
        position,
        skipReward: 0, // skip_reward is required in case reward vault frozen
      });
    }, errorCode)


    // // claim reward
    await claimReward(context.banksClient, {
      index,
      user,
      pool,
      position,
      skipReward: 1, // skip reward in case reward vault frozen
    });

    const positionState = await getPosition(context.banksClient, position)
    const rewardInfo = positionState.rewardInfos[index]
    expect(rewardInfo.rewardPendings.toNumber()).eq(0)
  });
});
