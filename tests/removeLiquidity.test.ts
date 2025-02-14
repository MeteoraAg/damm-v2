import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  setupTestContext,
  setupTokenMint,
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
  removeLiquidity,
  RemoveLiquidityParams,
  U128_MAX,
  U64_MAX,
} from "./bankrun-utils";
import BN from "bn.js";

describe("Remove liquidity", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let user: Keypair;
  let payer: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    context = await startTest();

    const prepareContext = await setupTestContext(
      context.banksClient,
      context.payer
    );
    payer = prepareContext.payer;
    user = prepareContext.user;
    admin = prepareContext.admin;

    // create config
    const createConfigParams = {
      index: new BN(configId),
      poolFees: {
        tradeFeeNumerator: new BN(2_500_000),
        protocolFeePercent: 10,
        partnerFeePercent: 0,
        referralFeePercent: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(0),
      sqrtMaxPrice: new BN(U128_MAX),
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

    liquidity = new BN(0);
    sqrtPrice = new BN(1);

    const initPoolParams = {
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
  });

  it("User remove liquidity", async () => {
    // create a position
    const position = await createPosition(
      context.banksClient,
      payer,
      user.publicKey,
      pool
    );

    // add liquidity
    const addLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(100),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(context.banksClient, addLiquidityParams);

    // remove liquidity

    const removeLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(100),
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    };
    await removeLiquidity(context.banksClient, removeLiquidityParams);
  });
});
