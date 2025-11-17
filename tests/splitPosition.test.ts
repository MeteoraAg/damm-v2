import { expect } from "chai";
import { generateKpAndFund } from "./helpers/common";
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
  permanentLockPosition,
  U64_MAX,
  addLiquidity,
  swapExactIn,
  convertToByteArray,
  OperatorPermission,
  encodePermissions,
  createOperator,
  startSvm,
  getCpAmmProgramErrorCode,
  expectThrowsErrorCode,
} from "./helpers";
import BN from "bn.js";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Split position", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
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
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);
    // create config

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

    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          data: Array.from(data),
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

    const result = await initializePool(svm, initPoolParams);
    pool = result.pool;
    position = result.position;
  });

  it("Cannot split two same position", async () => {
    const positionState = await getPosition(svm, position);

    const splitParams = {
      unlockedLiquidityPercentage: 50,
      permanentLockedLiquidityPercentage: 0,
      feeAPercentage: 0,
      feeBPercentage: 0,
      reward0Percentage: 0,
      reward1Percentage: 0,
    };

    const errorCode = getCpAmmProgramErrorCode("SamePosition");
    const res = await splitPosition(svm, {
      firstPositionOwner: creator,
      secondPositionOwner: creator,
      pool,
      firstPosition: position,
      secondPosition: position,
      firstPositionNftAccount: derivePositionNftAccount(positionState.nftMint),
      secondPositionNftAccount: derivePositionNftAccount(positionState.nftMint),
      ...splitParams,
    });

    expectThrowsErrorCode(res, errorCode);
  });

  it("Invalid parameters", async () => {
    // create new position
    const secondPosition = await createPosition(
      svm,
      user,
      user.publicKey,
      pool
    );
    const positionState = getPosition(svm, position);
    const secondPositionState = getPosition(svm, secondPosition);

    const splitParams = {
      unlockedLiquidityPercentage: 0,
      permanentLockedLiquidityPercentage: 0,
      feeAPercentage: 0,
      feeBPercentage: 0,
      reward0Percentage: 0,
      reward1Percentage: 0,
    };

    const errorCode = getCpAmmProgramErrorCode(
      "InvalidSplitPositionParameters"
    );

    const res = await splitPosition(svm, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition: position,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(positionState.nftMint),
      secondPositionNftAccount: derivePositionNftAccount(
        secondPositionState.nftMint
      ),
      ...splitParams,
    });

    expectThrowsErrorCode(res, errorCode);
  });

  it("Split position into two position", async () => {
    // swap
    await swapExactIn(svm, {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(100),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    await swapExactIn(svm, {
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
      svm,
      user,
      user.publicKey,
      pool
    );
    const firstPositionState = await getPosition(svm, position);

    const splitParams = {
      unlockedLiquidityPercentage: 50,
      permanentLockedLiquidityPercentage: 0,
      feeAPercentage: 50,
      feeBPercentage: 50,
      reward0Percentage: 0,
      reward1Percentage: 0,
    };

    const newLiquidityDelta = firstPositionState.unlockedLiquidity
      .muln(splitParams.unlockedLiquidityPercentage)
      .divn(100);
    let secondPositionState = await getPosition(svm, secondPosition);
    let poolState = await getPool(svm, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity = secondPositionState.unlockedLiquidity;

    await splitPosition(svm, {
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
      ...splitParams,
    });

    poolState = await getPool(svm, pool);
    secondPositionState = await getPosition(svm, secondPosition);

    // assert
    expect(beforeLiquidity.toString()).eq(poolState.liquidity.toString());
    const afterSecondPositionLiquidity = secondPositionState.unlockedLiquidity;
    expect(
      afterSecondPositionLiquidity.sub(beforeSecondPositionLiquidity).toString()
    ).eq(newLiquidityDelta.toString());
  });

  it("Split permanent locked liquidity position", async () => {
    // permanent lock position
    await permanentLockPosition(svm, position, creator, creator);

    // create new position
    const secondPosition = await createPosition(
      svm,
      user,
      user.publicKey,
      pool
    );
    const firstPositionState = await getPosition(svm, position);

    const splitParams = {
      unlockedLiquidityPercentage: 0,
      permanentLockedLiquidityPercentage: 50,
      feeAPercentage: 0,
      feeBPercentage: 0,
      reward0Percentage: 0,
      reward1Percentage: 0,
    };

    const permanentLockedLiquidityDelta =
      firstPositionState.permanentLockedLiquidity
        .muln(splitParams.permanentLockedLiquidityPercentage)
        .divn(100);
    let secondPositionState = await getPosition(svm, secondPosition);
    let poolState = await getPool(svm, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity =
      secondPositionState.permanentLockedLiquidity;

    await splitPosition(svm, {
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
      ...splitParams,
    });

    poolState = await getPool(svm, pool);
    secondPositionState = await getPosition(svm, secondPosition);

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
      svm,
      creator,
      creator.publicKey,
      pool
    );
    await addLiquidity(svm, {
      owner: creator,
      pool,
      position: firstPosition,
      liquidityDelta: MIN_LP_AMOUNT,
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    });

    const secondPosition = await createPosition(
      svm,
      user,
      user.publicKey,
      pool
    );
    const beforeFirstPositionState = await getPosition(svm, firstPosition);
    const beforeSeconPositionState = await getPosition(svm, secondPosition);

    const splitParams = {
      unlockedLiquidityPercentage: 100,
      permanentLockedLiquidityPercentage: 100,
      feeAPercentage: 100,
      feeBPercentage: 100,
      reward0Percentage: 100,
      reward1Percentage: 100,
    };

    await splitPosition(svm, {
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
      ...splitParams,
    });

    const afterFirstPositionState = await getPosition(svm, firstPosition);
    const afterSeconPositionState = await getPosition(svm, secondPosition);

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
