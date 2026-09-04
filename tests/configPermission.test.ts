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
} from "./helpers";
import BN from "bn.js";
import {
  createNativeMintToken2022,
  createToken2022,
  createPermenantDelegateExtensionWithInstruction,
  mintToToken2022,
} from "./helpers/token2022";
import { getOrCreateAssociatedTokenAccount } from "./helpers/token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

const invalidConfigPermission = getCpAmmProgramErrorCode(
  "InvalidConfigPermission"
);
const invalidTokenBadge = getCpAmmProgramErrorCode("InvalidTokenBadge");
const unsupportNativeMintToken2022 = getCpAmmProgramErrorCode(
  "UnsupportNativeMintToken2022"
);

describe("Config permission: CreatePoolWithoutMintValidation", () => {
  let svm: LiteSVM;
  let creator: Keypair;
  let admin: Keypair;
  let configOperator: Keypair;

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

  function dynamicPoolParams(
    config: PublicKey
  ): InitializePoolWithCustomizeConfigParams {
    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    return {
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
  }

  // Token-2022 native mint (wrapped SOL) with a funded payer ATA, so the
  // instruction reaches the handler and fails on the mint check itself.
  function setupNativeMintToken2022(): PublicKey {
    const nativeMint = createNativeMintToken2022(svm);
    getOrCreateAssociatedTokenAccount(
      svm,
      creator,
      nativeMint,
      creator.publicKey,
      TOKEN_2022_PROGRAM_ID
    );
    return nativeMint;
  }

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    configOperator = generateKpAndFund(svm);

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

    const params = dynamicPoolParams(config);

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

  it("static config with bypass still rejects Token-2022 native mint as token A", async () => {
    const config = await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(creator.publicKey, bypass)
    );

    const nativeMint = setupNativeMintToken2022();
    const { result } = await initializePool(svm, {
      ...initPoolParams(config),
      tokenAMint: nativeMint,
    });
    expectThrowsErrorCode(result, unsupportNativeMintToken2022);
  });

  it("static config with bypass still rejects Token-2022 native mint as token B", async () => {
    const config = await createConfigIx(
      svm,
      configOperator,
      nextIndex(),
      staticConfigParams(creator.publicKey, bypass)
    );

    const nativeMint = setupNativeMintToken2022();
    const { result } = await initializePool(svm, {
      ...initPoolParams(config),
      tokenBMint: nativeMint,
    });
    expectThrowsErrorCode(result, unsupportNativeMintToken2022);
  });

  it("dynamic config with bypass still rejects Token-2022 native mint as token A", async () => {
    const config = await createDynamicConfigIx(
      svm,
      configOperator,
      nextIndex(),
      { poolCreatorAuthority: creator.publicKey, permission: bypass }
    );

    const nativeMint = setupNativeMintToken2022();
    await initializePoolWithCustomizeConfig(
      svm,
      { ...dynamicPoolParams(config), tokenAMint: nativeMint },
      unsupportNativeMintToken2022
    );
  });

  it("dynamic config with bypass still rejects Token-2022 native mint as token B", async () => {
    const config = await createDynamicConfigIx(
      svm,
      configOperator,
      nextIndex(),
      { poolCreatorAuthority: creator.publicKey, permission: bypass }
    );

    const nativeMint = setupNativeMintToken2022();
    await initializePoolWithCustomizeConfig(
      svm,
      { ...dynamicPoolParams(config), tokenBMint: nativeMint },
      unsupportNativeMintToken2022
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
