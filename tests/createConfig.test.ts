import { BN } from "bn.js";
import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  startTest,
  transferSol,
} from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { wrapSOL } from "./bankrun-utils/token";
import {
  BASIS_POINT_MAX,
  closeConfigIx,
  createConfigIx,
  CreateConfigParams,
  OFFSET,
  U128_MAX,
  U64_MAX,
} from "./bankrun-utils";
import { shlDiv } from "./bankrun-utils/math";

describe("Admin function: Create config", () => {
  let context: ProgramTestContext;
  const configId = Math.floor(Math.random() * 1000);
  let admin: Keypair;
  let createConfigParams: CreateConfigParams;

  beforeEach(async () => {
    context = await startTest();
    admin = await createUsersAndFund(context.banksClient, context.payer);

    createConfigParams = {
      index: new BN(configId),
      poolFees: {
        tradeFeeNumerator: new BN(2_500_000),
        protocolFeePercent: 10,
        partnerFeePercent: 0,
        referralFeePercent: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(0),
      sqrtMaxPrice: new BN(U128_MAX),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
    };
  });

  it("Admin create config", async () => {
    await createConfigIx(context.banksClient, admin, createConfigParams);
  });

  it("Admin close config", async () => {
    const config = await createConfigIx(
      context.banksClient,
      admin,
      createConfigParams
    );
    await closeConfigIx(context.banksClient, admin, config, admin.publicKey);
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
      index: new BN(Math.floor(Math.random() * 1000)),
      poolFees: {
        tradeFeeNumerator: new BN(2_500_000),
        protocolFeePercent: 10,
        partnerFeePercent: 0,
        referralFeePercent: 0,
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
      sqrtMinPrice: new BN(0),
      sqrtMaxPrice: new BN(U128_MAX),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
    };

    await createConfigIx(context.banksClient, admin, createConfigParams);
  });
});
