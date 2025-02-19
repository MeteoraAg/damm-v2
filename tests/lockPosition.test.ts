import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  expectThrowsAsync,
  setupTestContext,
  setupTokenMint,
  startTest,
  transferSol,
  warpSlotBy,
} from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, wrapSOL } from "./bankrun-utils/token";
import {
  addLiquidity,
  AddLiquidityParams,
  claimPositionFee,
  createConfigIx,
  CreateConfigParams,
  createPosition,
  getPool,
  getPosition,
  getStakeProgramErrorCodeHexString as getProgramErrorCodeHexString,
  initializePool,
  InitializePoolParams,
  LOCK_LP_AMOUNT,
  lockPosition,
  LockPositionParams,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  removeLiquidity,
  swap,
  SwapParams,
} from "./bankrun-utils";
import BN from "bn.js";

describe.only("Lock position", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let user: Keypair;
  let payer: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;
  let inputTokenMint: PublicKey;
  let outputTokenMint: PublicKey;
  const configId = Math.floor(Math.random() * 1000);

  before(async () => {
    context = await startTest();

    const prepareContext = await setupTestContext(
      context.banksClient,
      context.payer
    );
    payer = prepareContext.payer;
    user = prepareContext.user;
    admin = prepareContext.admin;
    inputTokenMint = prepareContext.tokenAMint;
    outputTokenMint = prepareContext.tokenBMint;

    // create config
    const createConfigParams: CreateConfigParams = {
      index: new BN(configId),
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
    sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

    const initPoolParams: InitializePoolParams = {
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
    position = await createPosition(
      context.banksClient,
      payer,
      user.publicKey,
      pool
    );

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(context.banksClient, addLiquidityParams);
  });

  describe("Lock position", () => {
    it("Lock position successfully", async () => {
      const lockPositionParams: LockPositionParams = {
        cliffPoint: null,
        periodFrequency: new BN(5),
        cliffUnlockBps: 5000,
        numberOfPeriod: 10,
        unlockBpsPerPeriod: 5000 / 10,
      };

      const beforePositionState = await getPosition(
        context.banksClient,
        position
      );

      await lockPosition(
        context.banksClient,
        position,
        user,
        user,
        lockPositionParams
      );

      const positionState = await getPosition(context.banksClient, position);
      expect(
        positionState.vestingInfo.lockedLiquidity.eq(
          beforePositionState.liquidity
        )
      ).to.be.true;
      expect(!positionState.vestingInfo.cliffPoint.isZero()).to.be.true;
    });

    it("Cannot withdraw before cliff point", async () => {
      await expectThrowsAsync(async () => {
        await removeLiquidity(context.banksClient, {
          liquidityDelta: new BN(2).pow(new BN(64)).subn(1),
          tokenAAmountThreshold: new BN(0),
          tokenBAmountThreshold: new BN(0),
          position,
          pool,
          owner: user,
        });
      }, getProgramErrorCodeHexString("PositionAlreadyLocked"));
    });

    it("Withdraw after cliff point", async () => {
      await warpSlotBy(context, new BN(1));
      await removeLiquidity(context.banksClient, {
        liquidityDelta: new BN(2).pow(new BN(64)).subn(1),
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
        position,
        pool,
        owner: user,
      });
    });
  });

  //   it("User claim position fee", async () => {

  //     const swapParams: SwapParams = {
  //       payer: user,
  //       pool,
  //       inputTokenMint,
  //       outputTokenMint,
  //       amountIn: new BN(10),
  //       minimumAmountOut: new BN(0),
  //       referralTokenAccount: null,
  //     };

  //     await swap(context.banksClient, swapParams);

  //     // claim position fee
  //     const claimParams = {
  //       owner: user,
  //       pool,
  //       position,
  //     };
  //     await claimPositionFee(context.banksClient, claimParams);
  //   });
});
