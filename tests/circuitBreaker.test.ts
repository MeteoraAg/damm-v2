import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import {
  deriveEventAuthority,
  deriveOperatorAddress,
  derivePositionNftAccount,
} from "./helpers/accounts";
import { generateKpAndFund, getCpAmmProgramErrorCode } from "./helpers/common";
import {
  CP_AMM_PROGRAM_ID,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  SPLIT_POSITION_DENOMINATOR,
} from "./helpers/constants";
import {
  ActionGroup,
  addLiquidity,
  claimPositionFee,
  claimProtocolFee2Transaction,
  claimReward,
  closeCircuitBreaker,
  closePosition,
  createConfigIx,
  CreateConfigParams,
  createDynamicConfigIx,
  createOperator,
  createPosition,
  encodeActionGroups,
  encodeDelegatePermissions,
  encodePermissions,
  fundReward,
  getCircuitBreaker,
  getPool,
  getPosition,
  getVesting,
  initializeCircuitBreaker,
  initializeCustomizablePool,
  initializePool,
  initializePoolWithCustomizeConfig,
  initializeReward,
  lockPosition,
  OperatorPermission,
  permanentLockPosition,
  PositionDelegatePermission,
  refreshVestingsTransaction,
  removeAllLiquidity,
  removeLiquidity,
  setDisabledActions,
  setPoolStatus,
  splitPosition,
  splitPosition2,
  swap2ExactIn,
  swap2ExactOut,
  swap2PartialFillIn,
  swapExactIn,
  swapInstruction,
  updateDelegatePermission,
  updateRewardDuration,
  updateRewardFunder,
  withdrawDeadLiquidityReward,
  withdrawIneligibleReward,
} from "./helpers/cpAmm";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "./helpers/litesvmCompat";
import {
  expectThrowsErrorCode,
  parseEventInstruction,
  parseEventLog,
  sendTransaction,
  sendTransactionWithoutSigverify,
  startSvm,
  warpSlotBy,
  warpToTimestamp,
} from "./helpers/svm";
import { createToken, getTokenBalance, mintSplTokenTo } from "./helpers/token";

const ANCHOR_ACCOUNT_OWNED_BY_WRONG_PROGRAM = 3007;

const ALL_ACTION_GROUPS = [
  ActionGroup.Swap,
  ActionGroup.AddLiquidity,
  ActionGroup.RemoveLiquidity,
  ActionGroup.ClaimFee,
  ActionGroup.ClaimReward,
  ActionGroup.PositionManagement,
  ActionGroup.RewardManagement,
  ActionGroup.CreatePool,
];

