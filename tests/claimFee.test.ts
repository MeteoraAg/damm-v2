import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
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
  swapExactIn,
  SwapParams,
  TREASURY,
} from "./bankrun-utils";
import {
  convertToByteArray,
  generateKpAndFund,
  randomID,
  startTest,
} from "./bankrun-utils/common";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./bankrun-utils/token2022";
import {
  BaseFeeMode,
  encodeFeeTimeSchedulerParams,
} from "./bankrun-utils/feeCodec";

describe("Claim fee", () => {
  describe("SPL Token", () => {
    let context: ProgramTestContext;
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
      const root = Keypair.generate();
      context = await startTest(root);

      user = await generateKpAndFund(context.banksClient, context.payer);
      admin = await generateKpAndFund(context.banksClient, context.payer);
      partner = await generateKpAndFund(context.banksClient, context.payer);
      claimFeeOperator = await generateKpAndFund(
        context.banksClient,
        context.payer
      );
      whitelistedAccount = await generateKpAndFund(
        context.banksClient,
        context.payer
      );

      inputTokenMint = await createToken(
        context.banksClient,
        context.payer,
        context.payer.publicKey
      );
      outputTokenMint = await createToken(
        context.banksClient,
        context.payer,
        context.payer.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        inputTokenMint,
        context.payer,
        user.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        outputTokenMint,
        context.payer,
        user.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        inputTokenMint,
        context.payer,
        partner.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        outputTokenMint,
        context.payer,
        partner.publicKey
      );

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

      await createOperator(context.banksClient, {
        admin,
        whitelistAddress: whitelistedAccount.publicKey,
        permission,
      });

      config = await createConfigIx(
        context.banksClient,
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

      const result = await initializePool(context.banksClient, initPoolParams);
      pool = result.pool;
      position = await createPosition(
        context.banksClient,
        user,
        user.publicKey,
        pool
      );

      // create claim fee protocol operator
      await createClaimFeeOperator(context.banksClient, {
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
      await addLiquidity(context.banksClient, addLiquidityParams);

      const swapParams: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(10),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      await swapExactIn(context.banksClient, swapParams);

      // claim protocol fee
      await claimProtocolFee(context.banksClient, {
        claimFeeOperator,
        pool,
        treasury: TREASURY,
      });

      // claim partner fee

      await claimPartnerFee(context.banksClient, {
        partner,
        pool,
        maxAmountA: new BN(100000000000000),
        maxAmountB: new BN(100000000000000),
      });

      // close claim fee operator

      await closeClaimFeeOperator(context.banksClient, {
        whitelistedAddress: whitelistedAccount,
        operator: claimFeeOperator.publicKey,
        rentReceiver: claimFeeOperator.publicKey,
      });
    });
  });

  describe("Token 2022", () => {
    let context: ProgramTestContext;
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
      const root = Keypair.generate();
      context = await startTest(root);

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
      user = await generateKpAndFund(context.banksClient, context.payer);
      admin = await generateKpAndFund(context.banksClient, context.payer);
      partner = await generateKpAndFund(context.banksClient, context.payer);
      operator = await generateKpAndFund(context.banksClient, context.payer);
      whitelistedAccount = await generateKpAndFund(
        context.banksClient,
        context.payer
      );

      await createToken2022(
        context.banksClient,
        context.payer,
        inputExtensions,
        inputTokenMintKeypair
      );
      await createToken2022(
        context.banksClient,
        context.payer,
        outputExtensions,
        outputTokenMintKeypair
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        inputTokenMint,
        context.payer,
        user.publicKey
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        outputTokenMint,
        context.payer,
        user.publicKey
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        inputTokenMint,
        context.payer,
        partner.publicKey
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        outputTokenMint,
        context.payer,
        partner.publicKey
      );

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

      await createOperator(context.banksClient, {
        admin,
        whitelistAddress: whitelistedAccount.publicKey,
        permission,
      });

      config = await createConfigIx(
        context.banksClient,
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

      const result = await initializePool(context.banksClient, initPoolParams);
      pool = result.pool;
      position = await createPosition(
        context.banksClient,
        user,
        user.publicKey,
        pool
      );

      // create claim fee protocol operator
      await createClaimFeeOperator(context.banksClient, {
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
      await addLiquidity(context.banksClient, addLiquidityParams);

      const swapParams: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(10),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      await swapExactIn(context.banksClient, swapParams);

      // claim protocol fee
      await claimProtocolFee(context.banksClient, {
        claimFeeOperator: operator,
        pool,
        treasury: TREASURY,
      });

      // claim partner fee

      await claimPartnerFee(context.banksClient, {
        partner,
        pool,
        maxAmountA: new BN(100000000000000),
        maxAmountB: new BN(100000000000000),
      });

      // close claim fee operator

      await closeClaimFeeOperator(context.banksClient, {
        whitelistedAddress: whitelistedAccount,
        operator: operator.publicKey,
        rentReceiver: operator.publicKey,
      });
    });
  });
});
