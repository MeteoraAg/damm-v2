import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  createToken,
  getPool,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
} from "./bankrun-utils";
import {
  convertToByteArray,
  generateKpAndFund,
  startTest,
} from "./bankrun-utils/common";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./bankrun-utils/token2022";

describe("Initialize customizable pool", () => {
  describe("SPL-Token", () => {
    let context: ProgramTestContext;
    let creator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      const root = Keypair.generate();
      context = await startTest(root);
      creator = await generateKpAndFund(context.banksClient, context.payer);

      tokenAMint = await createToken(
        context.banksClient,
        context.payer,
        context.payer.publicKey
      );
      tokenBMint = await createToken(
        context.banksClient,
        context.payer,
        context.payer.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        tokenAMint,
        context.payer,
        creator.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        tokenBMint,
        context.payer,
        creator.publicKey
      );
    });

    it("Initialize customizable pool with spl token", async () => {
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
            zeroFactor: new BN(2_500_000).toArray("le", 8),
            firstFactor: 0,
            secondFactor: convertToByteArray(new BN(0)),
            thirdFactor: new BN(0),
            baseFeeMode: 0,
          },
          padding: [],
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };

      await initializeCustomizablePool(context.banksClient, params);
    });
  });

  describe("Token 2022", () => {
    let context: ProgramTestContext;
    let creator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;

    beforeEach(async () => {
      const root = Keypair.generate();
      context = await startTest(root);

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
      creator = await generateKpAndFund(context.banksClient, context.payer);

      await createToken2022(
        context.banksClient,
        context.payer,
        tokenAExtensions,
        tokenAMintKeypair
      );
      await createToken2022(
        context.banksClient,
        context.payer,
        tokenBExtensions,
        tokenBMintKeypair
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        tokenAMint,
        context.payer,
        creator.publicKey
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        tokenBMint,
        context.payer,
        creator.publicKey
      );
    });

    it("Initialize customizeable pool with spl token", async () => {
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
            zeroFactor: new BN(2_500_000).toArray("le", 8),
            firstFactor: 0,
            secondFactor: convertToByteArray(new BN(0)),
            thirdFactor: new BN(0),
            baseFeeMode: 0,
          },
          padding: [],
          dynamicFee: null,
        },
        activationType: 0,
        collectFeeMode: 0,
      };

      const { pool } = await initializeCustomizablePool(
        context.banksClient,
        params
      );
      const poolState = await getPool(context.banksClient, pool);
      expect(poolState.version).eq(0);
    });
  });
});
