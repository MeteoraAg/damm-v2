import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  ANCHOR_CONSTRAINT_ACCOUNT_ERROR_CODE,
  claimProtocolFee2,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  expectThrowsErrorCode,
  AddLiquidityParams,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  startSvm,
  SwapParams,
  addLiquidity,
  swapExactIn,
  getPool,
  getOrCreateAssociatedTokenAccount,
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";
import { expect } from "chai";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("Claim Protocol Fee 2", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;
  let inputTokenMint: PublicKey;
  let outputTokenMint: PublicKey;
  let creator: Keypair;

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    inputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);
    outputTokenMint = createToken(svm, admin.publicKey, admin.publicKey);

    mintSplTokenTo(svm, inputTokenMint, admin, user.publicKey);
    mintSplTokenTo(svm, outputTokenMint, admin, user.publicKey);
    mintSplTokenTo(svm, inputTokenMint, admin, creator.publicKey);
    mintSplTokenTo(svm, outputTokenMint, admin, creator.publicKey);

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
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: creator.publicKey,
      activationType: 0,
      collectFeeMode: 0,
    };

    const fullPermission = encodePermissions(
      Object.values(OperatorPermission).filter((v) => typeof v === "number")
    );

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: fullPermission,
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint: inputTokenMint,
      tokenBMint: outputTokenMint,
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
      liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(svm, addLiquidityParams);

    // swap in both directions to accumulate protocol fees
    const swapA2B: SwapParams = {
      payer: user,
      pool,
      inputTokenMint,
      outputTokenMint,
      amountIn: new BN(10000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    const swapB2A: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: outputTokenMint,
      outputTokenMint: inputTokenMint,
      amountIn: new BN(10000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapA2B);
    await swapExactIn(svm, swapB2A);
    await swapExactIn(svm, swapA2B);
    await swapExactIn(svm, swapB2A);

    const poolState = getPool(svm, pool);
    const feeA = poolState.protocolAFee;
    const feeB = poolState.protocolBFee;

    expect(feeA.toString()).not.equals("0");
    expect(feeB.toString()).not.equals("0");
  });

  describe("Fail case", () => {
    it("rejects when signed by full permission operator", async () => {
      const receiverTokenAccount = getOrCreateAssociatedTokenAccount(
        svm,
        whitelistedAccount,
        inputTokenMint,
        admin.publicKey,
        TOKEN_PROGRAM_ID
      );

      const result = await claimProtocolFee2(svm, {
        signerKP: whitelistedAccount,
        pool,
        isTokenA: true,
        receiverTokenAccount,
      });
      expectThrowsErrorCode(result, ANCHOR_CONSTRAINT_ACCOUNT_ERROR_CODE);
    });

    it("rejects when signed by admin", async () => {
      const receiverTokenAccount = getOrCreateAssociatedTokenAccount(
        svm,
        admin,
        inputTokenMint,
        admin.publicKey,
        TOKEN_PROGRAM_ID
      );

      const result = await claimProtocolFee2(svm, {
        signerKP: admin,
        pool,
        isTokenA: true,
        receiverTokenAccount,
      });
      expectThrowsErrorCode(result, ANCHOR_CONSTRAINT_ACCOUNT_ERROR_CODE);
    });
  });
});
