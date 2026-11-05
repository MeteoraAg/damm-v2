import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { TransactionMetadata } from "litesvm";
import { LiteSVM } from "./helpers/litesvmCompat";
import {
  addLiquidity,
  claimPositionFee,
  claimReward,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  createTokenBadge,
  deriveOperatorAddress,
  encodePermissions,
  expectThrowsErrorCode,
  fundReward,
  getCpAmmProgramErrorCode,
  getPool,
  initializePool,
  InitializePoolParams,
  initializeReward,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OFFSET,
  OperatorPermission,
  removeAllLiquidity,
  startSvm,
  swap2ExactIn,
  U64_MAX,
  warpToTimestamp,
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  createPermissionedBurnExtensionWithInstruction,
  createToken2022,
  mintToToken2022,
} from "./helpers/token2022";

const invalidTokenBadge = getCpAmmProgramErrorCode("InvalidTokenBadge");

describe("Pool with permissioned burn extension", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let user: Keypair;
  let funder: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;

  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    user = generateKpAndFund(svm);
    funder = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    tokenAMint = tokenAMintKeypair.publicKey;
    createToken2022(
      svm,
      [
        createPermissionedBurnExtensionWithInstruction(
          tokenAMint,
          Keypair.generate().publicKey
        ),
      ],
      tokenAMintKeypair,
      admin.publicKey
    );
    tokenBMint = createToken(svm, admin.publicKey);

    await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);
    await mintToToken2022(svm, tokenAMint, admin, user.publicKey);
    await mintToToken2022(svm, tokenAMint, admin, funder.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([
        OperatorPermission.CreateConfigKey,
        OperatorPermission.CreateTokenBadge,
        OperatorPermission.InitializeReward,
      ]),
    });

    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
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
    config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );
  });

  function initPoolParams(): InitializePoolParams {
    return {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(1).shln(OFFSET),
      activationPoint: null,
    };
  }

  it("Cannot create pool without token badge", async () => {
    const { result } = await initializePool(svm, initPoolParams());
    expectThrowsErrorCode(result, invalidTokenBadge);
  });

  it("Full flow with token badge", async () => {
    await createTokenBadge(svm, {
      tokenMint: tokenAMint,
      whitelistedAddress: whitelistedAccount,
    });

    const { pool, result } = await initializePool(svm, initPoolParams());
    expect(result).instanceOf(TransactionMetadata);

    const position = await createPosition(svm, user, user.publicKey, pool);
    await addLiquidity(svm, {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(MIN_LP_AMOUNT),
      tokenAAmountThreshold: U64_MAX,
      tokenBAmountThreshold: U64_MAX,
    });

    const index = 0;
    const initRewardResult = await initializeReward(svm, {
      index,
      payer: whitelistedAccount,
      rewardDuration: new BN(24 * 60 * 60),
      pool,
      rewardMint: tokenAMint,
      funder: funder.publicKey,
      operator: deriveOperatorAddress(whitelistedAccount.publicKey),
    });
    expect(initRewardResult).instanceOf(TransactionMetadata);
    await fundReward(svm, {
      index,
      funder,
      pool,
      carryForward: true,
      amount: new BN(100),
    });

    await swap2ExactIn(svm, {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amount0: new BN(10),
      amount1: new BN(0),
      referralTokenAccount: null,
    });
    await swap2ExactIn(svm, {
      payer: user,
      pool,
      inputTokenMint: tokenBMint,
      outputTokenMint: tokenAMint,
      amount0: new BN(10),
      amount1: new BN(0),
      referralTokenAccount: null,
    });

    await claimPositionFee(svm, { owner: user, pool, position });

    const currentClock = svm.getClock();
    warpToTimestamp(svm, new BN(Number(currentClock.unixTimestamp) + 3600));
    const claimRewardResult = await claimReward(svm, {
      index,
      user,
      pool,
      position,
      skipReward: 0,
    });
    expect(claimRewardResult).instanceOf(TransactionMetadata);

    await removeAllLiquidity(svm, {
      owner: user,
      pool,
      position,
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    });
    expect(getPool(svm, pool).liquidity.toString()).eq(
      MIN_LP_AMOUNT.toString()
    );
  });
});
