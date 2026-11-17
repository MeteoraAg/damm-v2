import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import {
  ActionGroup,
  addLiquidity,
  claimPositionFee,
  claimReward,
  closePosition,
  createDynamicConfigIx,
  initializeCustomizablePool,
  initializePoolWithCustomizeConfig,
  initializeReward,
  removeAllLiquidity,
  setPoolStatus,
  deriveOperatorAddress,
  derivePositionNftAccount,
  encodeDelegatePermissions,
  fundReward,
  getPool,
  getPosition,
  getVesting,
  lockPosition,
  permanentLockPosition,
  PositionDelegatePermission,
  refreshVestings,
  SPLIT_POSITION_DENOMINATOR,
  splitPosition,
  splitPosition2,
  updateDelegatePermission,
  updateRewardDuration,
  updateRewardFunder,
  warpSlotBy,
  warpToTimestamp,
  withoutCircuitBreakerAccount,
  swap2ExactIn,
  swap2ExactOut,
  swap2PartialFillIn,
  withdrawDeadLiquidityReward,
  withdrawIneligibleReward,
  CP_AMM_PROGRAM_ID,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createPosition,
  createToken,
  derivePoolAuthority,
  encodeActionGroups,
  encodePermissions,
  expectThrowsErrorCode,
  getCircuitBreaker,
  getCpAmmProgramErrorCode,
  initializeCircuitBreaker,
  initializePool,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  parseEventInstruction,
  removeLiquidity,
  sendTransaction,
  setCircuitBreaker,
  setCircuitBreakerTransaction,
  startSvm,
  swapExactIn,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "./helpers/litesvmCompat";

const ANCHOR_ACCOUNT_OWNED_BY_WRONG_PROGRAM = 3007;

describe("Circuit breaker", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let creator: Keypair;
  // operator with the CircuitBreaker permission
  let operator: Keypair;
  // operator without the CircuitBreaker permission
  let otherOperator: Keypair;
  let config: PublicKey;
  let pool: PublicKey;
  let position: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let liquidityDelta: BN;

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    operator = generateKpAndFund(svm);
    otherOperator = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);
    for (const mint of [tokenAMint, tokenBMint]) {
      mintSplTokenTo(svm, mint, admin, user.publicKey);
      mintSplTokenTo(svm, mint, admin, creator.publicKey);
    }

    await createOperator(svm, {
      admin,
      whitelistAddress: operator.publicKey,
      permission: encodePermissions([
        OperatorPermission.CircuitBreaker,
        OperatorPermission.CreateConfigKey,
        OperatorPermission.SetPoolStatus,
        OperatorPermission.UpdateRewardFunder,
        OperatorPermission.UpdateRewardDuration,
      ]),
    });
    await createOperator(svm, {
      admin,
      whitelistAddress: otherOperator.publicKey,
      permission: encodePermissions([OperatorPermission.SetPoolStatus]),
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
    config = await createConfigIx(svm, operator, new BN(1), createConfigParams);

    const sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));
    liquidityDelta = new BN(sqrtPrice.mul(new BN(1_000)));
    const result = await initializePool(svm, {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice,
      activationPoint: null,
    });
    pool = result.pool;
    position = await createPosition(svm, user, user.publicKey, pool);
    await addLiquidity(svm, {
      owner: user,
      pool,
      position,
      liquidityDelta,
      tokenAAmountThreshold: new BN(2_000_000_000),
      tokenBAmountThreshold: new BN(2_000_000_000),
    });
  });

  async function swap() {
    await swapExactIn(svm, {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });
  }

  async function removeSomeLiquidity() {
    await removeLiquidity(svm, {
      owner: user,
      pool,
      position,
      liquidityDelta: liquidityDelta.divn(10),
      tokenAAmountThreshold: new BN(0),
      tokenBAmountThreshold: new BN(0),
    });
  }

  async function disable(actions: ActionGroup[]) {
    const result = await setCircuitBreaker(svm, {
      whitelistedAddress: operator,
      disabledActions: encodeActionGroups(actions),
      expectedNonce: getCircuitBreaker(svm).nonce,
    });
    expect(result).instanceOf(TransactionMetadata);
    return result as TransactionMetadata;
  }

  describe("initialize_circuit_breaker", () => {
    it("turns the pool authority into a circuit breaker with every action enabled", async () => {
      const poolAuthority = derivePoolAuthority();
      expect(svm.getAccount(poolAuthority)).to.be.null;

      const result = await initializeCircuitBreaker(svm, operator);
      expect(result).instanceOf(TransactionMetadata);

      expect(
        new PublicKey(svm.getAccount(poolAuthority)!.owner).equals(
          CP_AMM_PROGRAM_ID
        )
      ).to.be.true;
      const circuitBreaker = getCircuitBreaker(svm);
      expect(circuitBreaker.disabledActions.isZero()).to.be.true;
      expect(circuitBreaker.nonce.isZero()).to.be.true;
    });

    it("works when the pool authority already holds lamports", async () => {
      const poolAuthority = derivePoolAuthority();
      svm.setAccount(poolAuthority, {
        data: new Uint8Array(),
        executable: false,
        lamports: 180_000_000_000,
        owner: SystemProgram.programId,
      });

      const result = await initializeCircuitBreaker(svm, operator);
      expect(result).instanceOf(TransactionMetadata);
      expect(Number(svm.getAccount(poolAuthority)!.lamports)).eq(
        180_000_000_000
      );
      expect(getCircuitBreaker(svm).disabledActions.isZero()).to.be.true;
    });

    it("fails for an operator without the CircuitBreaker permission", async () => {
      const result = await initializeCircuitBreaker(svm, otherOperator);
      expectThrowsErrorCode(
        result,
        getCpAmmProgramErrorCode("InvalidPermission")
      );
    });

    it("fails the second time", async () => {
      expect(await initializeCircuitBreaker(svm, operator)).instanceOf(
        TransactionMetadata
      );
      expect(await initializeCircuitBreaker(svm, operator)).instanceOf(
        FailedTransactionMetadata
      );
    });

    it("the pool authority still signs transfers once initialized", async () => {
      expect(await initializeCircuitBreaker(svm, operator)).instanceOf(
        TransactionMetadata
      );
      await swap();
      await removeSomeLiquidity();
    });
  });

  describe("set_circuit_breaker", () => {
    it("fails before the circuit breaker is initialized", async () => {
      const result = await setCircuitBreaker(svm, {
        whitelistedAddress: operator,
        disabledActions: encodeActionGroups([ActionGroup.Swap]),
        expectedNonce: new BN(0),
      });
      expectThrowsErrorCode(result, ANCHOR_ACCOUNT_OWNED_BY_WRONG_PROGRAM);
    });

    describe("once initialized", () => {
      beforeEach(async () => {
        expect(await initializeCircuitBreaker(svm, operator)).instanceOf(
          TransactionMetadata
        );
      });

      it("replaces the bitmask, increments the nonce and emits an event", async () => {
        const disabledActions = encodeActionGroups([
          ActionGroup.Swap,
          ActionGroup.CreatePool,
        ]);
        const result = await disable([
          ActionGroup.Swap,
          ActionGroup.CreatePool,
        ]);

        let circuitBreaker = getCircuitBreaker(svm);
        expect(circuitBreaker.disabledActions.eq(disabledActions)).to.be.true;
        expect(circuitBreaker.nonce.eqn(1)).to.be.true;

        const event = parseEventInstruction(
          result,
          "evtSetCircuitBreaker"
        )!.data;
        expect(event.signer.equals(operator.publicKey)).to.be.true;
        expect(event.oldDisabledActions.isZero()).to.be.true;
        expect(event.disabledActions.eq(disabledActions)).to.be.true;
        expect(event.nonce.eqn(1)).to.be.true;

        await disable([ActionGroup.RemoveLiquidity]);
        circuitBreaker = getCircuitBreaker(svm);
        expect(
          circuitBreaker.disabledActions.eq(
            encodeActionGroups([ActionGroup.RemoveLiquidity])
          )
        ).to.be.true;
        expect(circuitBreaker.nonce.eqn(2)).to.be.true;
      });

      it("fails for an operator without the CircuitBreaker permission", async () => {
        const result = await setCircuitBreaker(svm, {
          whitelistedAddress: otherOperator,
          disabledActions: encodeActionGroups([ActionGroup.Swap]),
          expectedNonce: new BN(0),
        });
        expectThrowsErrorCode(
          result,
          getCpAmmProgramErrorCode("InvalidPermission")
        );
      });

      it("a transaction built before another update fails", async () => {
        const staleTransaction = await setCircuitBreakerTransaction({
          whitelistedAddress: operator,
          disabledActions: encodeActionGroups([ActionGroup.AddLiquidity]),
          expectedNonce: new BN(0),
        });
        await disable([ActionGroup.Swap]);

        const result = sendTransaction(svm, staleTransaction, [operator]);
        expectThrowsErrorCode(
          result,
          getCpAmmProgramErrorCode("UnexpectedCircuitBreakerState")
        );
      });

      it("a stale transaction fails even when the bitmask went back to the value it was built from", async () => {
        const staleTransaction = await setCircuitBreakerTransaction({
          whitelistedAddress: operator,
          disabledActions: encodeActionGroups([ActionGroup.AddLiquidity]),
          expectedNonce: new BN(0),
        });
        await disable([ActionGroup.Swap]);
        await disable([]);
        expect(getCircuitBreaker(svm).disabledActions.isZero()).to.be.true;

        const result = sendTransaction(svm, staleTransaction, [operator]);
        expectThrowsErrorCode(
          result,
          getCpAmmProgramErrorCode("UnexpectedCircuitBreakerState")
        );
      });

      it("rejects an unchanged bitmask", async () => {
        const result = await setCircuitBreaker(svm, {
          whitelistedAddress: operator,
          disabledActions: new BN(0),
          expectedNonce: new BN(0),
        });
        expectThrowsErrorCode(
          result,
          getCpAmmProgramErrorCode("InvalidParameters")
        );
      });

      it("rejects a bit above the last action group", async () => {
        const result = await setCircuitBreaker(svm, {
          whitelistedAddress: operator,
          disabledActions: new BN(1).shln(ActionGroup.CreatePool + 1),
          expectedNonce: new BN(0),
        });
        expectThrowsErrorCode(
          result,
          getCpAmmProgramErrorCode("InvalidParameters")
        );
      });
    });
  });

  // Runs `action` and expects its transaction to fail with `errorName`. Most helpers assert
  // success themselves and don't return the result, so the result is read from the svm instead
  async function expectActionDisabled(
    action: () => Promise<unknown>,
    errorName = "ActionDisabled"
  ) {
    const send = svm.sendTransaction.bind(svm);
    let failure: FailedTransactionMetadata | undefined;
    (svm as any).sendTransaction = (transaction: any) => {
      const result = send(transaction);
      if (
        failure === undefined &&
        result instanceof FailedTransactionMetadata
      ) {
        failure = result;
      }
      return result;
    };
    try {
      await action();
    } catch (_) {
      // the helper asserted success
    } finally {
      (svm as any).sendTransaction = send;
    }
    expect(failure, "the transaction didn't fail").not.to.be.undefined;
    expectThrowsErrorCode(failure!, getCpAmmProgramErrorCode(errorName));
  }

  function baseFeeData() {
    return Array.from(
      encodeFeeTimeSchedulerParams(
        BigInt(2_500_000),
        0,
        BigInt(0),
        BigInt(0),
        BaseFeeMode.FeeTimeSchedulerLinear
      )
    );
  }

  function createFundedMint() {
    const mint = createToken(svm, admin.publicKey, admin.publicKey);
    mintSplTokenTo(svm, mint, admin, creator.publicKey);
    return mint;
  }

  describe("endpoints that take the pool authority", () => {
    let rewardMint: PublicKey;
    let dynamicConfig: PublicKey;

    beforeEach(async () => {
      rewardMint = createFundedMint();
      expect(
        await initializeReward(svm, {
          index: 0,
          payer: creator,
          rewardDuration: new BN(24 * 60 * 60),
          pool,
          rewardMint,
          funder: creator.publicKey,
        })
      ).instanceOf(TransactionMetadata);
      dynamicConfig = await createDynamicConfigIx(svm, operator, new BN(2), {
        poolCreatorAuthority: creator.publicKey,
      });
      expect(await initializeCircuitBreaker(svm, operator)).instanceOf(
        TransactionMetadata
      );
    });

    const customizablePoolParams = () => ({
      payer: creator,
      creator: creator.publicKey,
      tokenAMint: createFundedMint(),
      tokenBMint: createFundedMint(),
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: {
          data: baseFeeData(),
        },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    });

    const endpoints: [ActionGroup, string, () => Promise<unknown>][] = [
      [
        ActionGroup.AddLiquidity,
        "create_position",
        () => createPosition(svm, user, user.publicKey, pool),
      ],
      [ActionGroup.RemoveLiquidity, "remove_liquidity", removeSomeLiquidity],
      [
        ActionGroup.RemoveLiquidity,
        "remove_all_liquidity",
        () =>
          removeAllLiquidity(svm, {
            owner: user,
            pool,
            position,
            tokenAAmountThreshold: new BN(0),
            tokenBAmountThreshold: new BN(0),
          }),
      ],
      [
        ActionGroup.ClaimFee,
        "claim_position_fee",
        () => claimPositionFee(svm, { owner: user, pool, position }),
      ],
      [
        ActionGroup.ClaimReward,
        "claim_reward",
        () =>
          claimReward(svm, {
            index: 0,
            user,
            position,
            pool,
            skipReward: 0,
          }),
      ],
      [
        ActionGroup.ClaimReward,
        "withdraw_ineligible_reward",
        () =>
          withdrawIneligibleReward(svm, { index: 0, pool, funder: creator }),
      ],
      [
        ActionGroup.ClaimReward,
        "withdraw_dead_liquidity_reward",
        () =>
          withdrawDeadLiquidityReward(svm, { index: 0, pool, funder: creator }),
      ],
      [
        ActionGroup.PositionManagement,
        "close_position",
        () => closePosition(svm, { owner: user, pool, position }),
      ],
      [
        ActionGroup.RewardManagement,
        "initialize_reward",
        () =>
          initializeReward(svm, {
            index: 1,
            payer: creator,
            rewardDuration: new BN(24 * 60 * 60),
            pool,
            rewardMint: createFundedMint(),
            funder: creator.publicKey,
          }),
      ],
      [
        ActionGroup.CreatePool,
        "initialize_pool",
        () =>
          initializePool(svm, {
            payer: creator,
            creator: creator.publicKey,
            config,
            tokenAMint: createFundedMint(),
            tokenBMint: createFundedMint(),
            liquidity: new BN(MIN_LP_AMOUNT),
            sqrtPrice: new BN(MIN_SQRT_PRICE),
            activationPoint: null,
          }),
      ],
      [
        ActionGroup.CreatePool,
        "initialize_pool_with_dynamic_config",
        () =>
          initializePoolWithCustomizeConfig(svm, {
            ...customizablePoolParams(),
            poolCreatorAuthority: creator,
            customizeConfigAddress: dynamicConfig,
          }),
      ],
      [
        ActionGroup.CreatePool,
        "initialize_customizable_pool",
        () => initializeCustomizablePool(svm, customizablePoolParams()),
      ],
    ];

    for (const [group, name, call] of endpoints) {
      it(`${name} fails while ${ActionGroup[group]} is disabled`, async () => {
        await disable([group]);
        await expectActionDisabled(call);
      });
    }

    const swap2Params = () => ({
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      referralTokenAccount: null,
    });
    const swaps: [string, () => Promise<unknown>][] = [
      ["swap", swap],
      [
        "swap2 exact in",
        () =>
          swap2ExactIn(svm, {
            ...swap2Params(),
            amount0: new BN(10),
            amount1: new BN(0),
          }),
      ],
      [
        "swap2 partial fill",
        () =>
          swap2PartialFillIn(svm, {
            ...swap2Params(),
            amount0: new BN(10),
            amount1: new BN(0),
          }),
      ],
      [
        "swap2 exact out",
        () =>
          swap2ExactOut(svm, {
            ...swap2Params(),
            inputTokenMint: tokenBMint,
            outputTokenMint: tokenAMint,
            amount0: new BN(10),
            amount1: new BN(1_000_000),
          }),
      ],
    ];

    for (const [name, call] of swaps) {
      it(`${name} fails while Swap is disabled and works once re-enabled`, async () => {
        await call();

        await disable([ActionGroup.Swap]);
        await expectActionDisabled(call);

        await disable([]);
        await call();
      });
    }

    it("swap works while every other group is disabled", async () => {
      await disable([
        ActionGroup.AddLiquidity,
        ActionGroup.RemoveLiquidity,
        ActionGroup.ClaimFee,
        ActionGroup.ClaimReward,
        ActionGroup.PositionManagement,
        ActionGroup.RewardManagement,
        ActionGroup.CreatePool,
      ]);
      await swap();
    });

    it("a disabled group leaves the other groups enabled", async () => {
      await disable([ActionGroup.AddLiquidity, ActionGroup.CreatePool]);
      await removeSomeLiquidity();
      await claimPositionFee(svm, { owner: user, pool, position });
    });

    it("re-enabling a group restores its endpoints", async () => {
      await disable([ActionGroup.RemoveLiquidity, ActionGroup.AddLiquidity]);
      await expectActionDisabled(removeSomeLiquidity);

      await disable([]);
      await removeSomeLiquidity();
      await createPosition(svm, user, user.publicKey, pool);
    });

    it("operator endpoints work while every group is disabled", async () => {
      await disable([
        ActionGroup.Swap,
        ActionGroup.AddLiquidity,
        ActionGroup.RemoveLiquidity,
        ActionGroup.ClaimFee,
        ActionGroup.ClaimReward,
        ActionGroup.PositionManagement,
        ActionGroup.RewardManagement,
        ActionGroup.CreatePool,
      ]);
      await setPoolStatus(svm, {
        whitelistedAddress: otherOperator,
        pool,
        status: 1,
      });
    });
  });

  describe("endpoints that take the pool authority as the last remaining account", () => {
    let rewardMint: PublicKey;
    let secondPosition: PublicKey;

    beforeEach(async () => {
      rewardMint = createFundedMint();
      expect(
        await initializeReward(svm, {
          index: 0,
          payer: creator,
          rewardDuration: new BN(24 * 60 * 60),
          pool,
          rewardMint,
          funder: creator.publicKey,
        })
      ).instanceOf(TransactionMetadata);
      secondPosition = await createPosition(svm, user, user.publicKey, pool);
      // update_reward_duration requires the current time to be past the end of the campaign,
      // which is zero for a reward that was never funded
      warpToTimestamp(svm, new BN(1));
      expect(await initializeCircuitBreaker(svm, operator)).instanceOf(
        TransactionMetadata
      );
    });

    const vestingParams = () => ({
      cliffPoint: null,
      periodFrequency: new BN(1),
      cliffUnlockLiquidity: new BN(100),
      liquidityPerPeriod: new BN(100),
      numberOfPeriod: 10,
    });

    const splitAccounts = () => ({
      firstPositionOwner: user,
      secondPositionOwner: user,
      pool,
      firstPosition: position,
      firstPositionNftAccount: derivePositionNftAccount(
        getPosition(svm, position).nftMint
      ),
      secondPosition,
      secondPositionNftAccount: derivePositionNftAccount(
        getPosition(svm, secondPosition).nftMint
      ),
    });

    async function expectSuccess(
      call: () => Promise<TransactionMetadata | FailedTransactionMetadata>
    ) {
      expect(await call()).instanceOf(TransactionMetadata);
    }

    const endpoints: [ActionGroup, string, () => Promise<unknown>][] = [
      [
        ActionGroup.AddLiquidity,
        "add_liquidity",
        () =>
          addLiquidity(svm, {
            owner: user,
            pool,
            position,
            liquidityDelta,
            tokenAAmountThreshold: new BN(2_000_000_000),
            tokenBAmountThreshold: new BN(2_000_000_000),
          }),
      ],
      [
        ActionGroup.PositionManagement,
        "lock_position",
        () => lockPosition(svm, position, user, user, vestingParams()),
      ],
      [
        ActionGroup.PositionManagement,
        "lock_inner_position",
        () => lockPosition(svm, position, user, user, vestingParams(), true),
      ],
      [
        ActionGroup.PositionManagement,
        "permanent_lock_position",
        () => permanentLockPosition(svm, position, user, user),
      ],
      [
        ActionGroup.PositionManagement,
        "refresh_vesting",
        () => refreshVestings(svm, position, pool, user.publicKey, user, []),
      ],
      [
        ActionGroup.PositionManagement,
        "split_position",
        () =>
          expectSuccess(() =>
            splitPosition(svm, {
              ...splitAccounts(),
              permanentLockedLiquidityPercentage: 0,
              unlockedLiquidityPercentage: 50,
              feeAPercentage: 50,
              feeBPercentage: 50,
              reward0Percentage: 50,
              reward1Percentage: 50,
              innerVestingLiquidityPercentage: 0,
            })
          ),
      ],
      [
        ActionGroup.PositionManagement,
        "split_position2",
        () =>
          expectSuccess(() =>
            splitPosition2(svm, {
              ...splitAccounts(),
              numerator: SPLIT_POSITION_DENOMINATOR / 2,
            })
          ),
      ],
      [
        ActionGroup.PositionManagement,
        "update_delegate_permission",
        () =>
          updateDelegatePermission(svm, {
            owner: user,
            position,
            delegate: creator.publicKey,
            permission: encodeDelegatePermissions([
              PositionDelegatePermission.AddLiquidity,
            ]),
          }),
      ],
      [
        ActionGroup.RewardManagement,
        "fund_reward",
        () =>
          fundReward(svm, {
            funder: creator,
            index: 0,
            pool,
            carryForward: true,
            amount: new BN(1_000_000),
          }),
      ],
      [
        ActionGroup.RewardManagement,
        "update_reward_funder",
        () =>
          updateRewardFunder(svm, {
            index: 0,
            signer: creator,
            pool,
            newFunder: user.publicKey,
          }),
      ],
      [
        ActionGroup.RewardManagement,
        "update_reward_duration",
        () =>
          updateRewardDuration(svm, {
            index: 0,
            signer: creator,
            pool,
            newDuration: new BN(2 * 24 * 60 * 60),
          }),
      ],
    ];

    for (const [group, name, call] of endpoints) {
      it(`${name} fails with the pool authority while ${ActionGroup[group]} is disabled, and works without it`, async () => {
        await disable([group]);
        await expectActionDisabled(call);
        await withoutCircuitBreakerAccount(call);
      });

      it(`${name} works with the pool authority while ${ActionGroup[group]} is enabled`, async () => {
        const otherGroups = [
          ActionGroup.AddLiquidity,
          ActionGroup.PositionManagement,
          ActionGroup.RewardManagement,
        ].filter((other) => other !== group);
        await disable(otherGroups);
        await call();
      });
    }

    it("refresh_vesting releases every vesting account passed before the pool authority", async () => {
      const vestings = [
        await lockPosition(svm, position, user, user, vestingParams()),
        await lockPosition(svm, position, user, user, vestingParams()),
      ];
      expect(getPosition(svm, position).vestedLiquidity.eqn(2_200)).to.be.true;

      warpSlotBy(svm, new BN(5));
      await refreshVestings(
        svm,
        position,
        pool,
        user.publicKey,
        user,
        vestings
      );

      for (const vesting of vestings) {
        expect(
          getVesting(svm, vesting).innerVesting.totalReleasedLiquidity.gtn(0)
        ).to.be.true;
      }
      expect(getPosition(svm, position).vestedLiquidity.ltn(2_200)).to.be.true;

      await disable([ActionGroup.PositionManagement]);
      await expectActionDisabled(() =>
        refreshVestings(svm, position, pool, user.publicKey, user, vestings)
      );
    });

    it("update_reward_funder and update_reward_duration read the operator before the pool authority", async () => {
      await updateRewardFunder(svm, {
        index: 0,
        signer: operator,
        pool,
        newFunder: user.publicKey,
        operator: deriveOperatorAddress(operator.publicKey),
      });
      await updateRewardDuration(svm, {
        index: 0,
        signer: operator,
        pool,
        newDuration: new BN(2 * 24 * 60 * 60),
        operator: deriveOperatorAddress(operator.publicKey),
      });
      expect(getPool(svm, pool).rewardInfos[0].funder.equals(user.publicKey)).to
        .be.true;

      await disable([ActionGroup.RewardManagement]);
      await expectActionDisabled(() =>
        updateRewardFunder(svm, {
          index: 0,
          signer: operator,
          pool,
          newFunder: creator.publicKey,
          operator: deriveOperatorAddress(operator.publicKey),
        })
      );
    });
  });
});
