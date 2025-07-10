import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import { expectThrowsAsync, generateKpAndFund, startTest } from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createConfigIx,
  CreateConfigParams,
  getPool,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  createToken,
  mintSplTokenTo,
  createPosition,
  getPosition,
  splitPosition,
  derivePositionNftAccount,
  getCpAmmProgramErrorCodeHexString,
} from "./bankrun-utils";
import BN from "bn.js";

describe("Split position", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let creator: Keypair;
  let config: PublicKey;
  let user: Keypair;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  const configId = Math.floor(Math.random() * 1000);
  let pool: PublicKey;
  let position: PublicKey;

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);
    creator = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);
    user = await generateKpAndFund(context.banksClient, context.payer);

    tokenAMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );
    tokenBMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      creator.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenBMint,
      context.payer,
      creator.publicKey
    );
    // create config
    const createConfigParams: CreateConfigParams = {
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
      new BN(configId),
      createConfigParams
    );

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE);

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };

    const result = await initializePool(context.banksClient, initPoolParams);
    pool = result.pool;
    position = result.position;
  });

  it("Cannot split two same position", async () => {
    const positionState = await getPosition(context.banksClient, position);

    const splitParams = {
      unlockedLiquidityPercentage: 50,
      permanentLockedLiquidityPercentage: 0,
      feeAPercentage: 0,
      feeBPercentage: 0,
      reward0Percentage: 0,
      reward1Percentage: 0,
    }

    const errorCode = getCpAmmProgramErrorCodeHexString("SamePosition")

    await expectThrowsAsync( async () => {await splitPosition(context.banksClient, {
      owner1: creator,
      owner2: creator,
      pool,
      firstPosition: position,
      secondPosition: position,
      firstPositionNftAccount: derivePositionNftAccount(
        positionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        positionState.nftMint
      ),
      ...splitParams
    })}, errorCode)

   
  });

  it("Split position into two position", async () => {

    // create new position
    const secondPosition = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );
    const firstPositionState = await getPosition(context.banksClient, position);

    const splitParams = {
      unlockedLiquidityPercentage: 50,
      permanentLockedLiquidityPercentage: 0,
      feeAPercentage: 0,
      feeBPercentage: 0,
      reward0Percentage: 0,
      reward1Percentage: 0,
    }

    const newLiquidityDelta = firstPositionState.unlockedLiquidity.muln(splitParams.unlockedLiquidityPercentage).divn(100);
    let secondPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );
    let poolState = await getPool(context.banksClient, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity = secondPositionState.unlockedLiquidity;

    await splitPosition(context.banksClient, {
      owner1: creator,
      owner2: user,
      pool,
      firstPosition: position,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(
        firstPositionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        secondPositionState.nftMint
      ),
      ...splitParams
    });

    poolState = await getPool(context.banksClient, pool);
    secondPositionState = await getPosition(context.banksClient, secondPosition);

    // assert
    expect(beforeLiquidity.toString()).eq(poolState.liquidity.toString());
    const afterSecondPositionLiquidity = secondPositionState.unlockedLiquidity;
    expect(
      afterSecondPositionLiquidity.sub(beforeSecondPositionLiquidity).toString()
    ).eq(newLiquidityDelta.toString());
  });
});
