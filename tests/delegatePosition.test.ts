import {
  createApproveInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import {
  addLiquidity,
  claimPositionFee,
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  derivePositionNftAccount,
  encodePermissions,
  fundReward,
  getPosition,
  getTokenBalance,
  initializePool,
  InitializePoolParams,
  initializeReward,
  lockPosition,
  LockPositionParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  U64_MAX,
  mintSplTokenTo,
  OperatorPermission,
  permanentLockPosition,
  removeLiquidity,
  sendTransaction,
  splitPosition,
  splitPosition2,
  SPLIT_POSITION_DENOMINATOR,
  startSvm,
  swapExactIn,
  warpToTimestamp,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

function buildVestingParams(lockAmount: BN): LockPositionParams {
  const numberOfPeriod = 4;
  const liquidityPerPeriod = lockAmount.divn(2).divn(numberOfPeriod);
  const cliffUnlockLiquidity = lockAmount.sub(
    liquidityPerPeriod.muln(numberOfPeriod)
  );
  return {
    cliffPoint: null,
    periodFrequency: new BN(1),
    cliffUnlockLiquidity,
    liquidityPerPeriod,
    numberOfPeriod,
  };
}

describe("Delegate position lifecycle", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let delegate: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let pool: PublicKey;
  let position1: PublicKey;
  let position2: PublicKey;
  let position1NftAccount: PublicKey;
  let position2NftAccount: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let rewardMint: PublicKey;
  let delegateAtaA: PublicKey;
  let delegateAtaB: PublicKey;
  let delegateAtaReward: PublicKey;
  const configId = Math.floor(Math.random() * 1000);
  const rewardIndex = 0;

  before(async () => {
    svm = startSvm();

    admin = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    delegate = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);
    rewardMint = createToken(svm, admin.publicKey, admin.publicKey);

    delegateAtaA = getAssociatedTokenAddressSync(
      tokenAMint,
      delegate.publicKey
    );
    delegateAtaB = getAssociatedTokenAddressSync(
      tokenBMint,
      delegate.publicKey
    );
    delegateAtaReward = getAssociatedTokenAddressSync(
      rewardMint,
      delegate.publicKey
    );

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    mintSplTokenTo(svm, rewardMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenAMint, admin, delegate.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, delegate.publicKey);

    const cliffFeeNumerator = new BN(2_500_000);
    const data = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
    };

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([OperatorPermission.CreateConfigKey]),
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(configId),
      createConfigParams
    );

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
      activationPoint: null,
    };

    pool = (await initializePool(svm, initPoolParams)).pool;

    position1 = await createPosition(svm, user, user.publicKey, pool);
    position2 = await createPosition(svm, user, user.publicKey, pool);

    position1NftAccount = derivePositionNftAccount(
      getPosition(svm, position1).nftMint
    );
    position2NftAccount = derivePositionNftAccount(
      getPosition(svm, position2).nftMint
    );

    // user delegates position nft account
    for (const nftAccount of [position1NftAccount, position2NftAccount]) {
      const approveTx = new Transaction().add(
        createApproveInstruction(
          nftAccount,
          delegate.publicKey,
          user.publicKey,
          1,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      expect(sendTransaction(svm, approveTx, [user])).instanceOf(
        TransactionMetadata
      );
    }

    await initializeReward(svm, {
      index: rewardIndex,
      payer: creator,
      rewardDuration: new BN(24 * 60 * 60),
      pool,
      rewardMint,
      funder: creator.publicKey,
    });

    warpToTimestamp(svm, new BN(1));

    await fundReward(svm, {
      index: rewardIndex,
      funder: creator,
      pool,
      carryForward: true,
      amount: new BN(1_000_000_000),
    });
  });

  it("delegate adds liquidity to position1", async () => {
    const before = getPosition(svm, position1);
    expect(before.unlockedLiquidity.isZero()).to.be.true;

    const beforeA = new BN(getTokenBalance(svm, delegateAtaA));
    const beforeB = new BN(getTokenBalance(svm, delegateAtaB));

    await addLiquidity(svm, {
      owner: delegate,
      pool,
      position: position1,
      liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    });

    const after = getPosition(svm, position1);
    expect(after.unlockedLiquidity.gt(before.unlockedLiquidity)).to.be.true;

    const afterA = new BN(getTokenBalance(svm, delegateAtaA));
    const afterB = new BN(getTokenBalance(svm, delegateAtaB));
    expect(afterA.lt(beforeA)).to.be.true;
    expect(afterB.lt(beforeB)).to.be.true;
  });

  it("delegate claims position fee on position1", async () => {
    const swapB2A = {
      payer: creator,
      pool,
      inputTokenMint: tokenBMint,
      outputTokenMint: tokenAMint,
      amountIn: new BN(1_000_000_000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    const swapA2B = {
      payer: creator,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(1_000_000_000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    // swap to accumulate fee
    await swapExactIn(svm, swapB2A);
    await swapExactIn(svm, swapA2B);
    await swapExactIn(svm, swapB2A);
    await swapExactIn(svm, swapA2B);

    const beforeA = new BN(getTokenBalance(svm, delegateAtaA));
    const beforeB = new BN(getTokenBalance(svm, delegateAtaB));

    await claimPositionFee(svm, {
      owner: delegate,
      pool,
      position: position1,
    });

    const afterA = new BN(getTokenBalance(svm, delegateAtaA));
    const afterB = new BN(getTokenBalance(svm, delegateAtaB));

    expect(afterA.gt(beforeA)).to.be.true;
    expect(afterB.gt(beforeB)).to.be.true;
  });

  it("delegate claims reward on position1", async () => {
    warpToTimestamp(svm, new BN(60 * 60));

    const beforeReward = new BN(getTokenBalance(svm, delegateAtaReward));

    const result = await claimReward(svm, {
      index: rewardIndex,
      user: delegate,
      pool,
      position: position1,
      skipReward: 0,
    });
    expect(result).instanceOf(TransactionMetadata);

    const afterReward = new BN(getTokenBalance(svm, delegateAtaReward));
    expect(afterReward.gt(beforeReward)).to.be.true;
  });

  it("delegate splits position1 into position2", async () => {
    const beforeFirst = getPosition(svm, position1);
    const beforeSecond = getPosition(svm, position2);

    await splitPosition(svm, {
      firstPositionOwner: delegate,
      secondPositionOwner: delegate,
      pool,
      firstPosition: position1,
      secondPosition: position2,
      firstPositionNftAccount: position1NftAccount,
      secondPositionNftAccount: position2NftAccount,
      unlockedLiquidityPercentage: 20,
      permanentLockedLiquidityPercentage: 0,
      feeAPercentage: 0,
      feeBPercentage: 0,
      reward0Percentage: 0,
      reward1Percentage: 0,
      innerVestingLiquidityPercentage: 0,
    });

    const afterFirst = getPosition(svm, position1);
    const afterSecond = getPosition(svm, position2);

    expect(afterFirst.unlockedLiquidity.lt(beforeFirst.unlockedLiquidity)).to.be
      .true;
    expect(afterSecond.unlockedLiquidity.gt(beforeSecond.unlockedLiquidity)).to
      .be.true;
  });

  it("delegate locks portion of position1 with vesting account", async () => {
    const state = getPosition(svm, position1);
    const params = buildVestingParams(state.unlockedLiquidity.divn(4));

    const beforeVested = state.vestedLiquidity;
    await lockPosition(svm, position1, delegate, delegate, params);

    const after = getPosition(svm, position1);
    expect(after.vestedLiquidity.gt(beforeVested)).to.be.true;
  });

  it("delegate locks inner of position1", async () => {
    const state = getPosition(svm, position1);
    const params = buildVestingParams(state.unlockedLiquidity.divn(4));

    const beforeVested = state.vestedLiquidity;
    await lockPosition(svm, position1, delegate, delegate, params, true);

    const after = getPosition(svm, position1);
    expect(after.vestedLiquidity.gt(beforeVested)).to.be.true;
  });

  it("delegate removes part of unlocked liquidity from position1", async () => {
    const before = getPosition(svm, position1);
    expect(before.unlockedLiquidity.gt(new BN(0))).to.be.true;

    const beforeA = new BN(getTokenBalance(svm, delegateAtaA));
    const beforeB = new BN(getTokenBalance(svm, delegateAtaB));

    await removeLiquidity(svm, {
      owner: delegate,
      pool,
      position: position1,
      liquidityDelta: before.unlockedLiquidity.divn(2),
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    });

    const after = getPosition(svm, position1);
    expect(after.unlockedLiquidity.lt(before.unlockedLiquidity)).to.be.true;

    const afterA = new BN(getTokenBalance(svm, delegateAtaA));
    const afterB = new BN(getTokenBalance(svm, delegateAtaB));
    expect(afterA.gt(beforeA) || afterB.gt(beforeB)).to.be.true;
  });

  it("delegate permanent-locks position2", async () => {
    const before = getPosition(svm, position2);
    expect(before.unlockedLiquidity.gt(new BN(0))).to.be.true;

    await permanentLockPosition(svm, position2, delegate, delegate);

    const after = getPosition(svm, position2);
    expect(after.permanentLockedLiquidity.gt(new BN(0))).to.be.true;
    expect(after.unlockedLiquidity.isZero()).to.be.true;
  });

  it("delegate split_position2 between two fresh positions", async () => {
    const fromPosition = await createPosition(svm, user, user.publicKey, pool);
    const toPosition = await createPosition(svm, user, user.publicKey, pool);
    const fromPositionNftAccount = derivePositionNftAccount(
      getPosition(svm, fromPosition).nftMint
    );
    const toPositionNftAccount = derivePositionNftAccount(
      getPosition(svm, toPosition).nftMint
    );

    // user approves delegate on both new NFTs
    for (const nftAccount of [fromPositionNftAccount, toPositionNftAccount]) {
      sendTransaction(
        svm,
        new Transaction().add(
          createApproveInstruction(
            nftAccount,
            delegate.publicKey,
            user.publicKey,
            1,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        ),
        [user]
      );
    }

    await addLiquidity(svm, {
      owner: delegate,
      pool,
      position: fromPosition,
      liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    });

    const beforeFrom = getPosition(svm, fromPosition);
    const beforeTo = getPosition(svm, toPosition);

    const result = await splitPosition2(svm, {
      firstPositionOwner: delegate,
      secondPositionOwner: delegate,
      pool,
      firstPosition: fromPosition,
      secondPosition: toPosition,
      firstPositionNftAccount: fromPositionNftAccount,
      secondPositionNftAccount: toPositionNftAccount,
      numerator: SPLIT_POSITION_DENOMINATOR / 5,
    });
    expect(result).instanceOf(TransactionMetadata);

    const afterFrom = getPosition(svm, fromPosition);
    const afterTo = getPosition(svm, toPosition);
    expect(afterFrom.unlockedLiquidity.lt(beforeFrom.unlockedLiquidity)).to.be
      .true;
    expect(afterTo.unlockedLiquidity.gt(beforeTo.unlockedLiquidity)).to.be.true;
  });
});
