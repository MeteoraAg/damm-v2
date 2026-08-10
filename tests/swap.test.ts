import { generateKpAndFund, randomID } from "./helpers/common";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  addLiquidity,
  AddLiquidityParams,
  addLiquidity2,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  createTokenBadge,
  initializePool,
  InitializePoolParams,
  initializePool2,
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
  swap3,
  swap3Instruction,
  SwapMode,
  sendTransaction,
  OFFSET,
  encodePermissions,
  OperatorPermission,
  createOperator,
  startSvm,
  getOrCreateAssociatedTokenAccount,
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
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import {
  createExtraAccountMetaListAndCounter,
  getHookRemainingAccounts,
  readHookCounter,
} from "./helpers/transferHook";
import { expect } from "chai";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";

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
          compoundingFeeBps: 0,
          padding: 0,
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

    it("User swap A->B with swap3", async () => {
      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
      };
      await addLiquidity(svm, addLiquidityParams);

      await swap3(svm, {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amount0: new BN(10),
        amount1: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      });
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
          compoundingFeeBps: 0,
          padding: 0,
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

  describe("Token 2022 with transfer hook", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let user: Keypair;
    let creator: Keypair;
    let whitelistedAccount: Keypair;
    let config: PublicKey;
    let pool: PublicKey;
    let position: PublicKey;

    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let tokenAHookAccounts: AccountMeta[];
    let tokenBHookAccounts: AccountMeta[];

    const getTokenBalance = (
      svm: LiteSVM,
      mint: PublicKey,
      owner: PublicKey
    ) => {
      const ata = getAssociatedTokenAddressSync(
        mint,
        owner,
        true,
        TOKEN_2022_PROGRAM_ID
      );
      const rawAccount = svm.getAccount(ata);
      // @ts-ignore
      return unpackAccount(ata, rawAccount, TOKEN_2022_PROGRAM_ID).amount;
    };

    beforeEach(async () => {
      svm = startSvm();

      const tokenAMintKeypair = Keypair.generate();
      const tokenBMintKeypair = Keypair.generate();
      tokenAMint = tokenAMintKeypair.publicKey;
      tokenBMint = tokenBMintKeypair.publicKey;

      user = generateKpAndFund(svm);
      admin = generateKpAndFund(svm);
      creator = generateKpAndFund(svm);
      whitelistedAccount = generateKpAndFund(svm);

      await createToken2022(
        svm,
        [
          createTransferHookExtensionWithInstruction(
            tokenAMint,
            admin.publicKey
          ),
        ],
        tokenAMintKeypair,
        admin.publicKey
      );
      await createToken2022(
        svm,
        [
          createTransferHookExtensionWithInstruction(
            tokenBMint,
            admin.publicKey
          ),
        ],
        tokenBMintKeypair,
        admin.publicKey
      );

      await createExtraAccountMetaListAndCounter(svm, admin, tokenAMint);
      await createExtraAccountMetaListAndCounter(svm, admin, tokenBMint);

      tokenAHookAccounts = getHookRemainingAccounts(tokenAMint);
      tokenBHookAccounts = getHookRemainingAccounts(tokenBMint);

      await mintToToken2022(svm, tokenAMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, user.publicKey);

      await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

      await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

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
        poolCreatorAuthority: PublicKey.default,
        activationType: 0,
        collectFeeMode: 0,
      };

      let permission = encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.CreateTokenBadge,
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

      // active hook mints require a token badge for pool creation
      await createTokenBadge(svm, {
        tokenMint: tokenAMint,
        whitelistedAddress: whitelistedAccount,
      });
      await createTokenBadge(svm, {
        tokenMint: tokenBMint,
        whitelistedAddress: whitelistedAccount,
      });

      const { pool: newPool, result } = await initializePool2(svm, {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity: new BN(MIN_LP_AMOUNT),
        sqrtPrice: new BN(1).shln(OFFSET),
        activationPoint: null,
        tokenAHookAccounts,
        tokenBHookAccounts,
      });
      expect(result).instanceOf(TransactionMetadata);
      pool = newPool;
      position = await createPosition(svm, user, user.publicKey, pool);
    });

    const addLiquidityWithHooks = async (liquidityDelta: BN, threshold: BN) => {
      await addLiquidity2(svm, {
        owner: user,
        pool,
        position,
        liquidityDelta,
        tokenAAmountThreshold: threshold,
        tokenBAmountThreshold: threshold,
        tokenAHookAccounts,
        tokenBHookAccounts,
      });
    };

    it("Swap3 ExactIn invokes the hook on both transfers", async () => {
      await addLiquidityWithHooks(new BN(MIN_SQRT_PRICE.muln(30)), new BN(200));

      const tokenPermutation = [
        [tokenAMint, tokenBMint],
        [tokenBMint, tokenAMint],
      ];

      for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
        const amountIn = new BN(10);

        const beforeBalance = getTokenBalance(
          svm,
          inputTokenMint,
          user.publicKey
        );
        const beforeInputCounter = readHookCounter(svm, inputTokenMint);
        const beforeOutputCounter = readHookCounter(svm, outputTokenMint);

        await swap3(svm, {
          payer: user,
          pool,
          inputTokenMint,
          outputTokenMint,
          amount0: amountIn,
          amount1: new BN(0),
          swapMode: SwapMode.ExactIn,
          referralTokenAccount: null,
          tokenAHookAccounts,
          tokenBHookAccounts,
        });

        const afterBalance = getTokenBalance(
          svm,
          inputTokenMint,
          user.publicKey
        );
        const exactInputAmount = beforeBalance - afterBalance;
        expect(Number(exactInputAmount)).to.be.equal(amountIn.toNumber());

        // one user->vault transfer of the input mint, one vault->user transfer of the output mint
        expect(readHookCounter(svm, inputTokenMint)).to.be.equal(
          beforeInputCounter + 1
        );
        expect(readHookCounter(svm, outputTokenMint)).to.be.equal(
          beforeOutputCounter + 1
        );
      }
    });

    it("Swap3 PartialFillIn invokes the hook on both transfers", async () => {
      await addLiquidityWithHooks(new BN(MIN_SQRT_PRICE.muln(30)), new BN(200));

      const tokenPermutation = [
        [tokenAMint, tokenBMint],
        [tokenBMint, tokenAMint],
      ];

      for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
        const amountIn = new BN("10000000000000");

        const beforeBalance = getTokenBalance(
          svm,
          inputTokenMint,
          user.publicKey
        );
        const beforeInputCounter = readHookCounter(svm, inputTokenMint);
        const beforeOutputCounter = readHookCounter(svm, outputTokenMint);

        await swap3(svm, {
          payer: user,
          pool,
          inputTokenMint,
          outputTokenMint,
          amount0: amountIn,
          amount1: new BN(0),
          swapMode: SwapMode.PartialFillIn,
          referralTokenAccount: null,
          tokenAHookAccounts,
          tokenBHookAccounts,
        });

        const afterBalance = getTokenBalance(
          svm,
          inputTokenMint,
          user.publicKey
        );
        const exactInputAmount = beforeBalance - afterBalance;
        expect(new BN(exactInputAmount.toString()).lt(amountIn)).to.be.true;

        expect(readHookCounter(svm, inputTokenMint)).to.be.equal(
          beforeInputCounter + 1
        );
        expect(readHookCounter(svm, outputTokenMint)).to.be.equal(
          beforeOutputCounter + 1
        );
      }
    });

    it("Swap3 ExactOut invokes the hook on both transfers", async () => {
      await addLiquidityWithHooks(new BN("10000000000").shln(OFFSET), U64_MAX);

      const tokenPermutation = [
        [tokenAMint, tokenBMint],
        [tokenBMint, tokenAMint],
      ];

      for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
        const amountOut = new BN(1000);

        const beforeBalance = getTokenBalance(
          svm,
          outputTokenMint,
          user.publicKey
        );
        const beforeInputCounter = readHookCounter(svm, inputTokenMint);
        const beforeOutputCounter = readHookCounter(svm, outputTokenMint);

        await swap3(svm, {
          payer: user,
          pool,
          inputTokenMint,
          outputTokenMint,
          amount0: amountOut,
          amount1: new BN("100000000"),
          swapMode: SwapMode.ExactOut,
          referralTokenAccount: null,
          tokenAHookAccounts,
          tokenBHookAccounts,
        });

        const afterBalance = getTokenBalance(
          svm,
          outputTokenMint,
          user.publicKey
        );
        const exactOutputAmount = afterBalance - beforeBalance;
        expect(new BN(exactOutputAmount.toString()).eq(amountOut)).to.be.true;

        expect(readHookCounter(svm, inputTokenMint)).to.be.equal(
          beforeInputCounter + 1
        );
        expect(readHookCounter(svm, outputTokenMint)).to.be.equal(
          beforeOutputCounter + 1
        );
      }
    });

    // CollectFeeMode::BothToken takes the fee on the output token, so the referral fee is
    // always paid in the output mint
    const createReferralTokenAccounts = () => {
      const referrer = generateKpAndFund(svm);
      const accounts: Record<string, PublicKey> = {
        [tokenAMint.toBase58()]: getOrCreateAssociatedTokenAccount(
          svm,
          referrer,
          tokenAMint,
          referrer.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        [tokenBMint.toBase58()]: getOrCreateAssociatedTokenAccount(
          svm,
          referrer,
          tokenBMint,
          referrer.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
      };
      return { referrer, accounts };
    };

    it("Swap3 invokes the hook on the referral transfer", async () => {
      await addLiquidityWithHooks(new BN("10000000000").shln(OFFSET), U64_MAX);

      const referralTokenAccounts = createReferralTokenAccounts();
      const referrer = referralTokenAccounts.referrer;

      const tokenPermutation = [
        [tokenAMint, tokenBMint],
        [tokenBMint, tokenAMint],
      ];

      for (const [inputTokenMint, outputTokenMint] of tokenPermutation) {
        const amountIn = new BN(1_000_000);

        const beforeReferralBalance = getTokenBalance(
          svm,
          outputTokenMint,
          referrer.publicKey
        );
        const beforeInputCounter = readHookCounter(svm, inputTokenMint);
        const beforeOutputCounter = readHookCounter(svm, outputTokenMint);

        await swap3(svm, {
          payer: user,
          pool,
          inputTokenMint,
          outputTokenMint,
          amount0: amountIn,
          amount1: new BN(0),
          swapMode: SwapMode.ExactIn,
          referralTokenAccount:
            referralTokenAccounts.accounts[outputTokenMint.toBase58()],
          tokenAHookAccounts,
          tokenBHookAccounts,
          referralHookAccounts: outputTokenMint.equals(tokenAMint)
            ? tokenAHookAccounts
            : tokenBHookAccounts,
        });

        const afterReferralBalance = getTokenBalance(
          svm,
          outputTokenMint,
          referrer.publicKey
        );
        expect(
          Number(afterReferralBalance - beforeReferralBalance)
        ).to.be.greaterThan(0);

        // one user->vault transfer of the input mint, one vault->user transfer and one
        // vault->referral transfer of the output mint
        expect(readHookCounter(svm, inputTokenMint)).to.be.equal(
          beforeInputCounter + 1
        );
        expect(readHookCounter(svm, outputTokenMint)).to.be.equal(
          beforeOutputCounter + 2
        );
      }
    });

    it("Swap3 with a referral fails when the referral hook accounts are missing", async () => {
      await addLiquidityWithHooks(new BN("10000000000").shln(OFFSET), U64_MAX);

      const referralTokenAccounts = createReferralTokenAccounts();

      const transaction = await swap3Instruction(svm, {
        payer: user,
        pool,
        inputTokenMint: tokenAMint,
        outputTokenMint: tokenBMint,
        amount0: new BN(1_000_000),
        amount1: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount:
          referralTokenAccounts.accounts[tokenBMint.toBase58()],
        tokenAHookAccounts,
        tokenBHookAccounts,
      });

      const result = sendTransaction(svm, transaction, [user]);
      expect(result).instanceOf(FailedTransactionMetadata);
    });

    it("Swap3 fails when transfer hook accounts are missing", async () => {
      await addLiquidityWithHooks(new BN(MIN_SQRT_PRICE.muln(30)), new BN(200));

      const transaction = await swap3Instruction(svm, {
        payer: user,
        pool,
        inputTokenMint: tokenAMint,
        outputTokenMint: tokenBMint,
        amount0: new BN(10),
        amount1: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      });

      const result = sendTransaction(svm, transaction, [user]);
      expect(result).instanceOf(FailedTransactionMetadata);
    });
  });
});
