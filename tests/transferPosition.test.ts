import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  createConfigIx,
  createPosition,
  getPosition,
  initializePool,
  LOCK_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  transferPosition,
} from "./bankrun-utils";
import { randomID, setupTestContext, startTest } from "./bankrun-utils/common";

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

  it("User transfer position", async () => {
    // Create a position
    const position = await createPosition(
      context.banksClient,
      payer,
      user.publicKey,
      pool
    );

    let positionState = await getPosition(context.banksClient, position);
    expect(positionState.owner).to.be.eql(user.publicKey);

    const newOwnerKeypair = Keypair.generate();
    await transferPosition(
      context.banksClient,
      position,
      user,
      newOwnerKeypair.publicKey
    );

    positionState = await getPosition(context.banksClient, position);
    expect(positionState.owner).to.be.eql(newOwnerKeypair.publicKey);
  });
});
