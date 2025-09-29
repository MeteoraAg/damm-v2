import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
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
} from "./bankrun-utils";
import {
  convertToByteArray,
  generateKpAndFund,
  randomID,
  startTest,
} from "./bankrun-utils/common";
import { shlDiv } from "./bankrun-utils/math";
import {
  BaseFeeMode,
  encodeFeeMarketCapSchedulerParams,
  encodeFeeTimeSchedulerParams,
} from "./bankrun-utils/feeCodec";

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
    whitelistedAccount = await generateKpAndFund(
      context.banksClient,
      context.payer
    );

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
        padding: [],
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

    await createOperator(context.banksClient, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });
  });

  it("Admin create config", async () => {
    await createConfigIx(
      context.banksClient,
      whitelistedAccount,
      index,
      createConfigParams
    );
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
    };

    await createConfigIx(
      context.banksClient,
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
        padding: [],
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
      context.banksClient,
      whitelistedAccount,
      new BN(Math.floor(Math.random() * 1000)),
      createConfigParams
    );
  });
});
