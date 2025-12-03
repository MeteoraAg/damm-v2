import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { LiteSVM } from "litesvm";
import { describe } from "mocha";
import {
  addLiquidity,
  AddLiquidityParams,
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  expectThrowsErrorCode,
  fundReward,
  getCpAmmProgramErrorCode,
  getPool,
  initializePool,
  InitializePoolParams,
  initializeReward,
  InitializeRewardParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  startSvm,
  updateRewardDuration,
  updateRewardFunder,
  warpToTimestamp,
  withdrawIneligibleReward,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";

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
        liquidityDelta: new BN(100),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
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
        amount: new BN("100"),
      });

      // claim reward

      await claimReward(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });

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

      const errorCode = getCpAmmProgramErrorCode("InvalidRewardIndex");
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
        liquidityDelta: new BN(100),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
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
        amount: new BN("100"),
      });

      let currentClock = svm.getClock();
      const newTimestamp = Number(currentClock.unixTimestamp) + 3600;
      warpToTimestamp(svm, new BN(newTimestamp));

      // claim reward

      await claimReward(svm, {
        index,
        user,
        pool,
        position,
        skipReward: 0,
      });

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
      const errorCode = getCpAmmProgramErrorCode("InvalidRewardIndex");
      const res = await initializeReward(svm, initRewardParams);
      expectThrowsErrorCode(res, errorCode);
    });
  });
});
