import { ProgramTestContext } from "solana-bankrun";
import { setupTestContext, startTest } from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  InitializeCustomizeablePoolParams,
  initializeCustomizeablePool,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from "./bankrun-utils";
import BN from "bn.js";
import { ExtensionType } from "@solana/spl-token";

describe("Initialize customizable pool", () => {
  describe("SPL-Token", () => {
    let context: ProgramTestContext;
    let payer: Keypair;
    let creator: PublicKey;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      context = await startTest();
      const prepareContext = await setupTestContext(
        context.banksClient,
        context.payer,
        false
      );

      creator = prepareContext.poolCreator.publicKey;
      payer = prepareContext.payer;
      tokenAMint = prepareContext.tokenAMint;
      tokenBMint = prepareContext.tokenBMint;
    });

    it("Initialize customizeable pool with spl token", async () => {
      const params: InitializeCustomizeablePoolParams = {
        payer: payer,
        creator: creator,
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
            cliffFeeNumerator: new BN(2_500_000),
            numberOfPeriod: 0,
            reductionFactor: new BN(0),
            periodFrequency: new BN(0),
            feeSchedulerMode: 0,
          },
          protocolFeePercent: 20,
          partnerFeePercent: 0,
          referralFeePercent: 20,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };

      await initializeCustomizeablePool(context.banksClient, params);
    });
  });

  describe("Token 2022", () => {
    let context: ProgramTestContext;
    let payer: Keypair;
    let creator: PublicKey;
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

      creator = prepareContext.poolCreator.publicKey;
      payer = prepareContext.payer;
      tokenAMint = prepareContext.tokenAMint;
      tokenBMint = prepareContext.tokenBMint;
    });

    it("Initialize customizeable pool with spl token", async () => {
      const params: InitializeCustomizeablePoolParams = {
        payer: payer,
        creator: creator,
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
            cliffFeeNumerator: new BN(2_500_000),
            numberOfPeriod: 0,
            reductionFactor: new BN(0),
            periodFrequency: new BN(0),
            feeSchedulerMode: 0,
          },
          protocolFeePercent: 20,
          partnerFeePercent: 0,
          referralFeePercent: 20,
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };

      await initializeCustomizeablePool(context.banksClient, params);
    });
  });
});
