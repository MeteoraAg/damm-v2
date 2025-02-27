import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import { randomID, setupTestContext, startTest } from "./bankrun-utils/common";
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
  getPool,
  U64_MAX,
} from "./bankrun-utils";
import BN from "bn.js";
import { AccountLayout } from "@solana/spl-token";

describe("Add liquidity", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let user: Keypair;
  let payer: Keypair;
  let config: PublicKey;
  let pool: PublicKey;
  let position: PublicKey;
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
    poolCreator = prepareContext.poolCreator.publicKey;
    tokenAMint = prepareContext.tokenAMint;
    tokenBMint = prepareContext.tokenBMint;

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

    config = await createConfigIx(
      context.banksClient,
      admin,
      createConfigParams
    );
  });

  it("Create pool with sqrtPrice equal sqrtMintPrice", async () => {
    const initPoolParams: InitializePoolParams = {
      payer: payer,
      creator: poolCreator,
      config,
      tokenAMint: tokenAMint,
      tokenBMint: tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
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

    const poolState = await getPool(context.banksClient, pool);

    const preTokenAVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenAVault)).data
      ).amount
    );

    const preTokenBVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenBVault)).data
      ).amount
    );

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: MIN_LP_AMOUNT,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(context.banksClient, addLiquidityParams);

    const postTokenAVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenAVault)).data
      ).amount
    );

    const postTokenBVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenBVault)).data
      ).amount
    );

    expect(preTokenBVaultBalance).eq(postTokenBVaultBalance);

    console.log({ preTokenAVaultBalance, postTokenAVaultBalance });
    console.log({
      preTokenBVaultBalance,
      postTokenBVaultBalance,
    });
  });

  it("Create pool with sqrtPrice equal sqrtMaxPrice", async () => {
    const initPoolParams: InitializePoolParams = {
      payer: payer,
      creator: poolCreator,
      config,
      tokenAMint: tokenAMint,
      tokenBMint: tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MAX_SQRT_PRICE,
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

    const poolState = await getPool(context.banksClient, pool);

    const preTokenAVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenAVault)).data
      ).amount
    );

    const preTokenBVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenBVault)).data
      ).amount
    );

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: MIN_LP_AMOUNT,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(context.banksClient, addLiquidityParams);

    const postTokenAVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenAVault)).data
      ).amount
    );

    const postTokenBVaultBalance = Number(
      AccountLayout.decode(
        (await context.banksClient.getAccount(poolState.tokenBVault)).data
      ).amount
    );

    console.log({ preTokenAVaultBalance, postTokenAVaultBalance });
    console.log({
      preTokenBVaultBalance,
      postTokenBVaultBalance,
    });

    expect(preTokenAVaultBalance).eq(postTokenAVaultBalance);
  });
});
