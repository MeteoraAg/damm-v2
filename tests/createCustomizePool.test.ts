import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";

import {
  createOperator,
  createToken,
  createTokenBadge,
  encodePermissions,
  expectThrowsErrorCode,
  getCpAmmProgramErrorCode,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  initializeCustomizablePool2,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OFFSET,
  OperatorPermission,
  startSvm,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
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

describe("Initialize customizable pool", () => {
  describe("SPL-Token", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let creator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      svm = startSvm();
      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);

      tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
      tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    });

    it("Initialize customizable pool with spl token", async () => {
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

      const params: InitializeCustomizablePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE,
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };

      await initializeCustomizablePool(svm, params);
    });

    it("Initialize customizable pool with initialize_customizable_pool2", async () => {
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

      const { result } = await initializeCustomizablePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE,
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      });
      expect(result).instanceOf(TransactionMetadata);
    });
  });

  describe("Token 2022", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let admin: Keypair;
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
      creator = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);

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
    });

    it("Initialize customizable pool with spl token", async () => {
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

      const params: InitializeCustomizablePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE,
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };

      const { pool: _pool } = await initializeCustomizablePool(svm, params);
    });

    it("Initialize customizable pool with initialize_customizable_pool2", async () => {
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

      const { result } = await initializeCustomizablePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE,
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      });
      expect(result).instanceOf(TransactionMetadata);
    });
  });

  describe("Token 2022 with permanent delegate (token badge only)", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

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

      let permission = encodePermissions([OperatorPermission.CreateTokenBadge]);

      await createOperator(svm, {
        admin,
        whitelistAddress: whitelistedAccount.publicKey,
        permission,
      });

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

    it("Initialize customizable pool with initialize_customizable_pool2 passing token badges but no transfer hook accounts", async () => {
      const cliffFeeNumerator = new BN(2_500_000);

      const data = encodeFeeTimeSchedulerParams(
        BigInt(cliffFeeNumerator.toString()),
        0,
        BigInt(0),
        BigInt(0),
        BaseFeeMode.FeeTimeSchedulerLinear
      );

      const { result } = await initializeCustomizablePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: new BN(1).shln(OFFSET),
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      });
      expect(result).instanceOf(TransactionMetadata);
    });
  });

  describe("Token 2022 with transfer hook", () => {
    let svm: LiteSVM;
    let creator: Keypair;
    let admin: Keypair;
    let whitelistedAccount: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let tokenAHookAccounts: AccountMeta[];
    let tokenBHookAccounts: AccountMeta[];

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

      let permission = encodePermissions([OperatorPermission.CreateTokenBadge]);

      await createOperator(svm, {
        admin,
        whitelistAddress: whitelistedAccount.publicKey,
        permission,
      });
    });

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

    function customizablePool2Params(): InitializeCustomizablePoolParams {
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

      return {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: new BN(1).shln(OFFSET),
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
          baseFee: {
            data: Array.from(data),
          },
          compoundingFeeBps: 0,
          padding: 0,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };
    }

    it("Initialize customizable pool with initialize_customizable_pool2 invokes the hook on both deposits", async () => {
      await createTokenBadges();

      const beforeCounterA = readHookCounter(svm, tokenAMint);
      const beforeCounterB = readHookCounter(svm, tokenBMint);

      const { result } = await initializeCustomizablePool2(svm, {
        ...customizablePool2Params(),
        tokenAHookAccounts,
        tokenBHookAccounts,
      });
      expect(result).instanceOf(TransactionMetadata);

      // one payer->vault deposit per mint
      expect(readHookCounter(svm, tokenAMint)).eq(beforeCounterA + 1);
      expect(readHookCounter(svm, tokenBMint)).eq(beforeCounterB + 1);
    });

    it("initialize_customizable_pool2 fails when transfer hook accounts are missing", async () => {
      await createTokenBadges();

      const { result } = await initializeCustomizablePool2(
        svm,
        customizablePool2Params()
      );
      expect(result).instanceOf(FailedTransactionMetadata);
    });

    it("initialize_customizable_pool2 fails without a token badge", async () => {
      const { result } = await initializeCustomizablePool2(svm, {
        ...customizablePool2Params(),
        tokenAHookAccounts,
        tokenBHookAccounts,
      });

      expectThrowsErrorCode(
        result,
        getCpAmmProgramErrorCode("InvalidTokenBadge")
      );
    });
  });
});
