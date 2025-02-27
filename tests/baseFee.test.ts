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
import { createMint, wrapSOL } from "./bankrun-utils/token";
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
} from "./bankrun-utils";
import BN from "bn.js";
import { describe } from "mocha";

describe("Base Fee", () => {
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
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let poolCreator: PublicKey;

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
      tokenAMint = prepareContext.tokenAMint;
      tokenBMint = prepareContext.tokenBMint;
      poolCreator = prepareContext.poolCreator.publicKey;
    });

    it("BaseFee with config", async () => {
      // Create config with base fee and without dynamic fee
      // Fee schedular params
      const cliffFeeNumerator = new BN(2_500_000);
      const numberOfPeriod = 5;
      const reductionFactor = new BN(1);
      const periodFrequency = new BN(0);
      const feeSchedulerMode = 0;

      const createConfigParams: CreateConfigParams = {
        index: new BN(randomID()),
        poolFees: {
          baseFee: {
            cliffFeeNumerator,
            numberOfPeriod,
            reductionFactor,
            periodFrequency,
            feeSchedulerMode,
          },
          protocolFeePercent: 10,
          partnerFeePercent: 0,
          referralFeePercent: 0,
          dynamicFee: null,
        },
        sqrtMinPrice: new BN(MIN_SQRT_PRICE),
        sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
        vaultConfigKey: PublicKey.default,
        poolCreatorAuthority: PublicKey.default,
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
        payer: payer,
        creator: poolCreator,
        config,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
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

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
      };
      await addLiquidity(context.banksClient, addLiquidityParams);

      const poolState1 = await getPool(context.banksClient, pool);
      //   console.log("Base fee before ", {});

      const swapParams: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(100_000 * 10 ** DECIMALS),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };

      await swap(context.banksClient, swapParams);

      const poolState = await getPool(context.banksClient, pool);
      //   console.log(poolState);
    });

    it.skip("Base fee with customizable pool", async () => { });
  });

  describe.skip("Token 2022", () => {
    it("Base fee with config", async () => { });
    it("Base fee with customizable pool", async () => { });
  });
});
