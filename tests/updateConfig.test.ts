import { BN } from "bn.js";
import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  createUsersAndFund,
  startTest,
} from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createConfigIx,
  CreateConfigParams,
  U128_MAX,
  updateConfig,
  updatePoolFee,
} from "./bankrun-utils";

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

  it("Update config", async () => {
    const config = await createConfigIx(
      context.banksClient,
      admin,
      createConfigParams
    );

    // update activation type
    await updateConfig(context.banksClient, admin, config, 0, 1);

    // update collect fee mode
    await updateConfig(context.banksClient, admin, config, 1, 1);
  });

  it("Update pool fee config", async () => {
    const config = await createConfigIx(
      context.banksClient,
      admin,
      createConfigParams
    );

    // update trade fee numerator
    await updatePoolFee(context.banksClient, admin, config, 0, new BN(5_000_000))

    // update protocol fee percent
    await updatePoolFee(context.banksClient, admin, config, 1, new BN(5))

    // update partner fee percent
    await updatePoolFee(context.banksClient, admin, config, 2, new BN(5))

    // update referral fee percent
    await updatePoolFee(context.banksClient, admin, config, 3, new BN(5))
  });
});
