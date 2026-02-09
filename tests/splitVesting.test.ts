import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  addLiquidity,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  derivePositionNftAccount,
  encodePermissions,
  getPosition,
  initializePool,
  InitializePoolParams,
  lockPosition,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  refreshVestings,
  SPLIT_POSITION_DENOMINATOR,
  splitPosition2,
  startSvm,
  U64_MAX,
  warpSlotBy,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

describe("Split vesting", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
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
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);
    user = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);
    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    // create config
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

  it("Split position", async () => {
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

    const positionState = getPosition(svm, firstPosition);
    const lockLiquidity = positionState.unlockedLiquidity.divn(2);

    const numberOfPeriod = 10;
    const periodFrequency = new BN(1);

    let cliffUnlockLiquidity = lockLiquidity.divn(2);

    const liquidityPerPeriod = lockLiquidity
      .sub(cliffUnlockLiquidity)
      .divn(numberOfPeriod);

    cliffUnlockLiquidity = lockLiquidity.sub(
      liquidityPerPeriod.muln(numberOfPeriod)
    );

    await lockPosition(
      svm,
      firstPosition,
      creator,
      creator,
      {
        cliffPoint: new BN(1),
        cliffUnlockLiquidity,
        liquidityPerPeriod,
        numberOfPeriod,
        periodFrequency,
      },
      true
    );

    const secondPosition = await createPosition(
      svm,
      user,
      user.publicKey,
      pool
    );
    const beforeFirstPositionState = getPosition(svm, firstPosition);
    const beforeSecondPositionState = getPosition(svm, secondPosition);

    await splitPosition2(svm, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(
        beforeFirstPositionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        beforeSecondPositionState.nftMint
      ),
      numerator: SPLIT_POSITION_DENOMINATOR / 2,
    });

    const afterFirstPositionState = getPosition(svm, firstPosition);
    const afterSecondPositionState = getPosition(svm, secondPosition);

    expect(afterSecondPositionState.unlockedLiquidity.toString()).eq(
      beforeFirstPositionState.unlockedLiquidity
        .sub(afterFirstPositionState.unlockedLiquidity)
        .toString()
    );

    expect(afterSecondPositionState.vestedLiquidity.toString()).eq(
      beforeFirstPositionState.vestedLiquidity
        .sub(afterFirstPositionState.vestedLiquidity)
        .toString()
    );

    warpSlotBy(svm, new BN(numberOfPeriod + 1));

    await refreshVestings(svm, secondPosition, pool, user.publicKey, user, []);
    await refreshVestings(
      svm,
      firstPosition,
      pool,
      creator.publicKey,
      creator,
      []
    );

    const finalFirstPositionState = getPosition(svm, firstPosition);
    const finalSecondPositionState = getPosition(svm, secondPosition);

    expect(finalFirstPositionState.vestedLiquidity.isZero()).to.be.true;
    expect(finalSecondPositionState.vestedLiquidity.isZero()).to.be.true;

    expect(
      finalSecondPositionState.unlockedLiquidity
        .add(finalFirstPositionState.unlockedLiquidity)
        .eq(positionState.unlockedLiquidity)
    ).to.be.true;
  });

  it("Merge position", async () => {
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

    const positionState = getPosition(svm, firstPosition);
    const lockLiquidity = positionState.unlockedLiquidity.divn(2);

    const numberOfPeriod = 10;
    const periodFrequency = new BN(1);

    let cliffUnlockLiquidity = lockLiquidity.divn(2);

    const liquidityPerPeriod = lockLiquidity
      .sub(cliffUnlockLiquidity)
      .divn(numberOfPeriod);

    cliffUnlockLiquidity = lockLiquidity.sub(
      liquidityPerPeriod.muln(numberOfPeriod)
    );

    await lockPosition(
      svm,
      firstPosition,
      creator,
      creator,
      {
        cliffPoint: new BN(1),
        cliffUnlockLiquidity,
        liquidityPerPeriod,
        numberOfPeriod,
        periodFrequency,
      },
      true
    );

    const secondPosition = await createPosition(
      svm,
      user,
      user.publicKey,
      pool
    );
    const beforeFirstPositionState = getPosition(svm, firstPosition);
    const beforeSecondPositionState = getPosition(svm, secondPosition);

    await splitPosition2(svm, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(
        beforeFirstPositionState.nftMint
      ),
      secondPositionNftAccount: derivePositionNftAccount(
        beforeSecondPositionState.nftMint
      ),
      numerator: SPLIT_POSITION_DENOMINATOR,
    });

    const afterFirstPositionState = getPosition(svm, firstPosition);
    const afterSecondPositionState = getPosition(svm, secondPosition);

    expect(afterFirstPositionState.unlockedLiquidity.toNumber()).eq(0);
    expect(afterFirstPositionState.permanentLockedLiquidity.toNumber()).eq(0);
    expect(afterFirstPositionState.feeAPending.toNumber()).eq(0);
    expect(afterFirstPositionState.feeBPending.toNumber()).eq(0);

    expect(afterSecondPositionState.unlockedLiquidity.toString()).eq(
      beforeFirstPositionState.unlockedLiquidity.toString()
    );
    expect(afterSecondPositionState.permanentLockedLiquidity.toString()).eq(
      beforeFirstPositionState.permanentLockedLiquidity.toString()
    );
    expect(afterSecondPositionState.feeAPending.toString()).eq(
      beforeFirstPositionState.feeAPending.toString()
    );
    expect(afterSecondPositionState.feeBPending.toString()).eq(
      beforeFirstPositionState.feeBPending.toString()
    );

    expect(afterSecondPositionState.vestedLiquidity.toString()).eq(
      beforeFirstPositionState.vestedLiquidity.toString()
    );

    expect(afterFirstPositionState.innerVesting.cliffUnlockLiquidity.isZero())
      .to.be.true;
    expect(afterFirstPositionState.innerVesting.totalReleasedLiquidity.isZero())
      .to.be.true;
    expect(afterFirstPositionState.innerVesting.cliffPoint.isZero()).to.be.true;
    expect(afterFirstPositionState.innerVesting.liquidityPerPeriod.isZero()).to
      .be.true;
    expect(afterFirstPositionState.innerVesting.numberOfPeriod).to.be.equal(0);
    expect(afterFirstPositionState.innerVesting.periodFrequency.isZero()).to.be
      .true;

    expect(
      afterSecondPositionState.innerVesting.cliffUnlockLiquidity.eq(
        beforeFirstPositionState.innerVesting.cliffUnlockLiquidity
      )
    ).to.be.true;
    expect(
      afterSecondPositionState.innerVesting.totalReleasedLiquidity.eq(
        beforeFirstPositionState.innerVesting.totalReleasedLiquidity
      )
    ).to.be.true;
    expect(
      afterSecondPositionState.innerVesting.cliffPoint.eq(
        beforeFirstPositionState.innerVesting.cliffPoint
      )
    ).to.be.true;
    expect(
      afterSecondPositionState.innerVesting.liquidityPerPeriod.eq(
        beforeFirstPositionState.innerVesting.liquidityPerPeriod
      )
    ).to.be.true;
    expect(afterSecondPositionState.innerVesting.numberOfPeriod).equal(
      beforeFirstPositionState.innerVesting.numberOfPeriod
    );
    expect(
      afterSecondPositionState.innerVesting.periodFrequency.eq(
        beforeFirstPositionState.innerVesting.periodFrequency
      )
    ).to.be.true;

    warpSlotBy(svm, new BN(numberOfPeriod + 1));

    await refreshVestings(svm, secondPosition, pool, user.publicKey, user, []);

    const finalSecondPositionState = getPosition(svm, secondPosition);
    expect(finalSecondPositionState.vestedLiquidity.isZero()).to.be.true;
    expect(
      finalSecondPositionState.unlockedLiquidity.eq(
        positionState.unlockedLiquidity
      )
    ).to.be.true;
  });
});
