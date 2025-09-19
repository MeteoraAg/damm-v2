import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  BASIS_POINT_MAX,
  buildMarketCapBaseFeeParams,
  closeConfigIx,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  encodePermissions,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  OFFSET,
  OperatorPermission,
} from "./bankrun-utils";
import {
  convertToByteArray,
  generateKpAndFund,
  randomID,
  startTest,
} from "./bankrun-utils/common";
import { shlDiv } from "./bankrun-utils/math";

describe("Admin function: Create config", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
  let createConfigParams: CreateConfigParams;
  let index;

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);
    admin = await generateKpAndFund(context.banksClient, context.payer);
    whitelistedAccount = await generateKpAndFund(context.banksClient, context.payer);
    createConfigParams = {
      poolFees: {
        baseFee: {
          zeroFactor: new BN(2_500_000).toArray("le", 8),
          firstFactor: 0,
          secondFactor: convertToByteArray(new BN(0)),
          thirdFactor: new BN(0),
          baseFeeMode: 0,
        },
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
      minSqrtPriceIndex: new BN(0),
    };
    index = new BN(randomID())
    let permission = encodePermissions([OperatorPermission.CreateConfigKey, OperatorPermission.RemoveConfigKey])

    await createOperator(context.banksClient, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission
    })
  });

  it("Admin create config", async () => {
    await createConfigIx(context.banksClient, whitelistedAccount, index, createConfigParams);
  });

  it("Admin close config", async () => {
    const config = await createConfigIx(
      context.banksClient,
      whitelistedAccount,
      index,
      createConfigParams
    );
    await closeConfigIx(context.banksClient, whitelistedAccount, config);
  });

  it("Admin create config with dynamic fee", async () => {
    // params
    const binStep = new BN(1);
    const binStepU128 = shlDiv(binStep, new BN(BASIS_POINT_MAX), OFFSET);
    const decayPeriod = 5_000;
    const filterPeriod = 2_000;
    const reductionFactor = 5_000;
    const maxVolatilityAccumulator = 350_000;
    const variableFeeControl = 10_000;

    //
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          zeroFactor: new BN(2_500_000).toArray("le", 8),
          firstFactor: 0,
          secondFactor: convertToByteArray(new BN(0)),
          thirdFactor: new BN(0),
          baseFeeMode: 0,
        },
        padding: [],
        dynamicFee: {
          binStep: binStep.toNumber(),
          binStepU128,
          filterPeriod,
          decayPeriod,
          reductionFactor,
          maxVolatilityAccumulator,
          variableFeeControl,
        },
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
      minSqrtPriceIndex: new BN(0),
    };

    await createConfigIx(
      context.banksClient,
      admin,
      new BN(Math.floor(Math.random() * 1000)),
      createConfigParams
    );
  });

  it("Admin create config with market cap based fee scheduler", async () => {
    // params
    const minSqrtPrice = new BN("4880549731789001291");
    const maxSqrtPrice = new BN("12236185739241331242");

    const minSqrtPriceIndex = minSqrtPrice.div(MIN_SQRT_PRICE);
    const maxSqrtPriceIndex = maxSqrtPrice.div(MIN_SQRT_PRICE);

    const maxSqrtPriceDeltaVbps = new BN(10000);
    const reductionFactor = new BN(10);
    const schedulerExpirationDuration = new BN(3600);

    const cliffFeeNumerator = new BN(2_500_000);

    const baseFee = buildMarketCapBaseFeeParams(
      cliffFeeNumerator,
      maxSqrtPriceDeltaVbps,
      maxSqrtPriceIndex,
      schedulerExpirationDuration,
      reductionFactor,
      3
    );

    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee,
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
      minSqrtPriceIndex,
    };

    await createConfigIx(
      context.banksClient,
      admin,
      new BN(Math.floor(Math.random() * 1000)),
      createConfigParams
    );
  });
});
