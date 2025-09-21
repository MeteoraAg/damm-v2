import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  expectThrowsAsync,
  generateKpAndFund,
  startTest,
} from "./bankrun-utils/common";
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
  splitPosition2,
  derivePositionNftAccount,
  getCpAmmProgramErrorCodeHexString,
  permanentLockPosition,
  U64_MAX,
  addLiquidity,
  swap,
  SPLIT_POSITION_DENOMINATOR,
} from "./bankrun-utils";
import BN from "bn.js";

describe("Split position 2", () => {
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

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenBMint,
      context.payer,
      user.publicKey
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

    config = await createConfigIx(
      context.banksClient,
      admin,
      new BN(configId),
      createConfigParams
    );

    liquidity = new BN(MIN_LP_AMOUNT.muln(100));
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

    const numerator = SPLIT_POSITION_DENOMINATOR / 2;

    const errorCode = getCpAmmProgramErrorCodeHexString("SamePosition");

    await expectThrowsAsync(async () => {
      await splitPosition2(context.banksClient, {
        firstPositionOwner: creator,
        secondPositionOwner: creator,
        pool,
        firstPosition: position,
        secondPosition: position,
        firstPositionNftAccount: derivePositionNftAccount(
          positionState.nftMint
        ),
        secondPositionNftAccount: derivePositionNftAccount(
          positionState.nftMint
        ),
        numerator,
      });
    }, errorCode);
  });

  it("Invalid parameters", async () => {
    // create new position
    const secondPosition = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );
    const positionState = await getPosition(context.banksClient, position);
    const secondPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );

    const numerator = 0;

    const errorCode = getCpAmmProgramErrorCodeHexString(
      "InvalidSplitPositionParameters"
    );

    await expectThrowsAsync(async () => {
      await splitPosition2(context.banksClient, {
        firstPositionOwner: creator,
        secondPositionOwner: user,
        pool,
        firstPosition: position,
        secondPosition,
        firstPositionNftAccount: derivePositionNftAccount(
          positionState.nftMint
        ),
        secondPositionNftAccount: derivePositionNftAccount(
          secondPositionState.nftMint
        ),
        numerator
      });
    }, errorCode);
  });

  it("Split position into two position", async () => {
    // swap
    await swap(context.banksClient, {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(100),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    await swap(context.banksClient, {
      payer: user,
      pool,
      inputTokenMint: tokenBMint,
      outputTokenMint: tokenAMint,
      amountIn: new BN(100),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    // create new position
    const secondPosition = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );
    const firstPositionState = await getPosition(context.banksClient, position);

    const numerator = SPLIT_POSITION_DENOMINATOR / 2;

    const newLiquidityDelta = firstPositionState.unlockedLiquidity
      .mul(new BN(numerator))
      .div(new BN(SPLIT_POSITION_DENOMINATOR));


    let secondPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );
    let poolState = await getPool(context.banksClient, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity = secondPositionState.unlockedLiquidity;

    await splitPosition2(context.banksClient, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition: position,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(
        firstPositionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        secondPositionState.nftMint
      ),
      numerator,
    });

    poolState = await getPool(context.banksClient, pool);
    secondPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );

    // assert
    expect(beforeLiquidity.toString()).eq(poolState.liquidity.toString());
    const afterSecondPositionLiquidity = secondPositionState.unlockedLiquidity;
    expect(
      afterSecondPositionLiquidity.sub(beforeSecondPositionLiquidity).toString()
    ).eq(newLiquidityDelta.toString());
  });

  it("Split permanent locked liquidity position", async () => {
    // permanent lock position
    await permanentLockPosition(
      context.banksClient,
      position,
      creator,
      creator
    );

    // create new position
    const secondPosition = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );
    const firstPositionState = await getPosition(context.banksClient, position);
    const numerator = SPLIT_POSITION_DENOMINATOR / 2;

    const permanentLockedLiquidityDelta =
      firstPositionState.permanentLockedLiquidity
        .mul(new BN(numerator))
        .div(new BN(SPLIT_POSITION_DENOMINATOR));
    let secondPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );
    let poolState = await getPool(context.banksClient, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity =
      secondPositionState.permanentLockedLiquidity;

    await splitPosition2(context.banksClient, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition: position,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(
        firstPositionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        secondPositionState.nftMint
      ),
      numerator,
    });

    poolState = await getPool(context.banksClient, pool);
    secondPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );

    // assert
    expect(beforeLiquidity.toString()).eq(poolState.liquidity.toString());
    const afterSecondPositionLiquidity =
      secondPositionState.permanentLockedLiquidity;
    expect(
      afterSecondPositionLiquidity.sub(beforeSecondPositionLiquidity).toString()
    ).eq(permanentLockedLiquidityDelta.toString());
  });

  it("Merge two position", async () => {
    const firstPosition = await createPosition(
      context.banksClient,
      creator,
      creator.publicKey,
      pool
    );
    await addLiquidity(context.banksClient, {
      owner: creator,
      pool,
      position: firstPosition,
      liquidityDelta: MIN_LP_AMOUNT,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    });

    const secondPosition = await createPosition(
      context.banksClient,
      user,
      user.publicKey,
      pool
    );
    const beforeFirstPositionState = await getPosition(
      context.banksClient,
      firstPosition
    );
    const beforeSeconPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );

    await splitPosition2(context.banksClient, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(
        beforeFirstPositionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        beforeSeconPositionState.nftMint
      ),
      numerator: SPLIT_POSITION_DENOMINATOR
    });

    const afterFirstPositionState = await getPosition(
      context.banksClient,
      firstPosition
    );
    const afterSeconPositionState = await getPosition(
      context.banksClient,
      secondPosition
    );

    expect(afterFirstPositionState.unlockedLiquidity.toNumber()).eq(0);
    expect(afterFirstPositionState.permanentLockedLiquidity.toNumber()).eq(0);
    expect(afterFirstPositionState.feeAPending.toNumber()).eq(0);
    expect(afterFirstPositionState.feeBPending.toNumber()).eq(0);

    expect(
      afterSeconPositionState.unlockedLiquidity
        .sub(beforeSeconPositionState.unlockedLiquidity)
        .toString()
    ).eq(beforeFirstPositionState.unlockedLiquidity.toString());
    expect(
      afterSeconPositionState.permanentLockedLiquidity
        .sub(beforeSeconPositionState.permanentLockedLiquidity)
        .toString()
    ).eq(beforeFirstPositionState.permanentLockedLiquidity.toString());
    expect(
      afterSeconPositionState.feeAPending
        .sub(beforeSeconPositionState.feeAPending)
        .toString()
    ).eq(beforeFirstPositionState.feeAPending.toString());
    expect(
      afterSeconPositionState.feeBPending
        .sub(beforeSeconPositionState.feeBPending)
        .toString()
    ).eq(beforeFirstPositionState.feeBPending.toString());
  });
});
