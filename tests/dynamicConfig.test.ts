import {
  ANCHOR_ERROR_ACCOUNT_OWNED_BY_WRONG_PROGRAM,
  generateKpAndFund,
} from "./helpers/common";
import { AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import {
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  OFFSET,
  createToken,
  createTokenBadge,
  expectThrowsErrorCode,
  mintSplTokenTo,
  createDynamicConfigIx,
  CreateDynamicConfigParams,
  InitializePoolWithCustomizeConfigParams,
  initializePoolWithCustomizeConfig,
  initializePoolWithCustomizeConfig2,
  encodePermissions,
  createOperator,
  OperatorPermission,
  startSvm,
} from "./helpers";
import {
  createPermenantDelegateExtensionWithInstruction,
  createToken2022,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import {
  createExtraAccountMetaListAndCounter,
  getHookRemainingAccounts,
  readHookCounter,
} from "./helpers/transferHook";
import BN from "bn.js";
import { expect } from "chai";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";

describe("Dynamic config test", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    // create dynamic config
    const createDynamicConfigParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
    };

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createDynamicConfigIx(
      svm,
      whitelistedAccount,
      new BN(configId),
      createDynamicConfigParams
    );
  });

  it("create pool with dynamic config", async () => {
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

    const params: InitializePoolWithCustomizeConfigParams = {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    };

    const { pool: _pool } = await initializePoolWithCustomizeConfig(
      svm,
      params
    );
  });

  it("create pool with dynamic config using initialize_pool_with_dynamic_config2", async () => {
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

    const { result } = await initializePoolWithCustomizeConfig2(svm, {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    });
    expect(result).instanceOf(TransactionMetadata);
  });
});

describe("Dynamic config test with token 2022 permanent delegate (token badge only)", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    const tokenBMintKeypair = Keypair.generate();

    tokenAMint = tokenAMintKeypair.publicKey;
    tokenBMint = tokenBMintKeypair.publicKey;

    await createToken2022(
      svm,
      [
        createPermenantDelegateExtensionWithInstruction(
          tokenAMint,
          admin.publicKey
        ),
      ],
      tokenAMintKeypair,
      admin.publicKey
    );
    await createToken2022(
      svm,
      [
        createPermenantDelegateExtensionWithInstruction(
          tokenBMint,
          admin.publicKey
        ),
      ],
      tokenBMintKeypair,
      admin.publicKey
    );

    await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

    await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

    // create dynamic config
    const createDynamicConfigParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
    };

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.CreateTokenBadge,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createDynamicConfigIx(
      svm,
      whitelistedAccount,
      new BN(configId),
      createDynamicConfigParams
    );

    // permanent delegate mints are only supported with a token badge
    await createTokenBadge(svm, {
      tokenMint: tokenAMint,
      whitelistedAddress: whitelistedAccount,
    });
    await createTokenBadge(svm, {
      tokenMint: tokenBMint,
      whitelistedAddress: whitelistedAccount,
    });
  });

  it("initialize_pool_with_dynamic_config2 passing token badges but no transfer hook accounts", async () => {
    const cliffFeeNumerator = new BN(2_500_000);

    const data = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

    const { result } = await initializePoolWithCustomizeConfig2(svm, {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: new BN(1).shln(OFFSET),
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    });
    expect(result).instanceOf(TransactionMetadata);
  });
});

describe("Dynamic config test with token 2022 transfer hook", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let tokenAHookAccounts: AccountMeta[];
  let tokenBHookAccounts: AccountMeta[];
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    const tokenBMintKeypair = Keypair.generate();

    tokenAMint = tokenAMintKeypair.publicKey;
    tokenBMint = tokenBMintKeypair.publicKey;

    await createToken2022(
      svm,
      [createTransferHookExtensionWithInstruction(tokenAMint, admin.publicKey)],
      tokenAMintKeypair,
      admin.publicKey
    );
    await createToken2022(
      svm,
      [createTransferHookExtensionWithInstruction(tokenBMint, admin.publicKey)],
      tokenBMintKeypair,
      admin.publicKey
    );

    await createExtraAccountMetaListAndCounter(svm, admin, tokenAMint);
    await createExtraAccountMetaListAndCounter(svm, admin, tokenBMint);

    tokenAHookAccounts = getHookRemainingAccounts(tokenAMint);
    tokenBHookAccounts = getHookRemainingAccounts(tokenBMint);

    await mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

    await mintToToken2022(svm, tokenBMint, admin, creator.publicKey);

    // create dynamic config
    const createDynamicConfigParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
    };

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.CreateTokenBadge,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createDynamicConfigIx(
      svm,
      whitelistedAccount,
      new BN(configId),
      createDynamicConfigParams
    );
  });

  // active hook mints require a token badge for pool creation
  async function createTokenBadges() {
    await createTokenBadge(svm, {
      tokenMint: tokenAMint,
      whitelistedAddress: whitelistedAccount,
    });
    await createTokenBadge(svm, {
      tokenMint: tokenBMint,
      whitelistedAddress: whitelistedAccount,
    });
  }

  function dynamicConfigPool2Params(): InitializePoolWithCustomizeConfigParams {
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

    return {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: new BN(1).shln(OFFSET),
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    };
  }

  it("initialize_pool_with_dynamic_config2 invokes the hook on both deposits", async () => {
    await createTokenBadges();

    const beforeCounterA = readHookCounter(svm, tokenAMint);
    const beforeCounterB = readHookCounter(svm, tokenBMint);

    const { result } = await initializePoolWithCustomizeConfig2(svm, {
      ...dynamicConfigPool2Params(),
      tokenAHookAccounts,
      tokenBHookAccounts,
    });
    expect(result).instanceOf(TransactionMetadata);

    // one payer->vault deposit per mint
    expect(readHookCounter(svm, tokenAMint)).eq(beforeCounterA + 1);
    expect(readHookCounter(svm, tokenBMint)).eq(beforeCounterB + 1);
  });

  it("initialize_pool_with_dynamic_config2 fails when transfer hook accounts are missing", async () => {
    await createTokenBadges();

    const { result } = await initializePoolWithCustomizeConfig2(
      svm,
      dynamicConfigPool2Params()
    );
    expect(result).instanceOf(FailedTransactionMetadata);
  });

  it("initialize_pool_with_dynamic_config2 fails without a token badge", async () => {
    const { result } = await initializePoolWithCustomizeConfig2(svm, {
      ...dynamicConfigPool2Params(),
      tokenAHookAccounts,
      tokenBHookAccounts,
    });

    expectThrowsErrorCode(result, ANCHOR_ERROR_ACCOUNT_OWNED_BY_WRONG_PROGRAM);
  });
});
