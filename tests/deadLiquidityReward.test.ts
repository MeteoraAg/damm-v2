import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
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
  createCpAmmProgram,
  createOperator,
  createToken,
  createTokenBadge,
  DEAD_LIQUIDITY,
  derivePoolAuthority,
  encodePermissions,
  expectThrowsErrorCode,
  fundReward,
  fundReward2,
  getCpAmmProgramErrorCode,
  getPool,
  getTokenBalance,
  initializePool,
  InitializePoolParams,
  initializeReward,
  initializeReward2,
  InitializeRewardParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  removeAllLiquidity,
  sendTransaction,
  startSvm,
  U128_MAX,
  U64_MAX,
  warpToTimestamp,
  withdrawDeadLiquidityReward,
  withdrawDeadLiquidityReward2,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import {
  createToken2022,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import {
  createExtraAccountMetaListAndCounter,
  getHookRemainingAccounts,
  readHookCounter,
} from "./helpers/transferHook";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

const invalidCollectFeeModeErrorCode = getCpAmmProgramErrorCode(
  "InvalidCollectFeeMode"
);

const assertCloseToU64Max = (amount: BN) => {
  expect(
    amount.lte(U64_MAX) && amount.gte(U64_MAX.sub(U64_MAX.divn(100))) // 1% tolerance
  ).eq(true);
};

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

  describe("Funder can withdrawDeadLiquidityReward from DEAD_LIQUIDITY share", () => {
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
      await withdrawDeadLiquidityReward(svm, {
        index: REWARD_INDEX,
        funder,
        pool,
      });
      const recovered = new BN(getTokenBalance(svm, funderRewardAta())).sub(
        funderBefore
      );
      const vaultResidual = new BN(getTokenBalance(svm, rewardVault));

      expect(vaultResidual.eqn(0)).eq(true);
      expect(recovered.gtn(0)).eq(true);
    });

    it("After the last LP exits with withdraw_dead_liquidity_reward2", async () => {
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
      await withdrawDeadLiquidityReward2(svm, {
        index: REWARD_INDEX,
        funder,
        pool,
      });
      const recovered = new BN(getTokenBalance(svm, funderRewardAta())).sub(
        funderBefore
      );
      const vaultResidual = new BN(getTokenBalance(svm, rewardVault));

      expect(vaultResidual.eqn(0)).eq(true);
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
      await withdrawDeadLiquidityReward(svm, {
        index: REWARD_INDEX,
        funder,
        pool,
      });
      const recovered = new BN(getTokenBalance(svm, funderRewardAta())).sub(
        funderBefore
      );
      const vaultResidual = new BN(getTokenBalance(svm, rewardVault));

      expect(vaultResidual.eqn(0)).eq(true);
      expect(recovered.gtn(0)).eq(true);
    });
  });

  it("Funder can re-fund mid-campaign with pending dead-liquidity reward", async () => {
    const { pool, rewardMid, rewardEnd } = await setupFundedCompoundingPool();

    warpToTimestamp(svm, rewardMid);

    // fund again without withdrawing first
    const rewardEndBefore = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .rewardDurationEnd;
    expect(rewardEndBefore.eq(rewardEnd)).eq(true);

    await fundReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      carryForward: false,
      amount: REWARD_AMOUNT,
    });

    const rewardEndAfter = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .rewardDurationEnd;
    expect(rewardEndAfter.gt(rewardEndBefore)).eq(true);
  });

  it("Funder can withdraw dead-liquidity reward mid-campaign", async () => {
    const { pool, rewardMid } = await setupFundedCompoundingPool();

    warpToTimestamp(svm, rewardMid);

    const funderBefore = new BN(getTokenBalance(svm, funderRewardAta()));
    await withdrawDeadLiquidityReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
    });
    const funderAfter = new BN(getTokenBalance(svm, funderRewardAta()));

    expect(funderAfter.gt(funderBefore)).eq(true);
    const checkpointAfterWithdraw = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .deadLiquidityRewardCheckpoint;
    expect(checkpointAfterWithdraw.gtn(0)).eq(true);
  });

  it("dead_liquidity_reward_checkpoint wraps correctly", async () => {
    // 2 reward campaigns that each emit ~u64::MAX of reward as dead_liquidity_reward,
    // so the cumulative checkpoint exceeds u64::MAX and must wrap.
    // if the wrapping happens correctly, the funder should recover ~u64::MAX in round 2

    // top the funder up to exactly u64::MAX reward tokens
    mintSplTokenTo(
      svm,
      rewardMint,
      admin,
      funder.publicKey,
      U64_MAX.sub(new BN(getTokenBalance(svm, funderRewardAta())))
    );

    const { pool, position } = await initializePool(svm, {
      payer: creator,
      creator: creator.publicKey,
      config: compoundingConfig,
      tokenAMint,
      tokenBMint,
      liquidity: DEAD_LIQUIDITY.muln(2),
      sqrtPrice: MIN_SQRT_PRICE.muln(2),
      activationPoint: null,
    });

    await initializeReward(svm, {
      index: REWARD_INDEX,
      payer: creator,
      rewardDuration: new BN(REWARD_DURATION),
      pool,
      rewardMint,
      funder: funder.publicKey,
    });

    // LP exits immediately so DEAD_LIQUIDITY is the only share for the whole campaign
    await fundReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      carryForward: false,
      amount: U64_MAX,
    });
    await removeAllLiquidity(svm, {
      owner: creator,
      pool,
      position,
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    });
    expect(getPool(svm, pool).liquidity.eq(DEAD_LIQUIDITY)).eq(true);

    const rewardEnd1 = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .rewardDurationEnd;
    warpToTimestamp(svm, rewardEnd1.addn(1));

    const funderBefore1 = new BN(getTokenBalance(svm, funderRewardAta()));
    await withdrawDeadLiquidityReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
    });
    const recovered1 = new BN(getTokenBalance(svm, funderRewardAta())).sub(
      funderBefore1
    );

    assertCloseToU64Max(recovered1);

    // total supply is capped at u64::MAX, so fund the recovered balance (~u64::MAX);
    // this pushes the cumulative checkpoint past u64::MAX and forces a wrap
    await fundReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      carryForward: false,
      amount: new BN(getTokenBalance(svm, funderRewardAta())),
    });

    const rewardEnd2 = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .rewardDurationEnd;
    warpToTimestamp(svm, rewardEnd2.addn(1));

    const funderBefore2 = new BN(getTokenBalance(svm, funderRewardAta()));
    await withdrawDeadLiquidityReward(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
    });
    const recovered2 = new BN(getTokenBalance(svm, funderRewardAta())).sub(
      funderBefore2
    );

    // checkpoint has wrapped past u64::MAX; without wrapping this returns 0 or errors
    assertCloseToU64Max(recovered2);
  });

  it("withdrawDeadLiquidityReward fails on a non-compounding pool", async () => {
    const nonCompoundingConfig = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(Math.floor(Math.random() * 1_000_000)),
      {
        poolFees: {
          baseFee: { data: Array.from(baseFeeData()) },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        vaultConfigKey: PublicKey.default,
        poolCreatorAuthority: PublicKey.default,
        activationType: 0,
        collectFeeMode: 0,
      }
    );

    const { pool } = await initializePool(svm, {
      payer: creator,
      creator: creator.publicKey,
      config: nonCompoundingConfig,
      tokenAMint,
      tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      activationPoint: null,
    });

    await initializeReward(svm, {
      index: REWARD_INDEX,
      payer: creator,
      rewardDuration: new BN(REWARD_DURATION),
      pool,
      rewardMint,
      funder: funder.publicKey,
    });

    const tx = await createCpAmmProgram()
      .methods.withdrawDeadLiquidityReward(REWARD_INDEX)
      .accountsPartial({
        pool,
        rewardVault: getPool(svm, pool).rewardInfos[REWARD_INDEX].vault,
        rewardMint,
        poolAuthority: derivePoolAuthority(),
        funderTokenAccount: funderRewardAta(),
        funder: funder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    expectThrowsErrorCode(
      sendTransaction(svm, tx, [funder]),
      invalidCollectFeeModeErrorCode
    );

    await withdrawDeadLiquidityReward2(
      svm,
      {
        index: REWARD_INDEX,
        funder,
        pool,
      },
      invalidCollectFeeModeErrorCode
    );
  });
});

