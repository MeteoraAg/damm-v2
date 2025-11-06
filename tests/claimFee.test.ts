import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  addLiquidity,
  AddLiquidityParams,
  claimPartnerFee,
  claimProtocolFee,
  closeClaimFeeOperator,
  createClaimFeeOperator,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
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
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Claim fee", () => {
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
    let claimFeeOperator: Keypair;
    let partner: Keypair;

    beforeEach(async () => {
      svm = startSvm();

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      partner = generateKpAndFund(svm);
      claimFeeOperator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      inputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);
      outputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);

      mintSplTokenTo(svm, inputTokenMint, admin, user.publicKey);

      mintSplTokenTo(svm, outputTokenMint, admin, user.publicKey);

      mintSplTokenTo(svm, inputTokenMint, admin, partner.publicKey);

      mintSplTokenTo(svm, outputTokenMint, admin, partner.publicKey);

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
        poolCreatorAuthority: partner.publicKey,
        activationType: 0,
        collectFeeMode: 0,
      };

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.CreateClaimProtocolFeeOperator,
        OperatorPermission.CloseClaimProtocolFeeOperator,
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
        payer: partner,
        creator: partner.publicKey,
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

      // create claim fee protocol operator
      await createClaimFeeOperator(svm, {
        whitelistedAddress: whitelistedAccount,
        claimFeeOperatorAddress: claimFeeOperator.publicKey,
      });
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
      await claimProtocolFee(svm, {
        claimFeeOperator,
        pool,
        treasury: TREASURY,
      });

      // claim partner fee

      await claimPartnerFee(svm, {
        partner,
        pool,
        maxAmountA: new BN(100000000000000),
        maxAmountB: new BN(100000000000000),
      });

      // close claim fee operator

      await closeClaimFeeOperator(svm, {
        whitelistedAddress: whitelistedAccount,
        operator: claimFeeOperator.publicKey,
        rentReceiver: claimFeeOperator.publicKey,
      });
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

    let operator: Keypair;
    let partner: Keypair;

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
      partner = generateKpAndFund(svm);
      operator = generateKpAndFund(svm);
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

      await mintToToken2022(svm, inputTokenMint, admin, partner.publicKey);

      await mintToToken2022(svm, outputTokenMint, admin, partner.publicKey);

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
        poolCreatorAuthority: partner.publicKey,
        activationType: 0,
        collectFeeMode: 0,
      };

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.CreateClaimProtocolFeeOperator,
        OperatorPermission.CloseClaimProtocolFeeOperator,
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
        payer: partner,
        creator: partner.publicKey,
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

      // create claim fee protocol operator
      await createClaimFeeOperator(svm, {
        whitelistedAddress: whitelistedAccount,
        claimFeeOperatorAddress: operator.publicKey,
      });
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
      await claimProtocolFee(svm, {
        claimFeeOperator: operator,
        pool,
        treasury: TREASURY,
      });

      // claim partner fee

      await claimPartnerFee(svm, {
        partner,
        pool,
        maxAmountA: new BN(100000000000000),
        maxAmountB: new BN(100000000000000),
      });

      // close claim fee operator

      await closeClaimFeeOperator(svm, {
        whitelistedAddress: whitelistedAccount,
        operator: operator.publicKey,
        rentReceiver: operator.publicKey,
      });
    });
  });
});
