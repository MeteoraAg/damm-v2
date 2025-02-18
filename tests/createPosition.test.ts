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
  createConfigIx,
  CreateConfigParams,
  createPosition,
  getPool,
  getPosition,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from "./bankrun-utils";
import BN from "bn.js";

describe("Create position", () => {
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
    const createConfigParams: CreateConfigParams = {
      index: new BN(configId),
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

    liquidity = new BN(0);
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
  });

  it("User create a position", async () => {
    const position = await createPosition(
      context.banksClient,
      payer,
      user.publicKey,
      pool
    );
    console.log(position);
  });
});
