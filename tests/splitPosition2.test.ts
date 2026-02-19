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
  expectThrowsErrorCode,
  getCpAmmProgramErrorCode,
  getPool,
  getPosition,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  permanentLockPosition,
  SPLIT_POSITION_DENOMINATOR,
  splitPosition2,
  startSvm,
  swapExactIn,
  U64_MAX,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

describe("Split position 2", () => {
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

  it("Cannot split two same position", async () => {
    const positionState = getPosition(svm, position);

    const numerator = SPLIT_POSITION_DENOMINATOR / 2;

    const errorCode = getCpAmmProgramErrorCode("SamePosition");
    const res = await splitPosition2(svm, {
      firstPositionOwner: creator,
      secondPositionOwner: creator,
      pool,
      firstPosition: position,
      secondPosition: position,
      firstPositionNftAccount: derivePositionNftAccount(positionState.nftMint),
      secondPositionNftAccount: derivePositionNftAccount(positionState.nftMint),
      numerator,
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
    const positionState = await getPosition(svm, position);
    const secondPositionState = await getPosition(svm, secondPosition);

    const numerator = 0;

    const errorCode = getCpAmmProgramErrorCode(
      "InvalidSplitPositionParameters"
    );

    const res = await splitPosition2(svm, {
      firstPositionOwner: creator,
      secondPositionOwner: user,
      pool,
      firstPosition: position,
      secondPosition,
      firstPositionNftAccount: derivePositionNftAccount(positionState.nftMint),
      secondPositionNftAccount: derivePositionNftAccount(
        secondPositionState.nftMint
      ),
      numerator,
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
    const firstPositionState = getPosition(svm, position);

    const numerator = SPLIT_POSITION_DENOMINATOR / 2;

    const newLiquidityDelta = firstPositionState.unlockedLiquidity
      .mul(new BN(numerator))
      .div(new BN(SPLIT_POSITION_DENOMINATOR));

    let secondPositionState = getPosition(svm, secondPosition);
    let poolState = getPool(svm, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity = secondPositionState.unlockedLiquidity;

    await splitPosition2(svm, {
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

    poolState = getPool(svm, pool);
    secondPositionState = getPosition(svm, secondPosition);

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
    const firstPositionState = getPosition(svm, position);
    const numerator = SPLIT_POSITION_DENOMINATOR / 2;

    const permanentLockedLiquidityDelta =
      firstPositionState.permanentLockedLiquidity
        .mul(new BN(numerator))
        .div(new BN(SPLIT_POSITION_DENOMINATOR));
    let secondPositionState = getPosition(svm, secondPosition);
    let poolState = getPool(svm, pool);
    const beforeLiquidity = poolState.liquidity;

    const beforeSecondPositionLiquidity =
      secondPositionState.permanentLockedLiquidity;

    await splitPosition2(svm, {
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

    poolState = getPool(svm, pool);
    secondPositionState = getPosition(svm, secondPosition);

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

    expect(
      afterSecondPositionState.unlockedLiquidity
        .sub(beforeSecondPositionState.unlockedLiquidity)
        .toString()
    ).eq(beforeFirstPositionState.unlockedLiquidity.toString());
    expect(
      afterSecondPositionState.permanentLockedLiquidity
        .sub(beforeSecondPositionState.permanentLockedLiquidity)
        .toString()
    ).eq(beforeFirstPositionState.permanentLockedLiquidity.toString());
    expect(
      afterSecondPositionState.feeAPending
        .sub(beforeSecondPositionState.feeAPending)
        .toString()
    ).eq(beforeFirstPositionState.feeAPending.toString());
    expect(
      afterSecondPositionState.feeBPending
        .sub(beforeSecondPositionState.feeBPending)
        .toString()
    ).eq(beforeFirstPositionState.feeBPending.toString());
  });
});
