import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { describe } from "mocha";
import {
  addLiquidity,
  AddLiquidityParams,
  claimReward,
  claimReward2,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  createTokenBadge,
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
  startSvm,
  U64_MAX,
  updateRewardDuration,
  updateRewardFunder,
  warpToTimestamp,
  withdrawIneligibleReward,
  withdrawIneligibleReward2,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import {
  createExtraAccountMetaListAndCounter,
  getHookRemainingAccounts,
  readHookCounter,
} from "./helpers/transferHook";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

describe("Reward by creator", () => {
  // SPL-Token
  describe("Reward with SPL-Token", () => {
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

      tokenAMint = createToken(svm, admin.publicKey);
      tokenBMint = createToken(svm, admin.publicKey);

      rewardMint = createToken(svm, admin.publicKey);

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

    it("Full flow for reward", async () => {
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
        liquidityDelta: new BN(MIN_LP_AMOUNT),
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
        funder: creator.publicKey,
      };
      await initializeReward(svm, initRewardParams);

      warpToTimestamp(svm, new BN(1));

      // update duration
      await updateRewardDuration(svm, {
        index,
        signer: creator,
        pool,
        newDuration: new BN(2 * 24 * 60 * 60),
      });

      // update new funder
      await updateRewardFunder(svm, {
        index,
        signer: creator,
        pool,
        newFunder: funder.publicKey,
      });

      // fund reward
      await fundReward(svm, {
        index,
        funder: funder,
        pool,
        carryForward: true,
        amount: new BN(1_000_000_000),
      });

      // let rewards accrue
      let currentClock = svm.getClock();
      const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
      warpToTimestamp(svm, new BN(newTimestamp));

      // claim reward

      const userRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        user.publicKey,
        true
      );
      const beforeRewardBalance = Number(
        getTokenBalance(svm, userRewardAccount)
      );

      await claimReward(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });

      expect(Number(getTokenBalance(svm, userRewardAccount))).gt(
        beforeRewardBalance
      );

      // claim ineligible reward
      const poolState = getPool(svm, pool);
      // set new timestamp to pass reward duration end
      const timestamp =
        poolState.rewardInfos[index].rewardDurationEnd.addn(5000);

      warpToTimestamp(svm, new BN(timestamp));

      await withdrawIneligibleReward(svm, {
        index,
        funder,
        pool,
      });
    });

    it("Full flow for reward with claim_reward2 and withdraw_ineligible_reward2", async () => {
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

      const { pool, position: creatorPosition } = await initializePool(
        svm,
        initPoolParams
      );

      // user create postion and add liquidity
      const position = await createPosition(svm, user, user.publicKey, pool);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_LP_AMOUNT),
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
        funder: creator.publicKey,
      };
      await initializeReward(svm, initRewardParams);

      warpToTimestamp(svm, new BN(1));

      // update duration
      await updateRewardDuration(svm, {
        index,
        signer: creator,
        pool,
        newDuration: new BN(2 * 24 * 60 * 60),
      });

      // update new funder
      await updateRewardFunder(svm, {
        index,
        signer: creator,
        pool,
        newFunder: funder.publicKey,
      });

      // fund reward
      await fundReward(svm, {
        index,
        funder: funder,
        pool,
        carryForward: true,
        amount: new BN(1_000_000_000),
      });

      // let rewards accrue
      let currentClock = svm.getClock();
      const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
      warpToTimestamp(svm, new BN(newTimestamp));

      // claim reward
      const userRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        user.publicKey,
        true
      );
      const beforeRewardBalance = Number(
        getTokenBalance(svm, userRewardAccount)
      );

      const claimResult = await claimReward2(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });
      expect(claimResult).instanceOf(TransactionMetadata);

      expect(Number(getTokenBalance(svm, userRewardAccount))).gt(
        beforeRewardBalance
      );

      // empty the pool so the remaining reward window accrues as ineligible
      await removeAllLiquidity(svm, {
        owner: user,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });
      await removeAllLiquidity(svm, {
        owner: creator,
        pool,
        position: creatorPosition,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });

      // set new timestamp to pass reward duration end
      const poolState = getPool(svm, pool);
      const timestamp =
        poolState.rewardInfos[index].rewardDurationEnd.addn(5000);
      warpToTimestamp(svm, new BN(timestamp));

      const funderRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        funder.publicKey,
        true
      );
      const beforeFunderBalance = Number(
        getTokenBalance(svm, funderRewardAccount)
      );

      await withdrawIneligibleReward2(svm, {
        index,
        funder,
        pool,
      });

      expect(Number(getTokenBalance(svm, funderRewardAccount))).gt(
        beforeFunderBalance
      );
    });

    it("Creator cannot create reward at index 1", async () => {
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
        liquidityDelta: new BN(100),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
      };
      await addLiquidity(svm, addLiquidityParams);

      // init reward
      const index = 1;
      const initRewardParams: InitializeRewardParams = {
        index,
        payer: creator,
        rewardDuration: new BN(24 * 60 * 60),
        pool,
        rewardMint,
        funder: creator.publicKey,
      };

      const errorCode = getCpAmmProgramErrorCode("MissingOperatorAccount");
      const res = await initializeReward(svm, initRewardParams);
      expectThrowsErrorCode(res, errorCode);
    });
  });

  // SPL-Token2022

  describe("Reward SPL-Token 2022", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let config: PublicKey;
    let funder: Keypair;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    let user: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let rewardMint: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    const configId = Math.floor(Math.random() * 1000);

    beforeEach(async () => {
      svm = startSvm();

      const tokenAMintKeypair = Keypair.generate();
      const tokenBMintKeypair = Keypair.generate();
      const rewardMintKeypair = Keypair.generate();

      tokenAMint = tokenAMintKeypair.publicKey;
      tokenBMint = tokenBMintKeypair.publicKey;
      rewardMint = rewardMintKeypair.publicKey;

      const tokenAExtensions = [
        createTransferFeeExtensionWithInstruction(tokenAMint),
      ];
      const tokenBExtensions = [
        createTransferFeeExtensionWithInstruction(tokenBMint),
      ];

      const rewardExtensions = [
        createTransferFeeExtensionWithInstruction(rewardMint),
      ];

      user = generateKpAndFund(svm);
      funder = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      await createToken2022(
        svm,
        tokenAExtensions,
        tokenAMintKeypair,
        admin.publicKey
      );
      await createToken2022(
        svm,
        tokenBExtensions,
        tokenBMintKeypair,
        admin.publicKey
      );

      await createToken2022(
        svm,
        rewardExtensions,
        rewardMintKeypair,
        admin.publicKey
      );

      await mintToToken2022(svm, tokenAMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

      await mintToToken2022(svm, rewardMint, admin, funder.publicKey);

      await mintToToken2022(svm, rewardMint, admin, admin.publicKey);

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

    it("Full flow for reward", async () => {
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
        liquidityDelta: new BN(MIN_LP_AMOUNT),
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
        funder: creator.publicKey,
      };
      await initializeReward(svm, initRewardParams);

      warpToTimestamp(svm, new BN(1));

      // update duration
      await updateRewardDuration(svm, {
        index,
        signer: creator,
        pool,
        newDuration: new BN(2 * 24 * 60 * 60),
      });

      // update new funder
      await updateRewardFunder(svm, {
        index,
        signer: creator,
        pool,
        newFunder: funder.publicKey,
      });

      console.log("fund reward");
      // fund reward
      await fundReward(svm, {
        index,
        funder: funder,
        pool,
        carryForward: true,
        amount: new BN(1_000_000_000),
      });

      let currentClock = svm.getClock();
      const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
      warpToTimestamp(svm, new BN(newTimestamp));

      // claim reward

      const userRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        user.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const beforeRewardBalance = Number(
        getTokenBalance(svm, userRewardAccount)
      );

      await claimReward(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });

      expect(Number(getTokenBalance(svm, userRewardAccount))).gt(
        beforeRewardBalance
      );

      // claim ineligible reward
      const poolState = getPool(svm, pool);
      // set new timestamp to pass reward duration end
      const timestamp =
        poolState.rewardInfos[index].rewardDurationEnd.addn(5000);
      warpToTimestamp(svm, new BN(timestamp));

      await withdrawIneligibleReward(svm, {
        index,
        funder,
        pool,
      });
    });

    it("Full flow for reward with claim_reward2 and withdraw_ineligible_reward2", async () => {
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

      const { pool, position: creatorPosition } = await initializePool(
        svm,
        initPoolParams
      );

      // user create postion and add liquidity
      const position = await createPosition(svm, user, user.publicKey, pool);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_LP_AMOUNT),
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
        funder: creator.publicKey,
      };
      await initializeReward(svm, initRewardParams);

      warpToTimestamp(svm, new BN(1));

      // update duration
      await updateRewardDuration(svm, {
        index,
        signer: creator,
        pool,
        newDuration: new BN(2 * 24 * 60 * 60),
      });

      // update new funder
      await updateRewardFunder(svm, {
        index,
        signer: creator,
        pool,
        newFunder: funder.publicKey,
      });

      // fund reward
      await fundReward(svm, {
        index,
        funder: funder,
        pool,
        carryForward: true,
        amount: new BN(1_000_000_000),
      });

      let currentClock = svm.getClock();
      const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
      warpToTimestamp(svm, new BN(newTimestamp));

      // claim reward
      const userRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        user.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const beforeRewardBalance = Number(
        getTokenBalance(svm, userRewardAccount)
      );

      const claimResult = await claimReward2(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });
      expect(claimResult).instanceOf(TransactionMetadata);

      expect(Number(getTokenBalance(svm, userRewardAccount))).gt(
        beforeRewardBalance
      );

      // empty the pool so the remaining reward window accrues as ineligible
      await removeAllLiquidity(svm, {
        owner: user,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });
      await removeAllLiquidity(svm, {
        owner: creator,
        pool,
        position: creatorPosition,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });

      // set new timestamp to pass reward duration end
      const poolState = getPool(svm, pool);
      const timestamp =
        poolState.rewardInfos[index].rewardDurationEnd.addn(5000);
      warpToTimestamp(svm, new BN(timestamp));

      const funderRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        funder.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const beforeFunderBalance = Number(
        getTokenBalance(svm, funderRewardAccount)
      );

      await withdrawIneligibleReward2(svm, {
        index,
        funder,
        pool,
      });

      expect(Number(getTokenBalance(svm, funderRewardAccount))).gt(
        beforeFunderBalance
      );
    });

    it("Creator cannot create reward at index 1", async () => {
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
        liquidityDelta: new BN(100),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
      };
      await addLiquidity(svm, addLiquidityParams);

      // init reward
      const index = 1;
      const initRewardParams: InitializeRewardParams = {
        index,
        payer: creator,
        rewardDuration: new BN(24 * 60 * 60),
        pool,
        rewardMint,
        funder: creator.publicKey,
      };
      const errorCode = getCpAmmProgramErrorCode("MissingOperatorAccount");
      const res = await initializeReward(svm, initRewardParams);
      expectThrowsErrorCode(res, errorCode);
    });
  });

  describe("Reward with token 2022 transfer hook", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    let funder: Keypair;
    let user: Keypair;
    let config: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let rewardMint: PublicKey;
    let rewardHookAccounts: AccountMeta[];
    let pool: PublicKey;
    let position: PublicKey;
    let creatorPosition: PublicKey;
    const configId = Math.floor(Math.random() * 1000);
    const index = 0;

    beforeEach(async () => {
      svm = startSvm();

      user = generateKpAndFund(svm);
      funder = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      tokenAMint = createToken(svm, admin.publicKey);
      tokenBMint = createToken(svm, admin.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

      const rewardMintKeypair = Keypair.generate();
      rewardMint = rewardMintKeypair.publicKey;

      await createToken2022(
        svm,
        [
          createTransferHookExtensionWithInstruction(
            rewardMint,
            admin.publicKey
          ),
        ],
        rewardMintKeypair,
        admin.publicKey
      );
      await createExtraAccountMetaListAndCounter(svm, admin, rewardMint);
      rewardHookAccounts = getHookRemainingAccounts(rewardMint);

      await mintToToken2022(svm, rewardMint, admin, funder.publicKey);

      const cliffFeeNumerator = new BN(2_500_000);

      const data = encodeFeeTimeSchedulerParams(
        BigInt(cliffFeeNumerator.toString()),
        0,
        BigInt(0),
        BigInt(0),
        BaseFeeMode.FeeTimeSchedulerLinear
      );

      // create config
      const createConfigParams: CreateConfigParams = {
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
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

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.CreateTokenBadge,
      ]);

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

      // active hook mints require a token badge for reward initialization
      await createTokenBadge(svm, {
        tokenMint: rewardMint,
        whitelistedAddress: whitelistedAccount,
      });

      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(MIN_SQRT_PRICE),
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);
      pool = result.pool;
      creatorPosition = result.position;

      // user create postion and add liquidity
      position = await createPosition(svm, user, user.publicKey, pool);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_LP_AMOUNT),
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      // init reward
      const initRewardParams: InitializeRewardParams = {
        index,
        payer: creator,
        rewardDuration: new BN(24 * 60 * 60),
        pool,
        rewardMint,
        funder: funder.publicKey,
      };
      const res = await initializeReward2(svm, initRewardParams);
      expect(res).instanceOf(TransactionMetadata);

      // funding a hook reward mint goes through fund_reward2 with the hook accounts
      await fundReward2(svm, {
        index,
        funder,
        pool,
        carryForward: true,
        amount: new BN(1_000_000_000),
        rewardHookAccounts,
      });

      // let rewards accrue
      let currentClock = svm.getClock();
      const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
      warpToTimestamp(svm, new BN(newTimestamp));
    });

    it("claim_reward2 invokes the hook on the reward transfer", async () => {
      const beforeCounter = readHookCounter(svm, rewardMint);
      const userRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        user.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const beforeBalance = Number(getTokenBalance(svm, userRewardAccount));

      const claimResult = await claimReward2(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
        rewardHookAccounts,
      });
      expect(claimResult).instanceOf(TransactionMetadata);

      expect(Number(getTokenBalance(svm, userRewardAccount))).gt(beforeBalance);

      // one vault->user reward transfer
      expect(readHookCounter(svm, rewardMint)).eq(beforeCounter + 1);
    });

    it("claim_reward2 fails when transfer hook accounts are missing", async () => {
      const claimResult = await claimReward2(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });
      expectThrowsErrorCode(
        claimResult,
        getCpAmmProgramErrorCode("MissingRemainingAccountForTransferHook")
      );
    });

    // ineligible rewards only accrue while the pool has no liquidity, so both
    // positions are emptied before warping past the reward duration end
    async function accrueIneligibleReward() {
      await removeAllLiquidity(svm, {
        owner: user,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });
      await removeAllLiquidity(svm, {
        owner: creator,
        pool,
        position: creatorPosition,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });

      const poolState = getPool(svm, pool);
      const timestamp =
        poolState.rewardInfos[index].rewardDurationEnd.addn(5000);
      warpToTimestamp(svm, new BN(timestamp));
    }

    it("withdraw_ineligible_reward2 invokes the hook on the reward transfer", async () => {
      await accrueIneligibleReward();

      const beforeCounter = readHookCounter(svm, rewardMint);
      const funderRewardAccount = getAssociatedTokenAddressSync(
        rewardMint,
        funder.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const beforeBalance = Number(getTokenBalance(svm, funderRewardAccount));

      await withdrawIneligibleReward2(svm, {
        index,
        funder,
        pool,
        rewardHookAccounts,
      });

      expect(Number(getTokenBalance(svm, funderRewardAccount))).gt(
        beforeBalance
      );

      // one vault->funder reward transfer
      expect(readHookCounter(svm, rewardMint)).eq(beforeCounter + 1);
    });

    it("withdraw_ineligible_reward2 fails when transfer hook accounts are missing", async () => {
      await accrueIneligibleReward();

      await withdrawIneligibleReward2(
        svm,
        {
          index,
          funder,
          pool,
        },
        getCpAmmProgramErrorCode("MissingRemainingAccountForTransferHook")
      );
    });
  });
});
