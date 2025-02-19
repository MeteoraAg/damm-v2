import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  randomID,
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
  LOCK_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  removeLiquidity,
  RemoveLiquidityParams,
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
      index: new BN(randomID()),
      poolFees: {
        tradeFeeNumerator: new BN(2_500_000),
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

    liquidity = new BN(LOCK_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE);

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
    let liquidity = new BN("100000000000");
    const addLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: liquidity,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    };
    await addLiquidity(context.banksClient, addLiquidityParams);
    // return

    // remove liquidity

    const removeLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: liquidity,
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    };
    await removeLiquidity(context.banksClient, removeLiquidityParams);
  });
});
