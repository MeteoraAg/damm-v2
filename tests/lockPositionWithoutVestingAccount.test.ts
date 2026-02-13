import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  addLiquidity,
  AddLiquidityParams,
  claimPositionFee,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  getPosition,
  initializePool,
  InitializePoolParams,
  lockPosition,
  LockPositionParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  refreshVestings,
  startSvm,
  swapExactIn,
  SwapParams,
  warpSlotBy,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

describe("Lock position inner", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let whitelistedAccount: Keypair;
  let creator: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let liquidityDelta: BN;

  const configId = Math.floor(Math.random() * 1000);

  const numberOfPeriod = 10;
  const periodFrequency = new BN(1);
  let cliffUnlockLiquidity: BN;
  let liquidityToLock: BN;
  let liquidityPerPeriod: BN;

  before(async () => {
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

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));
    liquidityDelta = new BN(sqrtPrice.mul(new BN(1_000)));

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
    position = await createPosition(svm, user, user.publicKey, pool);

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta,
      tokenAAmountThreshold: new BN(2_000_000_000),
      tokenBAmountThreshold: new BN(2_000_000_000),
    };
    await addLiquidity(svm, addLiquidityParams);
  });

  it("Partial lock position", async () => {
    const beforePositionState = getPosition(svm, position);

    liquidityToLock = beforePositionState.unlockedLiquidity.div(new BN(2));

    cliffUnlockLiquidity = liquidityToLock.div(new BN(2));
    liquidityPerPeriod = liquidityToLock
      .sub(cliffUnlockLiquidity)
      .div(new BN(numberOfPeriod));

    const loss = liquidityToLock.sub(
      cliffUnlockLiquidity.add(liquidityPerPeriod.mul(new BN(numberOfPeriod)))
    );
    cliffUnlockLiquidity = cliffUnlockLiquidity.add(loss);
    warpSlotBy(svm, new BN(1));

    const lockPositionParams: LockPositionParams = {
      cliffPoint: null,
      periodFrequency,
      cliffUnlockLiquidity,
      liquidityPerPeriod,
      numberOfPeriod,
    };

    await lockPosition(svm, position, user, user, lockPositionParams, true);

    const positionState = getPosition(svm, position);
    expect(positionState.vestedLiquidity.eq(liquidityToLock)).to.be.true;

    const vestingState = positionState.innerVesting;
    console.log("cliffPoint: ", vestingState.cliffPoint.toString());
    expect(!vestingState.cliffPoint.isZero()).to.be.true;
    expect(vestingState.cliffUnlockLiquidity.eq(cliffUnlockLiquidity)).to.be
      .true;
    expect(vestingState.liquidityPerPeriod.eq(liquidityPerPeriod)).to.be.true;
    expect(vestingState.numberOfPeriod).to.be.equal(numberOfPeriod);
    expect(vestingState.totalReleasedLiquidity.isZero()).to.be.true;
    expect(vestingState.periodFrequency.eq(new BN(1))).to.be.true;
  });

  it("Able to claim fee", async () => {
    const swapParams: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(100),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams);

    const claimParams = {
      owner: user,
      pool,
      position,
    };
    await claimPositionFee(svm, claimParams);
  });

  it("Cliff point", async () => {
    const beforePositionState = getPosition(svm, position);
    await refreshVestings(svm, position, pool, user.publicKey, user, []);
    const afterPositionState = getPosition(svm, position);

    let vestedLiquidityDelta = beforePositionState.vestedLiquidity.sub(
      afterPositionState.vestedLiquidity
    );

    const positionLiquidityDelta = afterPositionState.unlockedLiquidity.sub(
      beforePositionState.unlockedLiquidity
    );

    expect(positionLiquidityDelta.eq(vestedLiquidityDelta)).to.be.true;

    expect(
      vestedLiquidityDelta.eq(
        afterPositionState.innerVesting.cliffUnlockLiquidity
      )
    ).to.be.true;

    vestedLiquidityDelta =
      afterPositionState.innerVesting.totalReleasedLiquidity.sub(
        beforePositionState.innerVesting.totalReleasedLiquidity
      );

    expect(
      vestedLiquidityDelta.eq(
        afterPositionState.innerVesting.cliffUnlockLiquidity
      )
    ).to.be.true;
  });

  it("Withdraw period", async () => {
    for (let i = 0; i < numberOfPeriod; i++) {
      warpSlotBy(svm, periodFrequency);

      const beforePositionState = getPosition(svm, position);

      await refreshVestings(svm, position, pool, user.publicKey, user, []);

      const afterPositionState = getPosition(svm, position);

      expect(
        afterPositionState.unlockedLiquidity.gt(
          beforePositionState.unlockedLiquidity
        )
      ).to.be.true;
    }

    const positionState = getPosition(svm, position);
    expect(positionState.vestedLiquidity.isZero()).to.be.true;
    expect(positionState.unlockedLiquidity.eq(liquidityDelta)).to.be.true;
    expect(positionState.innerVesting.cliffPoint.isZero()).to.be.true;
    expect(positionState.innerVesting.cliffUnlockLiquidity.isZero()).to.be.true;
    expect(positionState.innerVesting.liquidityPerPeriod.isZero()).to.be.true;
    expect(positionState.innerVesting.numberOfPeriod).to.be.equal(0);
    expect(positionState.innerVesting.totalReleasedLiquidity.isZero()).to.be
      .true;
    expect(positionState.innerVesting.periodFrequency.isZero()).to.be.true;
  });
});
