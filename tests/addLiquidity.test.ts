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
} from "./bankrun-utils";
import BN from "bn.js";

describe("Add liquidity", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let user: Keypair;
  let payer: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;

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

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE);

    const initPoolParams: InitializePoolParams = {
      payer: payer,
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
  });

  it("User add liquidity a position", async () => {
    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(100),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(context.banksClient, addLiquidityParams);
  });
});
