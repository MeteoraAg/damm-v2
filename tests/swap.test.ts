import { ProgramTestContext } from "solana-bankrun";
import {
  convertToByteArray,
  generateKpAndFund,
  randomID,
  startTest,
} from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  swapExactIn,
  SwapParams,
  createToken,
  mintSplTokenTo,
  swap2ExactIn,
  U64_MAX,
  swap2PartialFillIn,
  swap2ExactOut,
  OFFSET,
} from "./bankrun-utils";
import BN from "bn.js";
import {
  ExtensionType,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./bankrun-utils/token2022";
import { expect } from "chai";
import { on } from "events";

describe("Swap token", () => {
  describe("SPL Token", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let config: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    let pool: PublicKey;
    let position: PublicKey;
    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;

    beforeEach(async () => {
      const root = Keypair.generate();
      context = await startTest(root);

      user = await generateKpAndFund(context.banksClient, context.payer);
      admin = await generateKpAndFund(context.banksClient, context.payer);
      creator = await generateKpAndFund(context.banksClient, context.payer);

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
        creator.publicKey
      );

      await mintSplTokenTo(
        context.banksClient,
        context.payer,
        outputTokenMint,
        context.payer,
        creator.publicKey
      );

      // create config
      const createConfigParams: CreateConfigParams = {
        poolFees: {
          baseFee: {
            cliffFeeNumerator: new BN(2_500_000),
            firstFactor: 0,
            secondFactor: convertToByteArray(new BN(0)),
            thirdFactor: new BN(0),
            baseFeeMode: 0,
          },
          padding: [],
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

      const result = await initializePool(context.banksClient, initPoolParams);
      pool = result.pool;
      position = await createPosition(
        context.banksClient,
        user,
        user.publicKey,
        pool
      );
    });

    it("User swap A->B", async () => {
      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
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
    });
  });

  describe("Token 2022", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let config: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    let pool: PublicKey;
    let position: PublicKey;

    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;

    beforeEach(async () => {
      const root = Keypair.generate();
      context = await startTest(root);

      const inputTokenMintKeypair = Keypair.generate();
      const outputTokenMintKeypair = Keypair.generate();
      inputTokenMint = inputTokenMintKeypair.publicKey;
      outputTokenMint = outputTokenMintKeypair.publicKey;

      const inputMintExtension = [
        createTransferFeeExtensionWithInstruction(inputTokenMint),
      ];
      const outputMintExtension = [
        createTransferFeeExtensionWithInstruction(outputTokenMint),
      ];
      const extensions = [...inputMintExtension, ...outputMintExtension];
      user = await generateKpAndFund(context.banksClient, context.payer);
      admin = await generateKpAndFund(context.banksClient, context.payer);
      creator = await generateKpAndFund(context.banksClient, context.payer);

      await createToken2022(
        context.banksClient,
        context.payer,
        inputMintExtension,
        inputTokenMintKeypair
      );
      await createToken2022(
        context.banksClient,
        context.payer,
        outputMintExtension,
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
        creator.publicKey
      );

      await mintToToken2022(
        context.banksClient,
        context.payer,
        outputTokenMint,
        context.payer,
        creator.publicKey
      );

      // create config
      const createConfigParams: CreateConfigParams = {
        poolFees: {
          baseFee: {
            cliffFeeNumerator: new BN(2_500_000),
            firstFactor: 0,
            secondFactor: convertToByteArray(new BN(0)),
            thirdFactor: new BN(0),
            baseFeeMode: 0,
          },
          padding: [],
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
        new BN(randomID()),
        createConfigParams
      );

      liquidity = new BN(MIN_LP_AMOUNT);
      sqrtPrice = new BN(1).shln(OFFSET);

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

      const result = await initializePool(context.banksClient, initPoolParams);
      pool = result.pool;
      position = await createPosition(
        context.banksClient,
        user,
        user.publicKey,
        pool
      );
    });

    it("User swap A->B", async () => {
      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
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
    });

    describe("Swap2", () => {
      describe("SwapExactIn", () => {
        it("Swap successfully", async () => {
          const tokenPermutation = [
            [inputTokenMint, outputTokenMint],
            [outputTokenMint, inputTokenMint],
          ];

          for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
            const addLiquidityParams: AddLiquidityParams = {
              owner: user,
              pool,
              position,
              liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
              tokenAAmountThreshold: new BN(200),
              tokenBAmountThreshold: new BN(200),
            };
            await addLiquidity(context.banksClient, addLiquidityParams);

            const amountIn = new BN(10);

            const userInputAta = getAssociatedTokenAddressSync(
              inputTokenMint,
              user.publicKey,
              true,
              TOKEN_2022_PROGRAM_ID
            );

            const beforeUserInputRawAccount =
              await context.banksClient.getAccount(userInputAta);

            const beforeBalance = unpackAccount(
              userInputAta,
              // @ts-ignore
              beforeUserInputRawAccount,
              TOKEN_2022_PROGRAM_ID
            ).amount;

            await swap2ExactIn(context.banksClient, {
              payer: user,
              pool,
              inputTokenMint,
              outputTokenMint,
              amount0: amountIn,
              amount1: new BN(0),
              referralTokenAccount: null,
            });

            const afterUserInputRawAccount =
              await context.banksClient.getAccount(userInputAta);

            const afterUserInputTokenAccount = unpackAccount(
              userInputAta,
              // @ts-ignore
              afterUserInputRawAccount,
              TOKEN_2022_PROGRAM_ID
            );

            const afterBalance = afterUserInputTokenAccount.amount;
            const exactInputAmount = beforeBalance - afterBalance;
            expect(Number(exactInputAmount)).to.be.equal(amountIn.toNumber());
          }
        });
      });

      describe("SwapPartialFill", () => {
        it("Swap successfully", async () => {
          const tokenPermutation = [
            [inputTokenMint, outputTokenMint],
            [outputTokenMint, inputTokenMint],
          ];

          for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
            const addLiquidityParams: AddLiquidityParams = {
              owner: user,
              pool,
              position,
              liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
              tokenAAmountThreshold: new BN(200),
              tokenBAmountThreshold: new BN(200),
            };
            await addLiquidity(context.banksClient, addLiquidityParams);

            const amountIn = new BN("10000000000000");

            const userInputAta = getAssociatedTokenAddressSync(
              inputTokenMint,
              user.publicKey,
              true,
              TOKEN_2022_PROGRAM_ID
            );

            const beforeUserInputRawAccount =
              await context.banksClient.getAccount(userInputAta);

            const beforeBalance = unpackAccount(
              userInputAta,
              // @ts-ignore
              beforeUserInputRawAccount,
              TOKEN_2022_PROGRAM_ID
            ).amount;

            await swap2PartialFillIn(context.banksClient, {
              payer: user,
              pool,
              inputTokenMint,
              outputTokenMint,
              amount0: amountIn,
              amount1: new BN(0),
              referralTokenAccount: null,
            });

            const afterUserInputRawAccount =
              await context.banksClient.getAccount(userInputAta);

            const afterUserInputTokenAccount = unpackAccount(
              userInputAta,
              // @ts-ignore
              afterUserInputRawAccount,
              TOKEN_2022_PROGRAM_ID
            );

            const afterBalance = afterUserInputTokenAccount.amount;
            const exactInputAmount = beforeBalance - afterBalance;
            expect(new BN(exactInputAmount.toString()).lt(amountIn)).to.be.true;
          }
        });
      });

      describe("SwapExactOut", () => {
        it("Swap successfully", async () => {
          const tokenPermutation = [
            [inputTokenMint, outputTokenMint],
            [outputTokenMint, inputTokenMint],
          ];

          for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
            const addLiquidityParams: AddLiquidityParams = {
              owner: user,
              pool,
              position,
              liquidityDelta: new BN("10000000000").shln(OFFSET),
              tokenAAmountThreshold: U64_MAX,
              tokenBAmountThreshold: U64_MAX,
            };
            await addLiquidity(context.banksClient, addLiquidityParams);

            const amountOut = new BN(1000);

            const userOutputAta = getAssociatedTokenAddressSync(
              outputTokenMint,
              user.publicKey,
              true,
              TOKEN_2022_PROGRAM_ID
            );

            const beforeUserOutputRawAccount =
              await context.banksClient.getAccount(userOutputAta);

            const beforeBalance = unpackAccount(
              userOutputAta,
              // @ts-ignore
              beforeUserOutputRawAccount,
              TOKEN_2022_PROGRAM_ID
            ).amount;

            await swap2ExactOut(context.banksClient, {
              payer: user,
              pool,
              inputTokenMint,
              outputTokenMint,
              amount0: amountOut,
              amount1: new BN("100000000"),
              referralTokenAccount: null,
            });

            const afterUserOutputRawAccount =
              await context.banksClient.getAccount(userOutputAta);

            const afterUserInputTokenAccount = unpackAccount(
              userOutputAta,
              // @ts-ignore
              afterUserOutputRawAccount,
              TOKEN_2022_PROGRAM_ID
            );

            const afterBalance = afterUserInputTokenAccount.amount;
            const exactOutputAmount = afterBalance - beforeBalance;
            expect(new BN(exactOutputAmount.toString()).eq(amountOut)).to.be
              .true;
          }
        });
      });
    });
  });
});
