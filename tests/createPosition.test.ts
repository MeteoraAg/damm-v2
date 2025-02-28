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
} from "./bankrun-utils";
import BN from "bn.js";
import { getAccount } from "@solana/spl-token";
import { ExtensionType } from "@solana/spl-token";

describe("Create position", () => {
  describe("SPL token", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let user: Keypair;
    let payer: Keypair;
    let liquidity: BN;
    let sqrtPrice: BN;
    let poolCreator: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

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
      tokenAMint = prepareContext.tokenAMint;
      tokenBMint = prepareContext.tokenBMint;
      poolCreator = prepareContext.poolCreator.publicKey;
    });

    it("User create a position", async () => {
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
        poolCreatorAuthority: PublicKey.default,
        activationType: 0,
        collectFeeMode: 0,
      };

      const config = await createConfigIx(
        context.banksClient,
        admin,
        createConfigParams
      );

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE);

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

      const { pool } = await initializePool(
        context.banksClient,
        initPoolParams
      );
      const position = await createPosition(
        context.banksClient,
        payer,
        user.publicKey,
        pool
      );
    });
  });

  describe("Token 2022", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let user: Keypair;
    let payer: Keypair;
    let liquidity: BN;
    let sqrtPrice: BN;
    let poolCreator: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      context = await startTest();
      const extensions = [
        ExtensionType.TransferFeeConfig,
        // ExtensionType.TokenMetadata,
        // ExtensionType.MetadataPointer,
      ];
      const prepareContext = await setupTestContext(
        context.banksClient,
        context.payer,
        true,
        extensions
      );
      payer = prepareContext.payer;
      user = prepareContext.user;
      admin = prepareContext.admin;
      tokenAMint = prepareContext.tokenAMint;
      tokenBMint = prepareContext.tokenBMint;
      poolCreator = prepareContext.poolCreator.publicKey;
    });

    it("User create a position", async () => {
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
        poolCreatorAuthority: PublicKey.default,
        activationType: 0,
        collectFeeMode: 0,
      };

      const config = await createConfigIx(
        context.banksClient,
        admin,
        createConfigParams
      );

      console.log("config config: ", config);

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(MIN_SQRT_PRICE);

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

      const { pool } = await initializePool(
        context.banksClient,
        initPoolParams
      );
      const position = await createPosition(
        context.banksClient,
        payer,
        user.publicKey,
        pool
      );
    });
  });
});
