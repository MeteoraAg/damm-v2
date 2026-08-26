import { expect } from "chai";
import { generateKpAndFund } from "./helpers/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createConfigIx,
  CreateConfigParams,
  createDynamicConfigIx,
  CreateDynamicConfigParams,
  ConfigPermission,
  encodeConfigPermissions,
  getPool,
  getConfig,
  initializePool,
  InitializePoolParams,
  initializePoolWithCustomizeConfig,
  InitializePoolWithCustomizeConfigParams,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  createToken,
  mintSplTokenTo,
  getCpAmmProgramErrorCode,
  OperatorPermission,
  createOperator,
  encodePermissions,
  startSvm,
  expectThrowsErrorCode,
  updateConfigPermission,
} from "./helpers";
import BN from "bn.js";
import {
  createToken2022,
  createPermenantDelegateExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

const invalidConfigPermission = getCpAmmProgramErrorCode(
  "InvalidConfigPermission"
);
const invalidTokenBadge = getCpAmmProgramErrorCode("InvalidTokenBadge");
const invalidPermission = getCpAmmProgramErrorCode("InvalidPermission");

describe("Config permission: CreatePoolWithoutMintValidation", () => {
  let svm: LiteSVM;
  let creator: Keypair;
  let admin: Keypair;
  let configOperator: Keypair;
  let permissionOperator: Keypair;

  // Token-2022 mint with PermanentDelegate: never permissionless, always needs a badge
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  let configIndex = 0;
  const nextIndex = () => new BN(configIndex++);

  const bypass = encodeConfigPermissions([
    ConfigPermission.CreatePoolWithoutMintValidation,
  ]);

  function staticConfigParams(
    poolCreatorAuthority: PublicKey,
    permission?: BN
  ): CreateConfigParams {
    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    return {
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority,
      activationType: 0,
      collectFeeMode: 0,
      permission,
    };
  }

  function initPoolParams(config: PublicKey): InitializePoolParams {
    return {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE),
      activationPoint: null,
    };
  }

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    configOperator = generateKpAndFund(svm);
    permissionOperator = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    tokenAMint = tokenAMintKeypair.publicKey;
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
    tokenBMint = createToken(svm, admin.publicKey);

    mintToToken2022(svm, tokenAMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    await createOperator(svm, {
      admin,
      whitelistAddress: configOperator.publicKey,
      permission: encodePermissions([OperatorPermission.CreateConfigKey]),
    });
    await createOperator(svm, {
      admin,
      whitelistAddress: permissionOperator.publicKey,
      permission: encodePermissions([
        OperatorPermission.UpdateConfigPermission,
      ]),
    });
  });

  it("rejects permission bits on a public static config", async () => {
    await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(PublicKey.default, bypass),
      invalidConfigPermission
    );
  });

  it("rejects out-of-range permission on static and dynamic config", async () => {
    await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(creator.publicKey, new BN(0b10)),
      invalidConfigPermission
    );

    const dynamicParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
      permission: new BN(0b10),
    };
    await createDynamicConfigIx(
      svm,
      configOperator,
      nextIndex(),
      dynamicParams,
      invalidConfigPermission
    );
  });

  it("static private config without bypass still requires a token badge", async () => {
    const config = await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(creator.publicKey)
    );
    expect(getConfig(svm, config).permission.toString()).eq("0");

    const { result } = await initializePool(svm, initPoolParams(config));
    expectThrowsErrorCode(result, invalidTokenBadge);
  });

  it("static private config with bypass creates pool without token badge", async () => {
    const config = await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(creator.publicKey, bypass)
    );

    const { pool } = await initializePool(svm, initPoolParams(config));
    const poolState = getPool(svm, pool);
    expect(poolState.tokenAMint.toString()).eq(tokenAMint.toString());
    expect(poolState.tokenBMint.toString()).eq(tokenBMint.toString());
  });

  it("dynamic config with bypass creates pool without token badge", async () => {
    const dynamicParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
      permission: bypass,
    };
    const config = await createDynamicConfigIx(
      svm,
      configOperator,
      nextIndex(),
      dynamicParams
    );

    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    const params: InitializePoolWithCustomizeConfigParams = {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE),
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    };

    // without bypass the same call fails
    const noBypassConfig = await createDynamicConfigIx(
      svm,
      configOperator,
      nextIndex(),
      { poolCreatorAuthority: creator.publicKey }
    );
    await initializePoolWithCustomizeConfig(
      svm,
      { ...params, customizeConfigAddress: noBypassConfig },
      invalidTokenBadge
    );

    await initializePoolWithCustomizeConfig(svm, params);
  });

  it("update_config_permission enables bypass on an existing config", async () => {
    const config = await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(creator.publicKey)
    );

    const { result: before } = await initializePool(
      svm,
      initPoolParams(config)
    );
    expectThrowsErrorCode(before, invalidTokenBadge);

    // operator without UpdateConfigPermission is rejected
    await updateConfigPermission(
      svm,
      { whitelistedAddress: configOperator, config, permission: bypass },
      invalidPermission
    );

    await updateConfigPermission(svm, {
      whitelistedAddress: permissionOperator,
      config,
      permission: bypass,
    });

    const { pool } = await initializePool(svm, initPoolParams(config));
    expect(getPool(svm, pool).tokenAMint.toString()).eq(tokenAMint.toString());

    // and back off again
    await updateConfigPermission(svm, {
      whitelistedAddress: permissionOperator,
      config,
      permission: new BN(0),
    });
    expect(getConfig(svm, config).permission.toString()).eq("0");
  });

  it("update_config_permission rejects bypass on a public config", async () => {
    const config = await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(PublicKey.default)
    );

    await updateConfigPermission(
      svm,
      { whitelistedAddress: permissionOperator, config, permission: bypass },
      invalidConfigPermission
    );
    await updateConfigPermission(
      svm,
      {
        whitelistedAddress: permissionOperator,
        config,
        permission: new BN(0b10),
      },
      invalidConfigPermission
    );
  });

  it("initialize_customizable_pool still requires a token badge", async () => {
    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    const params: InitializeCustomizablePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      tokenAMint,
      tokenBMint,
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      hasAlphaVault: false,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE),
      activationType: 0,
      collectFeeMode: 0,
      activationPoint: null,
    };
    await initializeCustomizablePool(svm, params, invalidTokenBadge);
  });
});
