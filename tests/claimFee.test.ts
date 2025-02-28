import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  randomID,
  setupTestContext,
  startTest,
  transferSol,
} from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  getPool,
  getPosition,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  swap,
  SwapParams,
  DECIMALS,
  createClaimFeeOperator,
  claimProtocolFee,
  TREASURY,
  claimPartnerFee,
  closeClaimFeeOperator,
} from "./bankrun-utils";
import BN from "bn.js";
import { ExtensionType } from "@solana/spl-token";

describe("Claim fee", () => {
  describe("SPL Token", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let user: Keypair;
    let payer: Keypair;
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
      context = await startTest();

      const prepareContext = await setupTestContext(
        context.banksClient,
        context.payer,
        false
      );
      payer = prepareContext.payer;
      user = prepareContext.user;
      admin = prepareContext.admin;
      inputTokenMint = prepareContext.tokenAMint;
      outputTokenMint = prepareContext.tokenBMint;
      operator = prepareContext.operator;
      partner = prepareContext.partner;

      // create config
      const createConfigParams: CreateConfigParams = {
        index: new BN(randomID()),
        poolFees: {
          baseFee: {
            cliffFeeNumerator: new BN(2_500_000),
            numberOfPeriod: 0,
            reductionFactor: new BN(0),
            periodFrequency: new BN(0),
            feeSchedulerMode: 0,
          },
          protocolFeePercent: 10,
          partnerFeePercent: 0,
          referralFeePercent: 0,
          dynamicFee: null,
        },
        sqrtMinPrice: new BN(MIN_SQRT_PRICE),
        sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
        vaultConfigKey: PublicKey.default,
        poolCreatorAuthority: partner.publicKey,
        activationType: 0,
        collectFeeMode: 0,
      };

      config = await createConfigIx(
        context.banksClient,
        admin,
        createConfigParams
      );

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

      const initPoolParams: InitializePoolParams = {
        payer: partner,
        creator: prepareContext.poolCreator.publicKey,
        config,
        tokenAMint: prepareContext.tokenAMint,
        tokenBMint: prepareContext.tokenBMint,
        liquidity,
        sqrtPrice,
        activationPoint: null,
      };

      const result = await initializePool(context.banksClient, initPoolParams);
      pool = result.pool;
      position = await createPosition(
        context.banksClient,
        payer,
        user.publicKey,
        pool
      );

      // create claim fee protocol operator
      await createClaimFeeOperator(context.banksClient, {
        admin,
        operator: operator.publicKey,
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

      await swap(context.banksClient, swapParams);

      // claim protocol fee
      await claimProtocolFee(context.banksClient, {
        operator,
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
        admin,
        operator: operator.publicKey,
        rentReceiver: operator.publicKey,
      });
    });
  });

  describe("Token 2022", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let user: Keypair;
    let payer: Keypair;
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
      context = await startTest();
      const extenstions = [ExtensionType.TransferFeeConfig];
      const prepareContext = await setupTestContext(
        context.banksClient,
        context.payer,
        true,
        extenstions
      );
      payer = prepareContext.payer;
      user = prepareContext.user;
      admin = prepareContext.admin;
      inputTokenMint = prepareContext.tokenAMint;
      outputTokenMint = prepareContext.tokenBMint;
      operator = prepareContext.operator;
      partner = prepareContext.partner;

      // create config
      const createConfigParams: CreateConfigParams = {
        index: new BN(randomID()),
        poolFees: {
          baseFee: {
            cliffFeeNumerator: new BN(2_500_000),
            numberOfPeriod: 0,
            reductionFactor: new BN(0),
            periodFrequency: new BN(0),
            feeSchedulerMode: 0,
          },
          protocolFeePercent: 10,
          partnerFeePercent: 0,
          referralFeePercent: 0,
          dynamicFee: null,
        },
        sqrtMinPrice: new BN(MIN_SQRT_PRICE),
        sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
        vaultConfigKey: PublicKey.default,
        poolCreatorAuthority: partner.publicKey,
        activationType: 0,
        collectFeeMode: 0,
      };

      config = await createConfigIx(
        context.banksClient,
        admin,
        createConfigParams
      );

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

      const initPoolParams: InitializePoolParams = {
        payer: partner,
        creator: prepareContext.poolCreator.publicKey,
        config,
        tokenAMint: prepareContext.tokenAMint,
        tokenBMint: prepareContext.tokenBMint,
        liquidity,
        sqrtPrice,
        activationPoint: null,
      };

      const result = await initializePool(context.banksClient, initPoolParams);
      pool = result.pool;
      position = await createPosition(
        context.banksClient,
        payer,
        user.publicKey,
        pool
      );

      // create claim fee protocol operator
      await createClaimFeeOperator(context.banksClient, {
        admin,
        operator: operator.publicKey,
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

      await swap(context.banksClient, swapParams);

      // claim protocol fee
      await claimProtocolFee(context.banksClient, {
        operator,
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
        admin,
        operator: operator.publicKey,
        rentReceiver: operator.publicKey,
      });
    });
  });
});
