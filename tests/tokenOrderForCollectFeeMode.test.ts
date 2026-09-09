import { expect } from "chai";
import { generateKpAndFund, getCpAmmProgramErrorCode } from "./helpers/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createConfigIx,
  CreateConfigParams,
  createDynamicConfigIx,
  CreateDynamicConfigParams,
  createOperator,
  createToken,
  encodePermissions,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  initializePool,
  InitializePoolParams,
  initializePoolWithCustomizeConfig,
  InitializePoolWithCustomizeConfigParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  NATIVE_MINT,
  OperatorPermission,
  PoolFeesParams,
  startSvm,
  U128_MAX,
  USDC_MINT,
  wrapSOL,
} from "./helpers";
import { createTokenAt } from "./helpers/token";
import { expectThrowsErrorCode } from "./helpers/svm";
import BN from "bn.js";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM, TransactionMetadata } from "litesvm";

const BOTH_TOKEN = 0;
const ONLY_B = 1;
const COMPOUNDING = 2;

type Mint = "WSOL" | "USDC" | "MEME_1" | "MEME_2";

type Scenario = {
  name: string;
  base: Mint;
  quote: Mint;
  collectFeeMode: number;
  allowed: boolean;
};

const scenarios: Scenario[] = [
  {
    name: "Rejects WSOL as base and meme as quote when fee is collected only in quote",
    base: "WSOL",
    quote: "MEME_1",
    collectFeeMode: ONLY_B,
    allowed: false,
  },
  {
    name: "Rejects WSOL as base and meme as quote in compounding mode",
    base: "WSOL",
    quote: "MEME_1",
    collectFeeMode: COMPOUNDING,
    allowed: false,
  },
  {
    name: "Allows WSOL as base and meme as quote when fee is collected in both tokens",
    base: "WSOL",
    quote: "MEME_1",
    collectFeeMode: BOTH_TOKEN,
    allowed: true,
  },
  {
    name: "Allows meme as base and WSOL as quote when fee is collected only in quote",
    base: "MEME_1",
    quote: "WSOL",
    collectFeeMode: ONLY_B,
    allowed: true,
  },
  {
    name: "Allows meme as base and WSOL as quote in compounding mode",
    base: "MEME_1",
    quote: "WSOL",
    collectFeeMode: COMPOUNDING,
    allowed: true,
  },
  {
    name: "Allows two meme tokens when fee is collected only in quote",
    base: "MEME_1",
    quote: "MEME_2",
    collectFeeMode: ONLY_B,
    allowed: true,
  },
  {
    name: "Allows WSOL as base and USDC as quote when fee is collected only in quote",
    base: "WSOL",
    quote: "USDC",
    collectFeeMode: ONLY_B,
    allowed: true,
  },
];

// Creates a pool through one endpoint. Asserts failure with errorCode when given,
// otherwise asserts success.
type CreatePool = (
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  collectFeeMode: number,
  errorCode?: number
) => Promise<void>;

describe("Token order for collect fee mode", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let mints: Record<Mint, PublicKey>;
  let errorCode: number;

  // Small amounts on both sides at a price of 1
  const liquidity = MIN_LP_AMOUNT.muln(2);
  const sqrtPrice = new BN(1).shln(64);

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const meme1Mint = createToken(svm, admin.publicKey, admin.publicKey);
    mintSplTokenTo(svm, meme1Mint, admin, creator.publicKey);

    const meme2Mint = createToken(svm, admin.publicKey, admin.publicKey);
    mintSplTokenTo(svm, meme2Mint, admin, creator.publicKey);

    wrapSOL(svm, creator, new BN(LAMPORTS_PER_SOL));

    createTokenAt(svm, USDC_MINT, admin.publicKey);
    mintSplTokenTo(svm, USDC_MINT, admin, creator.publicKey);

    mints = {
      WSOL: NATIVE_MINT,
      USDC: USDC_MINT,
      MEME_1: meme1Mint,
      MEME_2: meme2Mint,
    };

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([OperatorPermission.CreateConfigKey]),
    });

    errorCode = getCpAmmProgramErrorCode(
      "UnsupportedTokenOrderForCollectFeeMode"
    );
  });

  function poolFees(collectFeeMode: number): PoolFeesParams {
    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    return {
      baseFee: {
        data: Array.from(data),
      },
      compoundingFeeBps: collectFeeMode === COMPOUNDING ? 5000 : 0,
      padding: 0,
      dynamicFee: null,
    };
  }

  function priceRange(collectFeeMode: number) {
    return collectFeeMode === COMPOUNDING
      ? { sqrtMinPrice: new BN(0), sqrtMaxPrice: U128_MAX }
      : { sqrtMinPrice: MIN_SQRT_PRICE, sqrtMaxPrice: MAX_SQRT_PRICE };
  }

  function randomConfigId() {
    return new BN(Math.floor(Math.random() * 1000));
  }

  const createWithStaticConfig: CreatePool = async (
    tokenAMint,
    tokenBMint,
    collectFeeMode,
    errorCode
  ) => {
    const createConfigParams: CreateConfigParams = {
      poolFees: poolFees(collectFeeMode),
      ...priceRange(collectFeeMode),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode,
    };
    const config = await createConfigIx(
      svm,
      whitelistedAccount,
      randomConfigId(),
      createConfigParams
    );

    const params: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };
    const { result } = await initializePool(svm, params);

    if (errorCode !== undefined) {
      expectThrowsErrorCode(result, errorCode);
    } else {
      expect(result).instanceOf(TransactionMetadata);
    }
  };

  const createWithDynamicConfig: CreatePool = async (
    tokenAMint,
    tokenBMint,
    collectFeeMode,
    errorCode
  ) => {
    const createDynamicConfigParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
    };
    const config = await createDynamicConfigIx(
      svm,
      whitelistedAccount,
      randomConfigId(),
      createDynamicConfigParams
    );

    const params: InitializePoolWithCustomizeConfigParams = {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      ...priceRange(collectFeeMode),
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: poolFees(collectFeeMode),
      activationType: 0,
      collectFeeMode,
    };
    await initializePoolWithCustomizeConfig(svm, params, errorCode);
  };

  const createCustomizable: CreatePool = async (
    tokenAMint,
    tokenBMint,
    collectFeeMode,
    errorCode
  ) => {
    const params: InitializeCustomizablePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      ...priceRange(collectFeeMode),
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: poolFees(collectFeeMode),
      activationType: 0,
      collectFeeMode,
    };
    await initializeCustomizablePool(svm, params, errorCode);
  };

  const endpoints: [string, CreatePool][] = [
    ["initialize_pool", createWithStaticConfig],
    ["initialize_pool_with_dynamic_config", createWithDynamicConfig],
    ["initialize_customizable_pool", createCustomizable],
  ];

  for (const [endpoint, createPool] of endpoints) {
    describe(endpoint, () => {
      for (const scenario of scenarios) {
        it(scenario.name, async () => {
          await createPool(
            mints[scenario.base],
            mints[scenario.quote],
            scenario.collectFeeMode,
            scenario.allowed ? undefined : errorCode
          );
        });
      }
    });
  }
});
