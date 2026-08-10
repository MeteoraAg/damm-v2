import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  addLiquidity,
  AddLiquidityParams,
  addLiquidity2,
  claimPositionFee,
  claimPositionFee2,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  createToken,
  createTokenBadge,
  getCpAmmProgramErrorCode,
  getPool,
  getTokenBalance,
  initializePool,
  InitializePoolParams,
  initializePool2,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OFFSET,
  swapExactIn,
  SwapParams,
  swap3,
  SwapMode,
  encodePermissions,
  OperatorPermission,
  createOperator,
  startSvm,
  U64_MAX,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import {
  createToken2022,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import {
  createExtraAccountMetaListAndCounter,
  getHookRemainingAccounts,
  readHookCounter,
} from "./helpers/transferHook";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM, TransactionMetadata } from "litesvm";

describe("Claim position fee", () => {
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
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

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
      new BN(configId),
      createConfigParams
    );

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(1).shln(OFFSET),
      activationPoint: null,
    };

    const result = await initializePool(svm, initPoolParams);
    pool = result.pool;
    position = await createPosition(svm, user, user.publicKey, pool);
  });

  it("User claim position fee", async () => {
    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(1_000_000_000).shln(OFFSET),
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(svm, addLiquidityParams);

    const swapParams: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(100_000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams);

    const poolState = getPool(svm, pool);
    const preTokenBVaultBalance = getTokenBalance(svm, poolState.tokenBVault);

    // claim position fee
    const claimParams = {
      owner: user,
      pool,
      position,
    };
    await claimPositionFee(svm, claimParams);

    const postTokenBVaultBalance = getTokenBalance(svm, poolState.tokenBVault);
    expect(Number(postTokenBVaultBalance)).lt(Number(preTokenBVaultBalance));
  });

  it("User claim position fee with claim_position_fee2", async () => {
    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(1_000_000_000).shln(OFFSET),
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(svm, addLiquidityParams);

    const swapParams: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(100_000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams);

    const poolState = getPool(svm, pool);
    const preTokenBVaultBalance = getTokenBalance(svm, poolState.tokenBVault);

    // claim position fee
    await claimPositionFee2(svm, {
      owner: user,
      pool,
      position,
    });

    const postTokenBVaultBalance = getTokenBalance(svm, poolState.tokenBVault);
    expect(Number(postTokenBVaultBalance)).lt(Number(preTokenBVaultBalance));
  });
});

describe("Claim position fee with token 2022 transfer hook", () => {
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
  const configId = Math.floor(Math.random() * 1000);

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
      [createTransferHookExtensionWithInstruction(tokenAMint, admin.publicKey)],
      tokenAMintKeypair,
      admin.publicKey
    );
    await createToken2022(
      svm,
      [createTransferHookExtensionWithInstruction(tokenBMint, admin.publicKey)],
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

    const data = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      0,
      BigInt(0),
      BigInt(0),
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
      new BN(configId),
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
    await addLiquidity2(svm, {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(1_000_000_000).shln(OFFSET),
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
      tokenAHookAccounts,
      tokenBHookAccounts,
    });

    // swap both directions so fees accrue in both tokens
    for (const [inputTokenMint, outputTokenMint] of [
      [tokenAMint, tokenBMint],
      [tokenBMint, tokenAMint],
    ]) {
      await swap3(svm, {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amount0: new BN(1_000_000),
        amount1: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
        tokenAHookAccounts,
        tokenBHookAccounts,
      });
    }
  });

  it("claim_position_fee2 invokes the hook on both transfers", async () => {
    const beforeCounterA = readHookCounter(svm, tokenAMint);
    const beforeCounterB = readHookCounter(svm, tokenBMint);

    await claimPositionFee2(svm, {
      owner: user,
      pool,
      position,
      tokenAHookAccounts,
      tokenBHookAccounts,
    });

    // one vault->user fee transfer per mint
    expect(readHookCounter(svm, tokenAMint)).eq(beforeCounterA + 1);
    expect(readHookCounter(svm, tokenBMint)).eq(beforeCounterB + 1);
  });

  it("claim_position_fee2 fails when transfer hook accounts are missing", async () => {
    await claimPositionFee2(
      svm,
      {
        owner: user,
        pool,
        position,
      },
      getCpAmmProgramErrorCode("MissingRemainingAccountForTransferHook")
    );
  });
});
