import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BASIS_POINT_MAX,
  closeConfigIx,
  createConfigIx,
  CreateConfigParams,
  createOperator,
  encodePermissions,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  OFFSET,
  OperatorPermission,
  startSvm,
} from "./helpers";
import { generateKpAndFund, randomID } from "./helpers/common";
import { shlDiv } from "./helpers/math";
import {
  BaseFeeMode,
  encodeFeeMarketCapSchedulerParams,
  encodeFeeTimeSchedulerParams,
} from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";
import BN from "bn.js";

describe("Admin function: Create config", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
  let createConfigParams: CreateConfigParams;
  let index: BN;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

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

    createConfigParams = {
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
    index = new BN(randomID());
    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.RemoveConfigKey,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });
  });

  it("Admin create config", async () => {
    await createConfigIx(svm, whitelistedAccount, index, createConfigParams);
  });

  it("Admin close config", async () => {
    const config = await createConfigIx(
      svm,
      whitelistedAccount,
      index,
      createConfigParams
    );
    await closeConfigIx(svm, whitelistedAccount, config);
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

    const cliffFeeNumerator = new BN(2_500_000);
    const numberOfPeriod = new BN(0);
    const periodFrequency = new BN(0);

    const data = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      BigInt(periodFrequency.toString()),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

    //
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        compoundingFeeBps: 0,
        padding: 0,
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
    };

    await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(Math.floor(Math.random() * 1000)),
      createConfigParams
    );
  });

  it("Admin create config with market cap based fee scheduler", async () => {
    // params

    const priceStepBps = new BN(10);
    const reductionFactor = new BN(10);
    const numberOfPeriod = new BN(1000);
    const schedulerExpirationDuration = new BN(3600);

    const cliffFeeNumerator = new BN(2_500_000);

    const data = encodeFeeMarketCapSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      priceStepBps.toNumber(),
      schedulerExpirationDuration.toNumber(),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeMarketCapSchedulerLinear
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

    await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(Math.floor(Math.random() * 1000)),
      createConfigParams
    );
  });
});
