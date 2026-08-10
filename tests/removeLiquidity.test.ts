import { generateKpAndFund, randomID } from "./helpers/common";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  addLiquidity,
  addLiquidity2,
  createConfigIx,
  createPosition,
  createTokenBadge,
  getCpAmmProgramErrorCode,
  initializePool,
  initializePool2,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  OFFSET,
  removeLiquidity,
  removeLiquidity2,
  U64_MAX,
  mintSplTokenTo,
  createToken,
  removeAllLiquidity,
  removeAllLiquidity2,
  closePosition,
  CreateConfigParams,
  OperatorPermission,
  encodePermissions,
  createOperator,
  startSvm,
} from "./helpers";
import BN from "bn.js";
import { expect } from "chai";
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
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM, TransactionMetadata } from "litesvm";

describe("Remove liquidity", () => {
  describe("SPL Token", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let pool: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      svm = startSvm();

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      tokenAMint = createToken(svm, admin.publicKey);
      tokenBMint = createToken(svm, admin.publicKey);

      mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

      mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

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

      const initPoolParams = {
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
    });

    it("User remove liquidity", async () => {
      // create a position
      const position = await createPosition(svm, user, user.publicKey, pool);

      // add liquidity
      let liquidity = new BN("100000000000");
      const addLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      // remove liquidity
      const removeLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity.div(new BN(2)),
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      };
      await removeLiquidity(svm, removeLiquidityParams);

      // remove all liquidity
      const removeAllLiquidityParams = {
        owner: user,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      };
      await removeAllLiquidity(svm, removeAllLiquidityParams);

      // close position
      await closePosition(svm, { owner: user, pool, position });
    });

    it("User remove liquidity with remove_liquidity2", async () => {
      // create a position
      const position = await createPosition(svm, user, user.publicKey, pool);

      // add liquidity
      let liquidity = new BN("100000000000");
      const addLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      // remove liquidity
      await removeLiquidity2(svm, {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity.div(new BN(2)),
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });

      // remove all liquidity
      await removeAllLiquidity2(svm, {
        owner: user,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });

      // close position
      await closePosition(svm, { owner: user, pool, position });
    });
  });

  describe("Token 2022", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let config: PublicKey;
    let pool: PublicKey;
    let whitelistedAccount: Keypair;
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
        new BN(randomID()),
        createConfigParams
      );

      const initPoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(MIN_SQRT_PRICE),
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);
      pool = result.pool;
    });

    it("User remove liquidity", async () => {
      // create a position
      const position = await createPosition(svm, user, user.publicKey, pool);

      // add liquidity
      let liquidity = new BN("100000000000");
      const addLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);
      // return

      const removeLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      };
      await removeLiquidity(svm, removeLiquidityParams);
    });

    it("User remove liquidity with remove_liquidity2", async () => {
      // create a position
      const position = await createPosition(svm, user, user.publicKey, pool);

      // add liquidity
      let liquidity = new BN("100000000000");
      const addLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity,
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
      };
      await addLiquidity(svm, addLiquidityParams);

      await removeLiquidity2(svm, {
        owner: user,
        pool,
        position,
        liquidityDelta: liquidity,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
      });
    });
  });

  describe("Token 2022 with transfer hook", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let pool: PublicKey;
    let position: PublicKey;
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

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
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

      await mintToToken2022(svm, tokenAMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, user.publicKey);

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
        new BN(randomID()),
        createConfigParams
      );

      // active hook mints require a token badge for pool creation
      await createTokenBadge(svm, {
        tokenMint: tokenAMint,
        whitelistedAddress: whitelistedAccount,
      });
      await createTokenBadge(svm, {
        tokenMint: tokenBMint,
        whitelistedAddress: whitelistedAccount,
      });

      const { pool: newPool, result } = await initializePool2(svm, {
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
      pool = newPool;

      position = await createPosition(svm, user, user.publicKey, pool);
      // liquidity is q64 scaled, so at price 1 this deposits ~1000 of each token;
      // anything much smaller floors to zero on withdrawal
      await addLiquidity2(svm, {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(1000).shln(OFFSET),
        tokenAAmountThreshold: U64_MAX,
        tokenBAmountThreshold: U64_MAX,
        tokenAHookAccounts,
        tokenBHookAccounts,
      });
    });

    it("remove_liquidity2 invokes the hook on both transfers", async () => {
      const beforeCounterA = readHookCounter(svm, tokenAMint);
      const beforeCounterB = readHookCounter(svm, tokenBMint);

      await removeLiquidity2(svm, {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(500).shln(OFFSET),
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
        tokenAHookAccounts,
        tokenBHookAccounts,
      });

      // one vault->user withdrawal per mint
      expect(readHookCounter(svm, tokenAMint)).eq(beforeCounterA + 1);
      expect(readHookCounter(svm, tokenBMint)).eq(beforeCounterB + 1);
    });

    it("remove_all_liquidity2 invokes the hook on both transfers", async () => {
      const beforeCounterA = readHookCounter(svm, tokenAMint);
      const beforeCounterB = readHookCounter(svm, tokenBMint);

      await removeAllLiquidity2(svm, {
        owner: user,
        pool,
        position,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
        tokenAHookAccounts,
        tokenBHookAccounts,
      });

      // one vault->user withdrawal per mint
      expect(readHookCounter(svm, tokenAMint)).eq(beforeCounterA + 1);
      expect(readHookCounter(svm, tokenBMint)).eq(beforeCounterB + 1);

      // close position
      await closePosition(svm, { owner: user, pool, position });
    });

    it("remove_liquidity2 fails when transfer hook accounts are missing", async () => {
      await removeLiquidity2(
        svm,
        {
          owner: user,
          pool,
          position,
          liquidityDelta: new BN(500).shln(OFFSET),
          tokenAAmountThreshold: new BN(0),
          tokenBAmountThreshold: new BN(0),
        },
        getCpAmmProgramErrorCode("MissingRemainingAccountForTransferHook")
      );
    });

    it("remove_all_liquidity2 fails when transfer hook accounts are missing", async () => {
      await removeAllLiquidity2(
        svm,
        {
          owner: user,
          pool,
          position,
          tokenAAmountThreshold: new BN(0),
          tokenBAmountThreshold: new BN(0),
        },
        getCpAmmProgramErrorCode("MissingRemainingAccountForTransferHook")
      );
    });
  });
});
