import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  addLiquidity,
  AddLiquidityParams,
  claimProtocolFeeUnchecked,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  encodePermissions,
  expectThrowsErrorCode,
  getPool,
  getTokenBalance,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  startSvm,
  swapExactIn,
  SwapParams,
} from "./helpers";
import {
  generateKpAndFund,
  getCpAmmProgramErrorCode,
  randomID,
} from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { expect } from "chai";

describe("Claim fee unchecked", () => {
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
      BaseFeeMode.FeeTimeSchedulerLinear,
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

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.ClaimProtocolFeeUnchecked,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams,
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
  });

  describe("Fail case", () => {
    it("when operator doesn't have ClaimProtocolFeeUnchecked permission", async () => {
      const unauthorizedOperator = generateKpAndFund(svm);

      await createOperator(svm, {
        admin,
        whitelistAddress: unauthorizedOperator.publicKey,
        permission: encodePermissions([
          OperatorPermission.ClaimProtocolFee, // need ClaimProtocolFeeUnchecked instead of ClaimProtocolFee
        ]),
      });

      const addLiquidityParams: AddLiquidityParams = {
        owner: user,
        pool,
        position,
        liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
        tokenAAmountThreshold: new BN(200),
        tokenBAmountThreshold: new BN(200),
      };
      await addLiquidity(svm, addLiquidityParams);

      // swap to accumulate protocol fees
      const swapParams: SwapParams = {
        payer: user,
        pool,
        inputTokenMint,
        outputTokenMint,
        amountIn: new BN(10000),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      await swapExactIn(svm, swapParams);

      const arbitraryReceiver = generateKpAndFund(svm);
      const errorCode = getCpAmmProgramErrorCode("InvalidPermission");
      const result = await claimProtocolFeeUnchecked(svm, {
        whitelistedKP: unauthorizedOperator,
        pool,
        isTokenA: true,
        destinationOwner: arbitraryReceiver.publicKey,
      });
      expectThrowsErrorCode(result, errorCode);
    });
  });

  describe("Success case", () => {
    it("Claim to arbitrary token account", async () => {
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

      // verify protocol fees are non-zero
      let poolState = getPool(svm, pool);
      const feeA = poolState.protocolAFee;
      const feeB = poolState.protocolBFee;

      expect(feeA.toString()).not.equals("0");
      expect(feeB.toString()).not.equals("0");

      // claim protocol fee to an arbitrary (non-treasury) address
      const arbitraryReceiver = generateKpAndFund(svm);
      const resultA = await claimProtocolFeeUnchecked(svm, {
        whitelistedKP: whitelistedAccount,
        pool,
        isTokenA: true,
        destinationOwner: arbitraryReceiver.publicKey,
      });
      expect(resultA).instanceOf(TransactionMetadata);

      const resultB = await claimProtocolFeeUnchecked(svm, {
        whitelistedKP: whitelistedAccount,
        pool,
        isTokenA: false,
        destinationOwner: arbitraryReceiver.publicKey,
      });
      expect(resultB).instanceOf(TransactionMetadata);

      // verify protocol fees are zeroed out
      poolState = getPool(svm, pool);
      expect(poolState.protocolAFee.isZero()).to.be.true;
      expect(poolState.protocolBFee.isZero()).to.be.true;

      // verify receiver token balances match the claimed fees
      const tokenAProgram = svm.getAccount(poolState.tokenAMint)!.owner;
      const tokenBProgram = svm.getAccount(poolState.tokenBMint)!.owner;
      const receiverTokenA = getAssociatedTokenAddressSync(
        poolState.tokenAMint,
        arbitraryReceiver.publicKey,
        true,
        tokenAProgram,
      );
      const receiverTokenB = getAssociatedTokenAddressSync(
        poolState.tokenBMint,
        arbitraryReceiver.publicKey,
        true,
        tokenBProgram,
      );

      expect(getTokenBalance(svm, receiverTokenA)).to.be.equal(feeA.toString());
      expect(getTokenBalance(svm, receiverTokenB)).to.be.equal(feeB.toString());
    });
  });
});