describe("Dead liquidity reward with token 2022 transfer hook", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let funder: Keypair;
  let whitelistedAccount: Keypair;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let rewardMint: PublicKey;
  let rewardHookAccounts: AccountMeta[];
  let pool: PublicKey;
  let rewardVault: PublicKey;

  const REWARD_INDEX = 0;
  const REWARD_DURATION = 24 * 60 * 60; // 1 day
  const REWARD_AMOUNT = new BN(REWARD_DURATION * 1_000);

  const funderRewardAta = () =>
    getAssociatedTokenAddressSync(
      rewardMint,
      funder.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );

  beforeEach(async () => {
    svm = startSvm();

    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    funder = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    const rewardMintKeypair = Keypair.generate();
    rewardMint = rewardMintKeypair.publicKey;

    await createToken2022(
      svm,
      [createTransferHookExtensionWithInstruction(rewardMint, admin.publicKey)],
      rewardMintKeypair,
      admin.publicKey
    );
    await createExtraAccountMetaListAndCounter(svm, admin, rewardMint);
    rewardHookAccounts = getHookRemainingAccounts(rewardMint);

    await mintToToken2022(svm, rewardMint, admin, funder.publicKey);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.CreateTokenBadge,
      ]),
    });

    // compounding config (collectFeeMode = 2)
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          data: Array.from(
            encodeFeeTimeSchedulerParams(
              BigInt(new BN(2_500_000).toString()),
              0,
              BigInt(0),
              BigInt(0),
              BaseFeeMode.FeeTimeSchedulerLinear
            )
          ),
        },
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
    const compoundingConfig = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(Math.floor(Math.random() * 1_000_000)),
      createConfigParams
    );

    // active hook mints require a token badge for reward initialization
    await createTokenBadge(svm, {
      tokenMint: rewardMint,
      whitelistedAddress: whitelistedAccount,
    });

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
    const { pool: newPool, position } = await initializePool(
      svm,
      initPoolParams
    );
    pool = newPool;

    await initializeReward2(svm, {
      index: REWARD_INDEX,
      payer: creator,
      rewardDuration: new BN(REWARD_DURATION),
      pool,
      rewardMint,
      funder: funder.publicKey,
    });

    // funding a hook reward mint goes through fund_reward2 with the hook accounts
    await fundReward2(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      carryForward: true,
      amount: REWARD_AMOUNT,
      rewardHookAccounts,
    });

    // LP exits immediately so DEAD_LIQUIDITY is the only share for the whole campaign
    await removeAllLiquidity(svm, {
      owner: creator,
      pool,
      position,
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    });
    expect(getPool(svm, pool).liquidity.eq(DEAD_LIQUIDITY)).eq(true);

    const rewardEnd = getPool(svm, pool).rewardInfos[REWARD_INDEX]
      .rewardDurationEnd;
    rewardVault = getPool(svm, pool).rewardInfos[REWARD_INDEX].vault;
    warpToTimestamp(svm, rewardEnd.addn(1));
  });

  it("withdraw_dead_liquidity_reward2 invokes the hook on the reward transfer", async () => {
    const beforeCounter = readHookCounter(svm, rewardMint);
    const funderBefore = new BN(getTokenBalance(svm, funderRewardAta()));

    await withdrawDeadLiquidityReward2(svm, {
      index: REWARD_INDEX,
      funder,
      pool,
      rewardHookAccounts,
    });

    const recovered = new BN(getTokenBalance(svm, funderRewardAta())).sub(
      funderBefore
    );
    const vaultResidual = new BN(getTokenBalance(svm, rewardVault));

    expect(vaultResidual.eqn(0)).eq(true);
    expect(recovered.gtn(0)).eq(true);

    // one vault->funder reward transfer
    expect(readHookCounter(svm, rewardMint)).eq(beforeCounter + 1);
  });

  it("withdraw_dead_liquidity_reward2 fails when transfer hook accounts are missing", async () => {
    await withdrawDeadLiquidityReward2(
      svm,
      {
        index: REWARD_INDEX,
        funder,
        pool,
      },
      getCpAmmProgramErrorCode("MissingRemainingAccountForTransferHook")
    );
  });
});