// `claim_protocol_fee2` must be signed by this PDA of the protocol fee program, which isn't
// deployed in these tests
const PROTOCOL_FEE_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol_fee_authority")],
  new PublicKey("pFee3tb7qh5z53jRF4PbLwmNd148Q8ypLNZbqsMeinA")
)[0];

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

    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          data: baseFeeData(),
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

  function swapParams() {
    return {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };
  }

  function tokenAccount(mint: PublicKey) {
    return getAssociatedTokenAddressSync(
      mint,
      user.publicKey,
      true,
      svm.getAccount(mint)!.owner
    );
  }

  async function swap() {
    await swapExactIn(svm, swapParams());
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

  async function initialize(disabledActions: BN) {
    const result = await initializeCircuitBreaker(
      svm,
      operator,
      disabledActions
    );
    expect(result).instanceOf(TransactionMetadata);
    return result as TransactionMetadata;
  }

  async function disable(actions: ActionGroup[]) {
    await setDisabledActions(svm, operator, encodeActionGroups(actions));
  }

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

  describe("initialize_circuit_breaker", () => {
    it("stores the circuit breaker in the event authority with the given bitmask, and emits an event", async () => {
      const eventAuthority = deriveEventAuthority();
      expect(svm.getAccount(eventAuthority)).to.be.null;

      const disabledActions = encodeActionGroups([
        ActionGroup.Swap,
        ActionGroup.ClaimFee,
      ]);
      const result = await initialize(disabledActions);

      const account = svm.getAccount(eventAuthority)!;
      expect(account.owner.equals(CP_AMM_PROGRAM_ID)).to.be.true;
      // 8 bytes of discriminator and 64 bytes of data
      expect(account.data.length).eq(72);
      const circuitBreaker = getCircuitBreaker(svm)!;
      expect(circuitBreaker.disabledActions.eq(disabledActions)).to.be.true;

      const event = parseEventLog(result, "evtInitializeCircuitBreaker")!.data;
      expect(event.signer.equals(operator.publicKey)).to.be.true;
      expect(event.disabledActions.eq(disabledActions)).to.be.true;

      await expectActionDisabled(swap);
      await removeSomeLiquidity();
    });

    // The operator can simply close the circuit breaker to enable every action
    it("rejects an empty bitmask", async () => {
      const result = await initializeCircuitBreaker(svm, operator, new BN(0));
      expectThrowsErrorCode(
        result,
        getCpAmmProgramErrorCode("InvalidParameters")
      );
      expect(getCircuitBreaker(svm)).to.be.null;
    });

    it("works when the event authority already holds lamports", async () => {
      const eventAuthority = deriveEventAuthority();
      svm.setAccount(eventAuthority, {
        data: new Uint8Array(),
        executable: false,
        lamports: 180_000_000_000,
        owner: SystemProgram.programId,
      });

      const disabledActions = encodeActionGroups([ActionGroup.Swap]);
      await initialize(disabledActions);
      expect(svm.getAccount(eventAuthority)!.lamports).eq(180_000_000_000);
      expect(getCircuitBreaker(svm)!.disabledActions.eq(disabledActions)).to
        .be.true;
    });

    it("rejects a bit above the last action group", async () => {
      const result = await initializeCircuitBreaker(
        svm,
        operator,
        new BN(1).shln(ActionGroup.CreatePool + 1)
      );
      expectThrowsErrorCode(
        result,
        getCpAmmProgramErrorCode("InvalidParameters")
      );
      expect(getCircuitBreaker(svm)).to.be.null;
    });

    it("fails for an operator without the CircuitBreaker permission", async () => {
      const result = await initializeCircuitBreaker(
        svm,
        otherOperator,
        encodeActionGroups([ActionGroup.Swap])
      );
      expectThrowsErrorCode(
        result,
        getCpAmmProgramErrorCode("InvalidPermission")
      );
      expect(getCircuitBreaker(svm)).to.be.null;
    });

    it("fails the second time", async () => {
      const disabledActions = encodeActionGroups([ActionGroup.Swap]);
      await initialize(disabledActions);
      expect(
        await initializeCircuitBreaker(svm, operator, disabledActions)
      ).instanceOf(FailedTransactionMetadata);
    });
  });

  describe("the event authority as a program-owned account", () => {
    beforeEach(async () => {
      await initialize(encodeActionGroups([ActionGroup.CreatePool]));
    });

    it("still signs the event CPI of swap", async () => {
      const balanceBefore = new BN(
        getTokenBalance(svm, tokenAccount(tokenAMint))
      );
      const transaction = await swapInstruction(svm, swapParams());
      const result = sendTransaction(svm, transaction, [user]);
      expect(result).instanceOf(TransactionMetadata);

      const event = parseEventInstruction(
        result as TransactionMetadata,
        "evtSwap2"
      );
      expect(event).not.to.be.null;
      expect(
        new BN(getTokenBalance(svm, tokenAccount(tokenAMint))).eq(
          balanceBefore.subn(10)
        )
      ).to.be.true;
    });

    it("lets a swap with a writable event authority run", async () => {
      const transaction = await swapInstruction(svm, swapParams());
      const instruction =
        transaction.instructions[transaction.instructions.length - 1];
      instruction.keys.find((key) =>
        key.pubkey.equals(deriveEventAuthority())
      )!.isWritable = true;

      expect(sendTransaction(svm, transaction, [user])).instanceOf(
        TransactionMetadata
      );
    });

    it("lets anchor user endpoints run", async () => {
      await removeSomeLiquidity();
      await claimPositionFee(svm, { owner: user, pool, position });
      await createPosition(svm, user, user.publicKey, pool);
    });
  });

  describe("close_circuit_breaker", () => {
    it("fails before the circuit breaker is initialized", async () => {
      const result = await closeCircuitBreaker(svm, operator);
      expectThrowsErrorCode(result, ANCHOR_ACCOUNT_OWNED_BY_WRONG_PROGRAM);
    });

    describe("once initialized", () => {
      beforeEach(async () => {
        await initialize(encodeActionGroups([ActionGroup.Swap]));
      });

      it("closes a circuit breaker that disables an action, sends its rent to the receiver, emits an event and enables every action", async () => {
        await expectActionDisabled(swap);

        const eventAuthority = deriveEventAuthority();
        const rent = svm.getAccount(eventAuthority)!.lamports;
        const rentReceiver = Keypair.generate().publicKey;

        const result = await closeCircuitBreaker(svm, operator, rentReceiver);
        expect(result).instanceOf(TransactionMetadata);

        expect(svm.getAccount(eventAuthority)).to.be.null;
        expect(getCircuitBreaker(svm)).to.be.null;
        expect(svm.getAccount(rentReceiver)!.lamports).eq(rent);

        const event = parseEventLog(
          result as TransactionMetadata,
          "evtCloseCircuitBreaker"
        )!.data;
        expect(event.signer.equals(operator.publicKey)).to.be.true;

        // the event authority is an empty system account again, which still signs the event CPI
        const transaction = await swapInstruction(svm, swapParams());
        const swapResult = sendTransaction(svm, transaction, [user]);
        expect(swapResult).instanceOf(TransactionMetadata);
        expect(
          parseEventInstruction(swapResult as TransactionMetadata, "evtSwap2")
        ).not.to.be.null;
        await removeSomeLiquidity();
      });

      it("fails for an operator without the CircuitBreaker permission", async () => {
        const result = await closeCircuitBreaker(svm, otherOperator);
        expectThrowsErrorCode(
          result,
          getCpAmmProgramErrorCode("InvalidPermission")
        );
        expect(getCircuitBreaker(svm)).not.to.be.null;
      });

      it("initializes again after the close", async () => {
        expect(await closeCircuitBreaker(svm, operator)).instanceOf(
          TransactionMetadata
        );
        await swap();

        await initialize(encodeActionGroups([ActionGroup.RemoveLiquidity]));
        await swap();
        await expectActionDisabled(removeSomeLiquidity);
      });

      it("changes the bitmask by closing and initializing again in one transaction", async () => {
        await disable([ActionGroup.RemoveLiquidity]);
        await swap();
        await expectActionDisabled(removeSomeLiquidity);
      });
    });
  });

  describe("endpoints with #[event_cpi]", () => {
    let dynamicConfig: PublicKey;
    let secondPosition: PublicKey;

    beforeEach(async () => {
      expect(
        await initializeReward(svm, {
          index: 0,
          payer: creator,
          rewardDuration: new BN(24 * 60 * 60),
          pool,
          rewardMint: createFundedMint(),
          funder: creator.publicKey,
        })
      ).instanceOf(TransactionMetadata);
      dynamicConfig = await createDynamicConfigIx(svm, operator, new BN(2), {
        poolCreatorAuthority: creator.publicKey,
      });
      secondPosition = await createPosition(svm, user, user.publicKey, pool);
      // update_reward_duration requires the current time to be past the end of the campaign,
      // which is zero for a reward that was never funded
      warpToTimestamp(svm, new BN(1));
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

    type Endpoint = {
      group: ActionGroup;
      name: string;
      call: () => Promise<unknown>;
      // true when `call` succeeds in the state that `beforeEach` sets up, so the test can also
      // check that the endpoint runs while its group is enabled
      succeeds?: boolean;
    };

    const endpoints: Endpoint[] = [
      {
        group: ActionGroup.AddLiquidity,
        name: "create_position",
        call: () => createPosition(svm, user, user.publicKey, pool),
        succeeds: true,
      },
      {
        group: ActionGroup.AddLiquidity,
        name: "add_liquidity",
        call: () =>
          addLiquidity(svm, {
            owner: user,
            pool,
            position,
            liquidityDelta,
            tokenAAmountThreshold: new BN(2_000_000_000),
            tokenBAmountThreshold: new BN(2_000_000_000),
          }),
        succeeds: true,
      },
      {
        group: ActionGroup.RemoveLiquidity,
        name: "remove_liquidity",
        call: removeSomeLiquidity,
        succeeds: true,
      },
      {
        group: ActionGroup.RemoveLiquidity,
        name: "remove_all_liquidity",
        call: () =>
          removeAllLiquidity(svm, {
            owner: user,
            pool,
            position,
            tokenAAmountThreshold: new BN(0),
            tokenBAmountThreshold: new BN(0),
          }),
      },
      {
        group: ActionGroup.ClaimFee,
        name: "claim_position_fee",
        call: () => claimPositionFee(svm, { owner: user, pool, position }),
        succeeds: true,
      },
      {
        group: ActionGroup.ClaimReward,
        name: "claim_reward",
        call: () =>
          claimReward(svm, {
            index: 0,
            user,
            position,
            pool,
            skipReward: 0,
          }),
      },
      {
        group: ActionGroup.ClaimReward,
        name: "withdraw_ineligible_reward",
        call: () =>
          withdrawIneligibleReward(svm, { index: 0, pool, funder: creator }),
      },
      {
        group: ActionGroup.ClaimReward,
        name: "withdraw_dead_liquidity_reward",
        call: () =>
          withdrawDeadLiquidityReward(svm, { index: 0, pool, funder: creator }),
      },
      {
        group: ActionGroup.PositionManagement,
        name: "close_position",
        call: () => closePosition(svm, { owner: user, pool, position }),
      },
      {
        group: ActionGroup.PositionManagement,
        name: "lock_position",
        call: () => lockPosition(svm, position, user, user, vestingParams()),
        succeeds: true,
      },
      {
        group: ActionGroup.PositionManagement,
        name: "lock_inner_position",
        call: () =>
          lockPosition(svm, position, user, user, vestingParams(), true),
        succeeds: true,
      },
      {
        group: ActionGroup.PositionManagement,
        name: "permanent_lock_position",
        call: () => permanentLockPosition(svm, position, user, user),
        succeeds: true,
      },
      {
        group: ActionGroup.PositionManagement,
        name: "split_position",
        call: () =>
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
        succeeds: true,
      },
      {
        group: ActionGroup.PositionManagement,
        name: "split_position2",
        call: () =>
          expectSuccess(() =>
            splitPosition2(svm, {
              ...splitAccounts(),
              numerator: SPLIT_POSITION_DENOMINATOR / 2,
            })
          ),
        succeeds: true,
      },
      {
        group: ActionGroup.PositionManagement,
        name: "update_delegate_permission",
        call: () =>
          updateDelegatePermission(svm, {
            owner: user,
            position,
            delegate: creator.publicKey,
            permission: encodeDelegatePermissions([
              PositionDelegatePermission.AddLiquidity,
            ]),
          }),
        succeeds: true,
      },
      {
        group: ActionGroup.RewardManagement,
        name: "initialize_reward",
        call: () =>
          initializeReward(svm, {
            index: 1,
            payer: creator,
            rewardDuration: new BN(24 * 60 * 60),
            pool,
            rewardMint: createFundedMint(),
            funder: creator.publicKey,
          }),
      },
      {
        group: ActionGroup.RewardManagement,
        name: "fund_reward",
        call: () =>
          fundReward(svm, {
            funder: creator,
            index: 0,
            pool,
            carryForward: true,
            amount: new BN(1_000_000),
          }),
        succeeds: true,
      },
      {
        group: ActionGroup.RewardManagement,
        name: "update_reward_funder",
        call: () =>
          updateRewardFunder(svm, {
            index: 0,
            signer: creator,
            pool,
            newFunder: user.publicKey,
          }),
        succeeds: true,
      },
      {
        group: ActionGroup.RewardManagement,
        name: "update_reward_duration",
        call: () =>
          updateRewardDuration(svm, {
            index: 0,
            signer: creator,
            pool,
            newDuration: new BN(2 * 24 * 60 * 60),
          }),
        succeeds: true,
      },
      {
        group: ActionGroup.CreatePool,
        name: "initialize_pool",
        call: () =>
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
      },
      {
        group: ActionGroup.CreatePool,
        name: "initialize_pool_with_dynamic_config",
        call: () =>
          initializePoolWithCustomizeConfig(svm, {
            ...customizablePoolParams(),
            poolCreatorAuthority: creator,
            customizeConfigAddress: dynamicConfig,
          }),
      },
      {
        group: ActionGroup.CreatePool,
        name: "initialize_customizable_pool",
        call: () => initializeCustomizablePool(svm, customizablePoolParams()),
      },
    ];

    for (const { group, name, call, succeeds } of endpoints) {
      it(`${name} fails while ${ActionGroup[group]} is disabled`, async () => {
        await disable([group]);
        await expectActionDisabled(call);
      });

      if (succeeds) {
        it(`${name} works while ${ActionGroup[group]} is the only enabled group`, async () => {
          await disable(ALL_ACTION_GROUPS.filter((other) => other !== group));
          await call();
        });
      }
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
      await disable(
        ALL_ACTION_GROUPS.filter((group) => group !== ActionGroup.Swap)
      );
      await swap();
    });

    it("re-enabling a group restores its endpoints", async () => {
      await disable([ActionGroup.RemoveLiquidity, ActionGroup.AddLiquidity]);
      await expectActionDisabled(removeSomeLiquidity);

      await disable([]);
      await removeSomeLiquidity();
      await createPosition(svm, user, user.publicKey, pool);
    });

    it("update_reward_funder and update_reward_duration signed by an operator check the circuit breaker", async () => {
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

    it("operator endpoints work while every group is disabled", async () => {
      await disable(ALL_ACTION_GROUPS);
      await setPoolStatus(svm, {
        whitelistedAddress: otherOperator,
        pool,
        status: 1,
      });
    });
  });

  describe("endpoints that take the event authority as optional leading remaining accounts", () => {
    describe("refresh_vesting", () => {
      const vestingParams = () => ({
        cliffPoint: null,
        periodFrequency: new BN(1),
        cliffUnlockLiquidity: new BN(100),
        liquidityPerPeriod: new BN(100),
        numberOfPeriod: 10,
      });

      async function refresh(
        vestings: PublicKey[],
        includeCircuitBreaker: boolean
      ) {
        const transaction = await refreshVestingsTransaction(
          svm,
          position,
          pool,
          user.publicKey,
          vestings,
          includeCircuitBreaker
        );
        return sendTransaction(svm, transaction, [user]);
      }

      it("fails with the leading accounts while PositionManagement is disabled, and works without them", async () => {
        await disable([ActionGroup.PositionManagement]);
        expectThrowsErrorCode(
          await refresh([], true),
          getCpAmmProgramErrorCode("ActionDisabled")
        );
        expect(await refresh([], false)).instanceOf(TransactionMetadata);
      });

      it("works with the leading accounts while PositionManagement is the only enabled group", async () => {
        await disable(
          ALL_ACTION_GROUPS.filter(
            (group) => group !== ActionGroup.PositionManagement
          )
        );
        expect(await refresh([], true)).instanceOf(TransactionMetadata);
      });

      for (const includeCircuitBreaker of [true, false]) {
        it(`releases every vesting account passed ${
          includeCircuitBreaker
            ? "after the leading accounts"
            : "by an old client"
        }`, async () => {
          const vestings = [
            await lockPosition(svm, position, user, user, vestingParams()),
            await lockPosition(svm, position, user, user, vestingParams()),
          ];
          expect(getPosition(svm, position).vestedLiquidity.eqn(2_200)).to.be
            .true;

          warpSlotBy(svm, new BN(5));
          expect(await refresh(vestings, includeCircuitBreaker)).instanceOf(
            TransactionMetadata
          );

          for (const vesting of vestings) {
            expect(
              getVesting(svm, vesting).innerVesting.totalReleasedLiquidity.gtn(
                0
              )
            ).to.be.true;
          }
          expect(getPosition(svm, position).vestedLiquidity.ltn(2_200)).to.be
            .true;
        });
      }
    });

    describe("claim_protocol_fee2", () => {
      let receiverTokenAccount: PublicKey;

      beforeEach(async () => {
        for (let i = 0; i < 4; i++) {
          await swapExactIn(svm, {
            ...swapParams(),
            inputTokenMint: tokenBMint,
            outputTokenMint: tokenAMint,
            amountIn: new BN(10_000),
          });
        }
        // the fee is taken from the output token, A
        expect(getPool(svm, pool).protocolAFee.gtn(0)).to.be.true;
        receiverTokenAccount = tokenAccount(tokenAMint);
      });

      // The signer is a PDA of the protocol fee program, so the transaction is sent without
      // signature verification. The user pays the fee
      async function claim(includeCircuitBreaker: boolean) {
        const transaction = await claimProtocolFee2Transaction(svm, {
          signer: PROTOCOL_FEE_AUTHORITY,
          pool,
          isTokenA: true,
          receiverTokenAccount,
          includeCircuitBreaker,
        });
        return sendTransactionWithoutSigverify(svm, transaction, [user]);
      }

      it("fails with the leading accounts while ClaimFee is disabled, and works without them", async () => {
        await disable([ActionGroup.ClaimFee]);
        expectThrowsErrorCode(
          await claim(true),
          getCpAmmProgramErrorCode("ActionDisabled")
        );

        const protocolFee = getPool(svm, pool).protocolAFee;
        const balanceBefore = new BN(
          getTokenBalance(svm, receiverTokenAccount)
        );
        expect(await claim(false)).instanceOf(TransactionMetadata);
        expect(
          new BN(getTokenBalance(svm, receiverTokenAccount)).eq(
            balanceBefore.add(protocolFee)
          )
        ).to.be.true;
        expect(getPool(svm, pool).protocolAFee.isZero()).to.be.true;
      });

      it("works with the leading accounts while ClaimFee is the only enabled group", async () => {
        await disable(
          ALL_ACTION_GROUPS.filter((group) => group !== ActionGroup.ClaimFee)
        );
        expect(await claim(true)).instanceOf(TransactionMetadata);
        expect(getPool(svm, pool).protocolAFee.isZero()).to.be.true;
      });
    });
  });
});
