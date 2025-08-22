import { generateKpAndFund, randomID } from "./helpers/common";
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
  encodePermissions,
  OperatorPermission,
  createOperator,
  startSvm,
} from "./helpers";
import BN from "bn.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  createToken2022,
  createTransferFeeExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import { expect } from "chai";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Swap token", () => {
  describe("SPL Token", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    let pool: PublicKey;
    let position: PublicKey;
    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;

    beforeEach(async () => {
      svm = startSvm();

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      inputTokenMint = createToken(svm, admin.publicKey);
      outputTokenMint = createToken(svm, admin.publicKey);

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
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
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
    });
  });

  describe("Token 2022", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let liquidity: BN;
    let sqrtPrice: BN;
    let pool: PublicKey;
    let position: PublicKey;

    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;

    beforeEach(async () => {
      svm = startSvm();

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
      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      await createToken2022(
        svm,
        inputMintExtension,
        inputTokenMintKeypair,
        admin.publicKey
      );
      await createToken2022(
        svm,
        outputMintExtension,
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

      const result = await initializePool(svm, initPoolParams);
      pool = result.pool;
      position = await createPosition(svm, user, user.publicKey, pool);
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
            await addLiquidity(svm, addLiquidityParams);

            const amountIn = new BN(10);

            const userInputAta = getAssociatedTokenAddressSync(
              inputTokenMint,
              user.publicKey,
              true,
              TOKEN_2022_PROGRAM_ID
            );

            const beforeUserInputRawAccount = await svm.getAccount(
              userInputAta
            );

            const beforeBalance = unpackAccount(
              userInputAta,
              // @ts-ignore
              beforeUserInputRawAccount,
              TOKEN_2022_PROGRAM_ID
            ).amount;

            await swap2ExactIn(svm, {
              payer: user,
              pool,
              inputTokenMint,
              outputTokenMint,
              amount0: amountIn,
              amount1: new BN(0),
              referralTokenAccount: null,
            });

            const afterUserInputRawAccount = await svm.getAccount(userInputAta);

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
            await addLiquidity(svm, addLiquidityParams);

            const amountIn = new BN("10000000000000");

            const userInputAta = getAssociatedTokenAddressSync(
              inputTokenMint,
              user.publicKey,
              true,
              TOKEN_2022_PROGRAM_ID
            );

            const beforeUserInputRawAccount = await svm.getAccount(
              userInputAta
            );

            const beforeBalance = unpackAccount(
              userInputAta,
              // @ts-ignore
              beforeUserInputRawAccount,
              TOKEN_2022_PROGRAM_ID
            ).amount;

            await swap2PartialFillIn(svm, {
              payer: user,
              pool,
              inputTokenMint,
              outputTokenMint,
              amount0: amountIn,
              amount1: new BN(0),
              referralTokenAccount: null,
            });

            const afterUserInputRawAccount = await svm.getAccount(userInputAta);

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
            await addLiquidity(svm, addLiquidityParams);

            const amountOut = new BN(1000);

            const userOutputAta = getAssociatedTokenAddressSync(
              outputTokenMint,
              user.publicKey,
              true,
              TOKEN_2022_PROGRAM_ID
            );

            const beforeUserOutputRawAccount = await svm.getAccount(
              userOutputAta
            );

            const beforeBalance = unpackAccount(
              userOutputAta,
              // @ts-ignore
              beforeUserOutputRawAccount,
              TOKEN_2022_PROGRAM_ID
            ).amount;

            await swap2ExactOut(svm, {
              payer: user,
              pool,
              inputTokenMint,
              outputTokenMint,
              amount0: amountOut,
              amount1: new BN("100000000"),
              referralTokenAccount: null,
            });

            const afterUserOutputRawAccount = await svm.getAccount(
              userOutputAta
            );

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