import { generateKpAndFund } from "./helpers/common";
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
  getCpAmmProgramErrorCode,
  getPosition,
  encodePermissions,
  OperatorPermission,
  createOperator,
  startSvm,
  warpToTimestamp,
  expectThrowsErrorCode,
} from "./helpers";
import BN from "bn.js";
import { describe } from "mocha";
import { expect } from "chai";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Frozen reward vault", () => {
  let svm: LiteSVM;
  let creator: Keypair;
  let admin: Keypair;
  let config: PublicKey;
  let funder: Keypair;
  let user: Keypair;
  let whitelistedAccount: Keypair;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let rewardMint: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    funder = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

    rewardMint = createToken(svm, admin.publicKey, creator.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    mintSplTokenTo(svm, rewardMint, admin, funder.publicKey);
    mintSplTokenTo(svm, rewardMint, admin, admin.publicKey);

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

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
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

    const { pool } = await initializePool(svm, initPoolParams);

    // user create postion and add liquidity
    const position = await createPosition(svm, user, user.publicKey, pool);

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: MIN_LP_AMOUNT,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(svm, addLiquidityParams);

    // init reward
    const index = 0;
    const initRewardParams: InitializeRewardParams = {
      index,
      payer: creator,
      rewardDuration: new BN(24 * 60 * 60),
      pool,
      rewardMint,
      funder: funder.publicKey,
    };
    await initializeReward(svm, initRewardParams);

    // fund reward
    await fundReward(svm, {
      index,
      funder: funder,
      pool,
      carryForward: true,
      amount: new BN("1000000000"),
    });

    const currentClock = svm.getClock();

    const newTimestamp = Number(currentClock.unixTimestamp) + 3600;

    warpToTimestamp(svm, new BN(newTimestamp));

    // freeze reward vault
    let rewardVault = deriveRewardVaultAddress(pool, index);
    freezeTokenAccount(svm, creator, rewardMint, rewardVault);

    const rewardVaultInfo = getTokenAccount(svm, rewardVault);
    expect(rewardVaultInfo.state).eq(2); // frozen

    // check error
    const errorCode = getCpAmmProgramErrorCode("RewardVaultFrozenSkipRequired");
    expectThrowsErrorCode(
      await claimReward(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0, // skip_reward is required in case reward vault frozen
      }),
      errorCode
    );

    // // claim reward
    await claimReward(svm, {
      index,
      user,
      pool,
      position,
      skipReward: 1, // skip reward in case reward vault frozen
    });

    const positionState = getPosition(svm, position);
    const rewardInfo = positionState.rewardInfos[index];
    expect(rewardInfo.rewardPendings.toNumber()).eq(0);
  });
});
