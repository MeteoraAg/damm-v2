import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { LiteSVM } from "litesvm";
import { describe } from "mocha";
import { expect } from "chai";
import {
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createToken,
  DEAD_LIQUIDITY,
  encodePermissions,
  fundReward,
  getPool,
  getTokenBalance,
  initializePool,
  InitializePoolParams,
  initializeReward,
  InitializeRewardParams,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  removeAllLiquidity,
  startSvm,
  U128_MAX,
  warpToTimestamp,
  withdrawIneligibleReward,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

describe("Dead liquidity reward (Compounding fee mode only)", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let funder: Keypair;
  let whitelistedAccount: Keypair;
  let compoundingConfig: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let rewardMint: PublicKey;

  const REWARD_INDEX = 0;
  const REWARD_DURATION = 24 * 60 * 60; // 1 day
  const REWARD_AMOUNT = new BN(REWARD_DURATION * 1_000); // divisible by 4
  const REWARD_RATE_SCALE = 64;

  const baseFeeData = () =>
    encodeFeeTimeSchedulerParams(
      BigInt(new BN(2_500_000).toString()),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

  beforeEach(async () => {
    svm = startSvm();

    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    funder = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);
    rewardMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    mintSplTokenTo(svm, rewardMint, admin, funder.publicKey);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([OperatorPermission.CreateConfigKey]),
    });

    // compounding config (collectFeeMode = 2)
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: { data: Array.from(baseFeeData()) },
        compoundingFeeBps: 5000,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(0),
      sqrtMaxPrice: U128_MAX,
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 2,
    };
    compoundingConfig = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(Math.floor(Math.random() * 1_000_000)),
      createConfigParams
    );
  });

  const funderRewardAta = () =>
    getAssociatedTokenAddressSync(
      rewardMint,
      funder.publicKey,
      true,
      TOKEN_PROGRAM_ID
    );

  async function setupFundedCompoundingPool() {
    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config: compoundingConfig,
      tokenAMint,
      tokenBMint,
      liquidity: DEAD_LIQUIDITY.muln(2),
      sqrtPrice: MIN_SQRT_PRICE.muln(2),
      activationPoint: null,
    };
    const { pool, position } = await initializePool(svm, initPoolParams);

    const initRewardParams: InitializeRewardParams = {
      index: REWARD_INDEX,
      payer: creator,
      rewardDuration: new BN(REWARD_DURATION),
      pool,
      rewardMint,
      funder: funder.publicKey,
    };
    await initializeReward(svm, initRewardParams);

    await fundReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      carryForward: true,
      amount: REWARD_AMOUNT,
    });

    const rewardEnd = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .rewardDurationEnd;
    const rewardMid = rewardEnd.subn(REWARD_DURATION / 2);
    return { pool, position, rewardEnd, rewardMid };
  }

  describe("Funder can withdrawIneligibleReward from DEAD_LIQUIDITY share", () => {
    it("After the last LP exits", async () => {
      const { pool, position, rewardEnd, rewardMid } =
        await setupFundedCompoundingPool();

      warpToTimestamp(svm, rewardMid);
      await claimReward(svm, {
        index: REWARD_INDEX,
        user: creator,
        pool,
        position,
        skipReward: 0,
      });
      await removeAllLiquidity(svm, {
        owner: creator,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });

      const afterExit = getPool(svm, pool);
      expect(afterExit.liquidity.toString()).eq(DEAD_LIQUIDITY.toString());

      warpToTimestamp(svm, rewardEnd.addn(1));

      const rewardVault = afterExit.rewardInfos[REWARD_INDEX].vault;
      const funderBefore = new BN(getTokenBalance(svm, funderRewardAta()));
      await withdrawIneligibleReward(svm, {
        index: REWARD_INDEX,
        funder,
        pool,
      });
      const recovered = new BN(getTokenBalance(svm, funderRewardAta())).sub(
        funderBefore
      );
      const vaultResidual = new BN(getTokenBalance(svm, rewardVault));

      expect(vaultResidual.eqn(0)).eq(true);
      // Without the fix withdrawIneligibleReward returns 0 here
      // the empty-liquidity counter never increments since DEAD_LIQUIDITY keeps pool.liquidity > 0
      expect(recovered.gtn(0)).eq(true);
    });

    it("When the LP never exits", async () => {
      const { pool, position, rewardEnd } = await setupFundedCompoundingPool();

      warpToTimestamp(svm, rewardEnd);
      await claimReward(svm, {
        index: REWARD_INDEX,
        user: creator,
        pool,
        position,
        skipReward: 0,
      });

      expect(getPool(svm, pool).liquidity.gt(DEAD_LIQUIDITY)).eq(true);

      warpToTimestamp(svm, rewardEnd.addn(1));
      const rewardVault = getPool(svm, pool).rewardInfos[REWARD_INDEX].vault;

      const funderBefore = new BN(getTokenBalance(svm, funderRewardAta()));
      await withdrawIneligibleReward(svm, {
        index: REWARD_INDEX,
        funder,
        pool,
      });
      const recovered = new BN(getTokenBalance(svm, funderRewardAta())).sub(
        funderBefore
      );
      const vaultResidual = new BN(getTokenBalance(svm, rewardVault));

      expect(vaultResidual.eqn(0)).eq(true);
      // Without the fix withdrawIneligibleReward returns 0 here
      // the empty-liquidity counter never increments since DEAD_LIQUIDITY keeps pool.liquidity > 0
      expect(recovered.gtn(0)).eq(true);
    });
  });

  it("Funding with carryForward = true carries forward the dead liquidity reward", async () => {
    const { pool, position, rewardEnd } = await setupFundedCompoundingPool();

    warpToTimestamp(svm, rewardEnd);
    await claimReward(svm, {
      index: REWARD_INDEX,
      user: creator,
      pool,
      position,
      skipReward: 0,
    });

    const rewardInfo = getPool(svm, pool).rewardInfos[REWARD_INDEX];
    const deadInVault = new BN(getTokenBalance(svm, rewardInfo.vault));
    expect(deadInVault.gtn(0)).eq(true);
    // pool was never empty. this also ensures the carry forward only comes from dead liquidity reward
    expect(rewardInfo.cumulativeSecondsWithEmptyLiquidityReward.eqn(0)).eq(
      true
    );

    // second reward campaign
    await fundReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      carryForward: true,
      amount: REWARD_AMOUNT,
    });

    const vaultAfter = new BN(getTokenBalance(svm, rewardInfo.vault));
    const rateWithoutCarryOver =
      REWARD_AMOUNT.shln(REWARD_RATE_SCALE).divn(REWARD_DURATION);
    const actualRate = getPool(svm, pool).rewardInfos[REWARD_INDEX].rewardRate;

    expect(vaultAfter.gt(REWARD_AMOUNT)).eq(true);
    expect(vaultAfter.eq(REWARD_AMOUNT.add(deadInVault))).eq(true);
    expect(actualRate.gt(rateWithoutCarryOver)).eq(true);
  });
});
