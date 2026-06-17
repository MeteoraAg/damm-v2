import {
  AuthorityType,
  createApproveInstruction,
  createBurnCheckedInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import {
  ANCHOR_CONSTRAINT_TOKEN_OWNER_ERROR_CODE,
  addLiquidity,
  claimPositionFee,
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createCpAmmProgram,
  createOperator,
  createPosition,
  createToken,
  derivePositionNftAccount,
  deriveRewardVaultAddress,
  encodeDelegatePermissions,
  encodePermissions,
  fundReward,
  getCpAmmProgramErrorCode,
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
  PositionDelegatePermission,
  removeLiquidity,
  sendTransaction,
  updateDelegatePermission,
  startSvm,
  swapExactIn,
  SwapParams,
  warpToTimestamp,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { expectThrowsErrorCode } from "./helpers/svm";
import {
  freezeTokenAccount,
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
} from "./helpers/token";

const INVALID_AUTHORITY_CODE = getCpAmmProgramErrorCode("InvalidAuthority");
const INVALID_PERMISSION_CODE = getCpAmmProgramErrorCode("InvalidPermission");
const INVALID_DESTINATION_CODE = getCpAmmProgramErrorCode("IncorrectATA");

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

describe("Delegate Position", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let delegate: Keypair;
  let nonAuthorizedUser: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let pool: PublicKey;
  let position1: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let rewardMint: PublicKey;
  let delegateAtaA: PublicKey;
  let delegateAtaB: PublicKey;
  let delegateAtaReward: PublicKey;
  let swapB2A: SwapParams;
  let swapA2B: SwapParams;
  const configId = Math.floor(Math.random() * 1000);
  const rewardIndex = 0;

  before(async () => {
    svm = startSvm();

    admin = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    delegate = generateKpAndFund(svm);
    nonAuthorizedUser = generateKpAndFund(svm);
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

    getOrCreateAssociatedTokenAccount(
      svm,
      nonAuthorizedUser,
      tokenAMint,
      nonAuthorizedUser.publicKey,
      TOKEN_PROGRAM_ID
    );
    getOrCreateAssociatedTokenAccount(
      svm,
      nonAuthorizedUser,
      tokenBMint,
      nonAuthorizedUser.publicKey,
      TOKEN_PROGRAM_ID
    );
    getOrCreateAssociatedTokenAccount(
      svm,
      nonAuthorizedUser,
      rewardMint,
      nonAuthorizedUser.publicKey,
      TOKEN_PROGRAM_ID
    );

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    mintSplTokenTo(svm, rewardMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenAMint, admin, delegate.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, delegate.publicKey);
    mintSplTokenTo(
      svm,
      tokenAMint,
      admin,
      user.publicKey,
      new BN(1_000_000).muln(10 ** 6)
    );
    mintSplTokenTo(
      svm,
      tokenBMint,
      admin,
      user.publicKey,
      new BN(1_000_000).muln(10 ** 6)
    );

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

    swapB2A = {
      payer: creator,
      pool,
      inputTokenMint: tokenBMint,
      outputTokenMint: tokenAMint,
      amountIn: new BN(1_000_000_000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
    swapA2B = {
      payer: creator,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(1_000_000_000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    position1 = await createPosition(svm, user, user.publicKey, pool);

    // user grants delegate full permissions on position1
    const fullPermission = encodeDelegatePermissions([
      PositionDelegatePermission.AddLiquidity,
      PositionDelegatePermission.RemoveLiquidity,
      PositionDelegatePermission.ClaimPositionFee,
      PositionDelegatePermission.ClaimReward,
      PositionDelegatePermission.LockPosition,
    ]);
    await updateDelegatePermission(svm, {
      owner: user,
      position: position1,
      delegate: delegate.publicKey,
      permission: fullPermission,
    });

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

  describe("Lifecycle", () => {
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

      await addLiquidity(
        svm,
        {
          owner: nonAuthorizedUser,
          pool,
          position: position1,
          liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
          tokenAAmountThreshold: U64_MAX,
          tokenBAmountThreshold: U64_MAX,
        },
        INVALID_AUTHORITY_CODE
      );
    });

    it("delegate claims position fee on position1", async () => {
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

      await claimPositionFee(
        svm,
        { owner: nonAuthorizedUser, pool, position: position1 },
        INVALID_AUTHORITY_CODE
      );
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

      const failResult = await claimReward(svm, {
        index: rewardIndex,
        user: nonAuthorizedUser,
        pool,
        position: position1,
        skipReward: 0,
      });
      expectThrowsErrorCode(failResult, INVALID_AUTHORITY_CODE);
    });

    it("delegate locks portion of position1 with vesting account", async () => {
      const state = getPosition(svm, position1);
      const params = buildVestingParams(state.unlockedLiquidity.divn(4));

      const beforeVested = state.vestedLiquidity;
      await lockPosition(svm, position1, delegate, delegate, params);

      const after = getPosition(svm, position1);
      expect(after.vestedLiquidity.gt(beforeVested)).to.be.true;

      await lockPosition(
        svm,
        position1,
        nonAuthorizedUser,
        nonAuthorizedUser,
        params,
        false,
        INVALID_AUTHORITY_CODE
      );
    });

    it("delegate locks inner of position1", async () => {
      const state = getPosition(svm, position1);
      const params = buildVestingParams(state.unlockedLiquidity.divn(4));

      const beforeVested = state.vestedLiquidity;
      await lockPosition(svm, position1, delegate, delegate, params, true);

      const after = getPosition(svm, position1);
      expect(after.vestedLiquidity.gt(beforeVested)).to.be.true;

      await lockPosition(
        svm,
        position1,
        nonAuthorizedUser,
        nonAuthorizedUser,
        params,
        true,
        INVALID_AUTHORITY_CODE
      );
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

      await removeLiquidity(
        svm,
        {
          owner: nonAuthorizedUser,
          pool,
          position: position1,
          liquidityDelta: before.unlockedLiquidity.divn(2),
          tokenAAmountThreshold: new BN(0),
          tokenBAmountThreshold: new BN(0),
        },
        INVALID_AUTHORITY_CODE
      );
    });

    it("delegate permanent-locks position1", async () => {
      const before = getPosition(svm, position1);
      expect(before.unlockedLiquidity.gt(new BN(0))).to.be.true;

      await permanentLockPosition(svm, position1, delegate, delegate);

      const after = getPosition(svm, position1);
      expect(after.permanentLockedLiquidity.gt(new BN(0))).to.be.true;
      expect(after.unlockedLiquidity.isZero()).to.be.true;

      await permanentLockPosition(
        svm,
        position1,
        nonAuthorizedUser,
        nonAuthorizedUser,
        INVALID_AUTHORITY_CODE
      );
    });
  });

  describe("Permission handling", () => {
    let targetPosition: PublicKey;
    let targetNftAccount: PublicKey;

    beforeEach(async () => {
      targetPosition = await createPosition(svm, user, user.publicKey, pool);
      targetNftAccount = derivePositionNftAccount(
        getPosition(svm, targetPosition).nftMint
      );
    });

    it("rejects when spl approve without delegate permission", async () => {
      const approveTx = new Transaction().add(
        createApproveInstruction(
          targetNftAccount,
          delegate.publicKey,
          user.publicKey,
          0,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      expect(sendTransaction(svm, approveTx, [user])).instanceOf(
        TransactionMetadata
      );

      await addLiquidity(
        svm,
        {
          owner: delegate,
          pool,
          position: targetPosition,
          liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
          tokenAAmountThreshold: U64_MAX,
          tokenBAmountThreshold: U64_MAX,
        },
        INVALID_PERMISSION_CODE
      );
    });

    it("rejects when delegate permission set without spl approve", async () => {
      const program = createCpAmmProgram();
      const ix = await program.methods
        .updateDelegatePermission(
          encodeDelegatePermissions([PositionDelegatePermission.AddLiquidity])
        )
        .accountsPartial({
          position: targetPosition,
          positionNftAccount: targetNftAccount,
          owner: user.publicKey,
        })
        .instruction();
      expect(
        sendTransaction(svm, new Transaction().add(ix), [user])
      ).instanceOf(TransactionMetadata);

      await addLiquidity(
        svm,
        {
          owner: delegate,
          pool,
          position: targetPosition,
          liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
          tokenAAmountThreshold: U64_MAX,
          tokenBAmountThreshold: U64_MAX,
        },
        INVALID_AUTHORITY_CODE
      );
    });

    it("rejects after owner revokes permission", async () => {
      await updateDelegatePermission(svm, {
        owner: user,
        position: targetPosition,
        delegate: delegate.publicKey,
        permission: encodeDelegatePermissions([
          PositionDelegatePermission.AddLiquidity,
        ]),
      });

      await addLiquidity(svm, {
        owner: delegate,
        pool,
        position: targetPosition,
        liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      });

      await updateDelegatePermission(svm, {
        owner: user,
        position: targetPosition,
        delegate: delegate.publicKey,
        permission: encodeDelegatePermissions([]),
      });

      await addLiquidity(
        svm,
        {
          owner: delegate,
          pool,
          position: targetPosition,
          liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
          tokenAAmountThreshold: U64_MAX,
          tokenBAmountThreshold: U64_MAX,
        },
        INVALID_PERMISSION_CODE
      );
    });

    it("rejects when delegate attempts to update permission", async () => {
      await updateDelegatePermission(svm, {
        owner: user,
        position: targetPosition,
        delegate: delegate.publicKey,
        permission: encodeDelegatePermissions([
          PositionDelegatePermission.AddLiquidity,
        ]),
      });

      const program = createCpAmmProgram();
      const ix = await program.methods
        .updateDelegatePermission(encodeDelegatePermissions([]))
        .accountsPartial({
          position: targetPosition,
          positionNftAccount: targetNftAccount,
          owner: delegate.publicKey,
        })
        .instruction();
      const tx = new Transaction().add(ix);
      const result = sendTransaction(svm, tx, [delegate]);
      expectThrowsErrorCode(result, ANCHOR_CONSTRAINT_TOKEN_OWNER_ERROR_CODE);
    });

    it("permission inheritance after nft transfer", async () => {
      const newOwner = generateKpAndFund(svm);
      const newDelegate = generateKpAndFund(svm);
      const mintAmount = new BN(1_000_000).muln(10 ** 6);
      mintSplTokenTo(svm, tokenAMint, admin, newDelegate.publicKey, mintAmount);
      mintSplTokenTo(svm, tokenBMint, admin, newDelegate.publicKey, mintAmount);

      await updateDelegatePermission(svm, {
        owner: user,
        position: targetPosition,
        delegate: delegate.publicKey,
        permission: encodeDelegatePermissions([
          PositionDelegatePermission.AddLiquidity,
        ]),
      });

      // transfer nft
      const transferTx = new Transaction().add(
        createSetAuthorityInstruction(
          targetNftAccount,
          user.publicKey,
          AuthorityType.AccountOwner,
          newOwner.publicKey,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      expect(sendTransaction(svm, transferTx, [user])).instanceOf(
        TransactionMetadata
      );

      // set new delegate
      const approveTx = new Transaction().add(
        createApproveInstruction(
          targetNftAccount,
          newDelegate.publicKey,
          newOwner.publicKey,
          0,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      expect(sendTransaction(svm, approveTx, [newOwner])).instanceOf(
        TransactionMetadata
      );

      // newDelegate inherits existing perms
      const before = getPosition(svm, targetPosition);
      await addLiquidity(svm, {
        owner: newDelegate,
        pool,
        position: targetPosition,
        liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      });

      const after = getPosition(svm, targetPosition);
      expect(after.unlockedLiquidity.gt(before.unlockedLiquidity)).to.be.true;
    });

    it("delegate cannot transfer or burn nft", async () => {
      await updateDelegatePermission(svm, {
        owner: user,
        position: targetPosition,
        delegate: delegate.publicKey,
        permission: encodeDelegatePermissions([
          PositionDelegatePermission.AddLiquidity,
        ]),
      });

      const nftMint = getPosition(svm, targetPosition).nftMint;

      const delegateAta = getOrCreateAssociatedTokenAccount(
        svm,
        delegate,
        nftMint,
        delegate.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const transferTx = new Transaction().add(
        createTransferCheckedInstruction(
          targetNftAccount,
          nftMint,
          delegateAta,
          delegate.publicKey,
          1,
          0,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      expect(sendTransaction(svm, transferTx, [delegate])).instanceOf(
        FailedTransactionMetadata
      );

      const delegateNft = getTokenAccount(svm, delegateAta);
      expect(delegateNft.amount.toString()).to.equal("0");

      let ownerNft = getTokenAccount(svm, targetNftAccount);
      expect(ownerNft.amount.toString()).to.equal("1");

      const burnTx = new Transaction().add(
        createBurnCheckedInstruction(
          targetNftAccount,
          nftMint,
          delegate.publicKey,
          1,
          0,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      expect(sendTransaction(svm, burnTx, [delegate])).instanceOf(
        FailedTransactionMetadata
      );

      ownerNft = getTokenAccount(svm, targetNftAccount);
      expect(ownerNft.amount.toString()).to.equal("1");
    });
  });

  describe("ToOwner permissions", () => {
    let targetPosition: PublicKey;
    let userAtaA: PublicKey;
    let userAtaB: PublicKey;
    let userAtaReward: PublicKey;

    before(() => {
      userAtaA = getOrCreateAssociatedTokenAccount(
        svm,
        user,
        tokenAMint,
        user.publicKey,
        TOKEN_PROGRAM_ID
      );
      userAtaB = getOrCreateAssociatedTokenAccount(
        svm,
        user,
        tokenBMint,
        user.publicKey,
        TOKEN_PROGRAM_ID
      );
      userAtaReward = getOrCreateAssociatedTokenAccount(
        svm,
        user,
        rewardMint,
        user.publicKey,
        TOKEN_PROGRAM_ID
      );
    });

    beforeEach(async () => {
      targetPosition = await createPosition(svm, user, user.publicKey, pool);

      await addLiquidity(svm, {
        owner: user,
        pool,
        position: targetPosition,
        liquidityDelta: new BN(MIN_SQRT_PRICE).muln(1_000_000),
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      });

      await swapExactIn(svm, swapB2A);
      await swapExactIn(svm, swapA2B);
    });

    describe("RemoveLiquidity", () => {
      it("delegate can remove to owner ATA", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.RemoveLiquidityToOwner,
          ]),
        });

        const before = getPosition(svm, targetPosition);
        await removeLiquidity(svm, {
          owner: delegate,
          pool,
          position: targetPosition,
          liquidityDelta: before.unlockedLiquidity.divn(2),
          tokenAAmountThreshold: new BN(0),
          tokenBAmountThreshold: new BN(0),
          tokenAAccount: userAtaA,
          tokenBAccount: userAtaB,
        });
        const after = getPosition(svm, targetPosition);
        expect(after.unlockedLiquidity.lt(before.unlockedLiquidity)).to.be.true;
      });

      it("delegate cannot remove to delegate ATA", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.RemoveLiquidityToOwner,
          ]),
        });

        const state = getPosition(svm, targetPosition);
        await removeLiquidity(
          svm,
          {
            owner: delegate,
            pool,
            position: targetPosition,
            liquidityDelta: state.unlockedLiquidity.divn(2),
            tokenAAmountThreshold: new BN(0),
            tokenBAmountThreshold: new BN(0),
            tokenAAccount: delegateAtaA,
            tokenBAccount: delegateAtaB,
          },
          INVALID_DESTINATION_CODE
        );
      });

      it("delegate with neither perm is rejected", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.AddLiquidity,
          ]),
        });

        const state = getPosition(svm, targetPosition);
        await removeLiquidity(
          svm,
          {
            owner: delegate,
            pool,
            position: targetPosition,
            liquidityDelta: state.unlockedLiquidity.divn(2),
            tokenAAmountThreshold: new BN(0),
            tokenBAmountThreshold: new BN(0),
            tokenAAccount: userAtaA,
            tokenBAccount: userAtaB,
          },
          INVALID_PERMISSION_CODE
        );
      });
    });

    describe("ClaimPositionFee", () => {
      it("delegate can claim to owner ATA", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.ClaimPositionFeeToOwner,
          ]),
        });

        const beforeA = new BN(getTokenBalance(svm, userAtaA));
        const beforeB = new BN(getTokenBalance(svm, userAtaB));
        await claimPositionFee(svm, {
          owner: delegate,
          pool,
          position: targetPosition,
          tokenAAccount: userAtaA,
          tokenBAccount: userAtaB,
        });
        const afterA = new BN(getTokenBalance(svm, userAtaA));
        const afterB = new BN(getTokenBalance(svm, userAtaB));
        expect(afterA.gt(beforeA) || afterB.gt(beforeB)).to.be.true;
      });

      it("delegate cannot claim to delegate ATA", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.ClaimPositionFeeToOwner,
          ]),
        });

        await claimPositionFee(
          svm,
          {
            owner: delegate,
            pool,
            position: targetPosition,
            tokenAAccount: delegateAtaA,
            tokenBAccount: delegateAtaB,
          },
          INVALID_DESTINATION_CODE
        );
      });

      it("delegate with neither perm is rejected", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.AddLiquidity,
          ]),
        });

        await claimPositionFee(
          svm,
          {
            owner: delegate,
            pool,
            position: targetPosition,
            tokenAAccount: userAtaA,
            tokenBAccount: userAtaB,
          },
          INVALID_PERMISSION_CODE
        );
      });
    });

    describe("ClaimReward", () => {
      beforeEach(() => {
        const clock = svm.getClock();
        warpToTimestamp(
          svm,
          new BN(clock.unixTimestamp.toString()).addn(60 * 60)
        );
      });

      it("delegate can claim to owner ATA", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.ClaimRewardToOwner,
          ]),
        });

        const before = new BN(getTokenBalance(svm, userAtaReward));
        const result = await claimReward(svm, {
          index: rewardIndex,
          user: delegate,
          pool,
          position: targetPosition,
          skipReward: 0,
          userTokenAccount: userAtaReward,
        });
        expect(result).instanceOf(TransactionMetadata);
        const after = new BN(getTokenBalance(svm, userAtaReward));
        expect(after.gt(before)).to.be.true;

        // delegate with ClaimRewardToOwner permission must not be able to discard pending
        // reward via skip_reward when the vault is frozen
        const rewardVault = deriveRewardVaultAddress(pool, rewardIndex);
        freezeTokenAccount(svm, admin, rewardMint, rewardVault);
        expect(getTokenAccount(svm, rewardVault).state).eq(2); // frozen

        const skipResult = await claimReward(svm, {
          index: rewardIndex,
          user: delegate,
          pool,
          position: targetPosition,
          skipReward: 1,
          userTokenAccount: userAtaReward,
        });
        expectThrowsErrorCode(skipResult, INVALID_PERMISSION_CODE);

        // delegate with ClaimReward permission can discard the pending reward
        // on a frozen vault without any transfer
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.ClaimReward,
          ]),
        });

        const beforeDelegate = new BN(getTokenBalance(svm, delegateAtaReward));
        const discardResult = await claimReward(svm, {
          index: rewardIndex,
          user: delegate,
          pool,
          position: targetPosition,
          skipReward: 1,
          userTokenAccount: userAtaReward,
        });
        expect(discardResult).instanceOf(TransactionMetadata);
        const positionState = getPosition(svm, targetPosition);
        expect(
          positionState.rewardInfos[rewardIndex].rewardPendings.toNumber()
        ).eq(0);
        const afterDelegate = new BN(getTokenBalance(svm, delegateAtaReward));
        expect(afterDelegate.eq(beforeDelegate)).to.be.true;
      });

      it("delegate cannot claim to delegate ATA", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.ClaimRewardToOwner,
          ]),
        });

        const result = await claimReward(svm, {
          index: rewardIndex,
          user: delegate,
          pool,
          position: targetPosition,
          skipReward: 0,
          userTokenAccount: delegateAtaReward,
        });
        expectThrowsErrorCode(result, INVALID_DESTINATION_CODE);
      });

      it("delegate with neither perm is rejected", async () => {
        await updateDelegatePermission(svm, {
          owner: user,
          position: targetPosition,
          delegate: delegate.publicKey,
          permission: encodeDelegatePermissions([
            PositionDelegatePermission.AddLiquidity,
          ]),
        });

        const result = await claimReward(svm, {
          index: rewardIndex,
          user: delegate,
          pool,
          position: targetPosition,
          skipReward: 0,
          userTokenAccount: userAtaReward,
        });
        expectThrowsErrorCode(result, INVALID_PERMISSION_CODE);
      });
    });
  });
});
