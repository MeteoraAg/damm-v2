import { AccountLayout } from "@solana/spl-token";
import { ProgramTestContext } from "solana-bankrun";
import {
  generateKpAndFund,
  randomID,
  startTest,
} from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  getPool,
  getTokenBalance,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  startSvm,
  U64_MAX,
} from "./helpers";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Add liquidity", () => {
  describe("SPL Token", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let config: PublicKey;
    let pool: PublicKey;
    let position: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      svm = startSvm();

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
      tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

      // create config
      const cliffFeeNumerator = BigInt(2_500_000);

      const data = encodeFeeTimeSchedulerParams(
        cliffFeeNumerator,
        0,
        BigInt(0),
        BigInt(0),
        BaseFeeMode.FeeTimeSchedulerLinear
      );

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
        new BN(randomID()),
        createConfigParams
      );
    });

    it("Create pool with sqrtPrice equal sqrtMintPrice", async () => {
      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE,
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);

      pool = result.pool;
      position = await createPosition(svm, user, user.publicKey, pool);

      const poolState = getPool(svm, pool);

      const preTokenBVaultBalance = getTokenBalance(svm, poolState.tokenBVault);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: MIN_LP_AMOUNT,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      const postTokenBVaultBalance = getTokenBalance(
        svm,
        poolState.tokenBVault
      );

      expect(preTokenBVaultBalance).eq(postTokenBVaultBalance);
    });

    it("Create pool with sqrtPrice equal sqrtMaxPrice", async () => {
      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MAX_SQRT_PRICE,
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);

      pool = result.pool;
      position = await createPosition(svm, creator, user.publicKey, pool);

      const poolState = getPool(svm, pool);

      const preTokenAVaultBalance = getTokenBalance(svm, poolState.tokenAVault);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: MIN_LP_AMOUNT,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      const postTokenAVaultBalance = getTokenBalance(
        svm,
        poolState.tokenAVault
      );

      expect(preTokenAVaultBalance).eq(postTokenAVaultBalance);
    });
  });

  describe("Token 2022", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    let user: Keypair;
    let config: PublicKey;
    let pool: PublicKey;
    let position: PublicKey;
    let creator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      svm = startSvm();
      const tokenAMintKeypair = Keypair.generate();
      const tokenBMintKeypair = Keypair.generate();

      tokenAMint = tokenAMintKeypair.publicKey;
      tokenBMint = tokenBMintKeypair.publicKey;

      const tokenAExtensions = [
        createTransferFeeExtensionWithInstruction(tokenAMint),
      ];
      const tokenBExtensions = [
        createTransferFeeExtensionWithInstruction(tokenBMint),
      ];
      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
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

      await mintToToken2022(svm, tokenAMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

      const cliffFeeNumerator = BigInt(2_500_000);

      const data = encodeFeeTimeSchedulerParams(
        cliffFeeNumerator,
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
        new BN(randomID()),
        createConfigParams
      );
    });

    it("Create pool with sqrtPrice equal sqrtMintPrice", async () => {
      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE,
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);

      pool = result.pool;
      position = await createPosition(svm, user, user.publicKey, pool);

      const poolState = getPool(svm, pool);

      const preTokenBVaultBalance = getTokenBalance(svm, poolState.tokenBVault);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: MIN_LP_AMOUNT,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      const postTokenBVaultBalance = getTokenBalance(
        svm,
        poolState.tokenBVault
      );

      expect(preTokenBVaultBalance).eq(postTokenBVaultBalance);
    });

    it("Create pool with sqrtPrice equal sqrtMaxPrice", async () => {
      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MAX_SQRT_PRICE,
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);

      pool = result.pool;
      position = await createPosition(svm, user, user.publicKey, pool);

      const poolState = getPool(svm, pool);

      const preTokenAVaultBalance = getTokenBalance(svm, poolState.tokenAVault);

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: MIN_LP_AMOUNT,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      const postTokenAVaultBalance = getTokenBalance(
        svm,
        poolState.tokenAVault
      );

      expect(preTokenAVaultBalance).eq(postTokenAVaultBalance);
    });
  });
});
