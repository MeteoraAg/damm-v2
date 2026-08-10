import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";

import {
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createToken,
  createTokenBadge,
  encodePermissions,
  expectThrowsErrorCode,
  getPool,
  initializePool,
  InitializePoolParams,
  initializePool2,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OFFSET,
  OperatorPermission,
  setPoolStatus,
  startSvm,
} from "./helpers";
import {
  ANCHOR_ERROR_ACCOUNT_OWNED_BY_WRONG_PROGRAM,
  generateKpAndFund,
} from "./helpers/common";
import {
  createPermenantDelegateExtensionWithInstruction,
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
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";

describe("Initialize pool", () => {
  describe("SPL token", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let creator: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    const configId = Math.floor(Math.random() * 1000);

    beforeEach(async () => {
      svm = startSvm();
      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
      tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

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

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.SetPoolStatus,
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
    });

    it("Initialize pool & update status", async () => {
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

      const newStatus = 1;
      await setPoolStatus(svm, {
        whitelistedAddress: whitelistedAccount,
        pool,
        status: newStatus,
      });
      const poolState = getPool(svm, pool);
      expect(poolState.poolStatus).eq(newStatus);
    });

    it("Initialize pool with initialize_pool2 & update status", async () => {
      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE);

      const { pool, result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity,
        sqrtPrice,
        activationPoint: null,
      });
      expect(result).instanceOf(TransactionMetadata);

      const newStatus = 1;
      await setPoolStatus(svm, {
        whitelistedAddress: whitelistedAccount,
        pool,
        status: newStatus,
      });
      const poolState = getPool(svm, pool);
      expect(poolState.poolStatus).eq(newStatus);
    });
  });

  describe("Token 2022", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let config: PublicKey;

    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    let liquidity: BN;
    let sqrtPrice: BN;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    const configId = Math.floor(Math.random() * 1000);

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

      await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

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

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.SetPoolStatus,
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
    });

    it("Initialize pool", async () => {
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

      const newStatus = 1;
      await setPoolStatus(svm, {
        whitelistedAddress: whitelistedAccount,
        pool,
        status: newStatus,
      });
      const poolState = getPool(svm, pool);
      expect(poolState.poolStatus).eq(newStatus);
    });

    it("Initialize pool with initialize_pool2", async () => {
      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE);

      const { pool, result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity,
        sqrtPrice,
        activationPoint: null,
      });
      expect(result).instanceOf(TransactionMetadata);

      const newStatus = 1;
      await setPoolStatus(svm, {
        whitelistedAddress: whitelistedAccount,
        pool,
        status: newStatus,
      });
      const poolState = getPool(svm, pool);
      expect(poolState.poolStatus).eq(newStatus);
    });
  });

  describe("Token 2022 with permanent delegate (token badge only)", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let config: PublicKey;

    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    let admin: Keypair;
    let whitelistedAccount: Keypair;
    const configId = Math.floor(Math.random() * 1000);

    beforeEach(async () => {
      svm = startSvm();

      const tokenAMintKeypair = Keypair.generate();
      const tokenBMintKeypair = Keypair.generate();

      tokenAMint = tokenAMintKeypair.publicKey;
      tokenBMint = tokenBMintKeypair.publicKey;

      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      await createToken2022(
        svm,
        [
          createPermenantDelegateExtensionWithInstruction(
            tokenAMint,
            admin.publicKey
          ),
        ],
        tokenAMintKeypair,
        admin.publicKey
      );
      await createToken2022(
        svm,
        [
          createPermenantDelegateExtensionWithInstruction(
            tokenBMint,
            admin.publicKey
          ),
        ],
        tokenBMintKeypair,
        admin.publicKey
      );

      await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

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

      // permanent delegate mints are only supported with a token badge
      await createTokenBadge(svm, {
        tokenMint: tokenAMint,
        whitelistedAddress: whitelistedAccount,
      });
      await createTokenBadge(svm, {
        tokenMint: tokenBMint,
        whitelistedAddress: whitelistedAccount,
      });
    });

    it("Initialize pool with initialize_pool2 passing token badges but no transfer hook accounts", async () => {
      const { pool, result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(1).shln(OFFSET),
        activationPoint: null,
      });
      expect(result).instanceOf(TransactionMetadata);

      const poolState = getPool(svm, pool);
      expect(poolState.poolStatus).eq(0);
    });
  });

  describe("Token 2022 with transfer hook", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let config: PublicKey;

    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let tokenAHookAccounts: AccountMeta[];
    let tokenBHookAccounts: AccountMeta[];

    let admin: Keypair;
    let whitelistedAccount: Keypair;
    const configId = Math.floor(Math.random() * 1000);

    beforeEach(async () => {
      svm = startSvm();

      const tokenAMintKeypair = Keypair.generate();
      const tokenBMintKeypair = Keypair.generate();

      tokenAMint = tokenAMintKeypair.publicKey;
      tokenBMint = tokenBMintKeypair.publicKey;

      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      await createToken2022(
        svm,
        [
          createTransferHookExtensionWithInstruction(
            tokenAMint,
            admin.publicKey
          ),
        ],
        tokenAMintKeypair,
        admin.publicKey
      );
      await createToken2022(
        svm,
        [
          createTransferHookExtensionWithInstruction(
            tokenBMint,
            admin.publicKey
          ),
        ],
        tokenBMintKeypair,
        admin.publicKey
      );

      await createExtraAccountMetaListAndCounter(svm, admin, tokenAMint);
      await createExtraAccountMetaListAndCounter(svm, admin, tokenBMint);

      tokenAHookAccounts = getHookRemainingAccounts(tokenAMint);
      tokenBHookAccounts = getHookRemainingAccounts(tokenBMint);

      await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

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
    });

    // active hook mints require a token badge for pool creation
    async function createTokenBadges() {
      await createTokenBadge(svm, {
        tokenMint: tokenAMint,
        whitelistedAddress: whitelistedAccount,
      });
      await createTokenBadge(svm, {
        tokenMint: tokenBMint,
        whitelistedAddress: whitelistedAccount,
      });
    }

    it("Initialize pool with initialize_pool2 invokes the hook on both deposits", async () => {
      await createTokenBadges();

      const beforeCounterA = readHookCounter(svm, tokenAMint);
      const beforeCounterB = readHookCounter(svm, tokenBMint);

      const { pool, result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(1).shln(OFFSET),
        activationPoint: null,
        tokenAHookAccounts,
        tokenBHookAccounts,
      });
      expect(result).instanceOf(TransactionMetadata);

      const poolState = getPool(svm, pool);
      expect(poolState.poolStatus).eq(0);

      // one payer->vault deposit per mint
      expect(readHookCounter(svm, tokenAMint)).eq(beforeCounterA + 1);
      expect(readHookCounter(svm, tokenBMint)).eq(beforeCounterB + 1);
    });

    it("initialize_pool2 fails when transfer hook accounts are missing", async () => {
      await createTokenBadges();

      const { result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(1).shln(OFFSET),
        activationPoint: null,
      });
      expect(result).instanceOf(FailedTransactionMetadata);
    });

    it("initialize_pool2 fails without a token badge", async () => {
      const { result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(1).shln(OFFSET),
        activationPoint: null,
        tokenAHookAccounts,
        tokenBHookAccounts,
      });

      expectThrowsErrorCode(
        result,
        ANCHOR_ERROR_ACCOUNT_OWNED_BY_WRONG_PROGRAM
      );
    });
  });
});
