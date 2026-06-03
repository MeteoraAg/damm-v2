import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  addLiquidity,
  AddLiquidityParams,
  claimProtocolFee,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  getPool,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  startSvm,
  swapExactIn,
  SwapParams,
  TREASURY,
  expectThrowsErrorCode,
} from "./helpers";
import {
  generateKpAndFund,
  getCpAmmProgramErrorCode,
  randomID,
} from "./helpers/common";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { expect } from "chai";

describe("Claim Protocol Fee", () => {
  describe("SPL Token", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    let pool: PublicKey;
    let position: PublicKey;
    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;
    let creator: Keypair;

    beforeEach(async () => {
      svm = startSvm();

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      inputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);
      outputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);

      mintSplTokenTo(svm, inputTokenMint, admin, user.publicKey);

      mintSplTokenTo(svm, outputTokenMint, admin, user.publicKey);

      mintSplTokenTo(svm, inputTokenMint, admin, creator.publicKey);

      mintSplTokenTo(svm, outputTokenMint, admin, creator.publicKey);

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
        poolCreatorAuthority: creator.publicKey,
        activationType: 0,
        collectFeeMode: 0,
      };

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.ClaimProtocolFee,
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

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: inputTokenMint,
        tokenBMint: outputTokenMint,
        liquidity,
        sqrtPrice,
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);
      pool = result.pool;
      position = await createPosition(svm, user, user.publicKey, pool);
    });

    it("User swap A->B", async () => {
      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: MIN_SQRT_PRICE,
        tokenAAmountThreshold: new BN(2_000_000_000),
        tokenBAmountThreshold: new BN(2_000_000_000),
      };
      await addLiquidity(svm, addLiquidityParams);

      const swapParams: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(10),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      await swapExactIn(svm, swapParams);

      // claim protocol fee
      const result = await claimProtocolFee(svm, {
        whitelistedKP: whitelistedAccount,
        pool,
        treasury: TREASURY,
      });
      expect(result).instanceOf(TransactionMetadata);
    });

    it("Claim to non-treasury ATA should fail", async () => {
      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
      };
      await addLiquidity(svm, addLiquidityParams);

      // swap in both directions to accumulate protocol fees
      const swapA2B: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(10000),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      const swapB2A: SwapParams = {
        payer: user,
        pool,
        inputTokenMint: outputTokenMint,
        outputTokenMint: inputTokenMint,
        amountIn: new BN(10000),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      await swapExactIn(svm, swapA2B);
      await swapExactIn(svm, swapB2A);
      await swapExactIn(svm, swapA2B);
      await swapExactIn(svm, swapB2A);

      // verify protocol fees are non-zero
      const poolState = getPool(svm, pool);
      expect(
        poolState.protocolAFee.gt(new BN(0)) ||
          poolState.protocolBFee.gt(new BN(0))
      ).to.be.true;

      // claim to an arbitrary (non-treasury) address should fail
      const arbitraryReceiver = generateKpAndFund(svm);
      const errorCode = getCpAmmProgramErrorCode("IncorrectATA");
      const result = await claimProtocolFee(svm, {
        whitelistedKP: whitelistedAccount,
        pool,
        treasury: arbitraryReceiver.publicKey,
      });
      expectThrowsErrorCode(result, errorCode);
    });
  });

  describe("Token 2022", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    let pool: PublicKey;
    let position: PublicKey;
    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;

    let creator: Keypair;

    beforeEach(async () => {
      svm = startSvm();

      const inputTokenMintKeypair = Keypair.generate();
      const outputTokenMintKeypair = Keypair.generate();

      inputTokenMint = inputTokenMintKeypair.publicKey;
      outputTokenMint = outputTokenMintKeypair.publicKey;

      const inputExtensions = [
        createTransferFeeExtensionWithInstruction(inputTokenMint),
      ];
      const outputExtensions = [
        createTransferFeeExtensionWithInstruction(outputTokenMint),
      ];
      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      await createToken2022(
        svm,
        inputExtensions,
        inputTokenMintKeypair,
        admin.publicKey
      );
      await createToken2022(
        svm,
        outputExtensions,
        outputTokenMintKeypair,
        admin.publicKey
      );

      await mintToToken2022(svm, inputTokenMint, admin, user.publicKey);

      await mintToToken2022(svm, outputTokenMint, admin, user.publicKey);

      await mintToToken2022(svm, inputTokenMint, admin, creator.publicKey);

      await mintToToken2022(svm, outputTokenMint, admin, creator.publicKey);

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
        poolCreatorAuthority: creator.publicKey,
        activationType: 0,
        collectFeeMode: 0,
      };

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.ClaimProtocolFee,
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

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint: inputTokenMint,
        tokenBMint: outputTokenMint,
        liquidity,
        sqrtPrice,
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);
      pool = result.pool;
      position = await createPosition(svm, user, user.publicKey, pool);
    });

    it("User swap A->B", async () => {
      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: MIN_SQRT_PRICE,
        tokenAAmountThreshold: new BN(2_000_000_000),
        tokenBAmountThreshold: new BN(2_000_000_000),
      };
      await addLiquidity(svm, addLiquidityParams);

      const swapParams: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(10),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      await swapExactIn(svm, swapParams);

      // claim protocol fee
      const result = await claimProtocolFee(svm, {
        whitelistedKP: whitelistedAccount,
        pool,
        treasury: TREASURY,
      });
      expect(result).instanceOf(TransactionMetadata);
    });
  });
});
