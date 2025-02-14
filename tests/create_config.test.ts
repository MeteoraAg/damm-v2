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
import { createConfigIx, CreateConfigParams } from "./bankrun-utils";

describe("Admin update parameters", () => {
  let context: ProgramTestContext;
  let admin: Keypair;

  beforeEach(async () => {
    context = await startTest();
    admin = Keypair.generate();
    transferSol(
      context.banksClient,
      context.payer,
      admin.publicKey,
      new BN(LAMPORTS_PER_SOL)
    );
  });

  describe("Admin config", () => {
    it("Admin create config", async () => {
      const createConfigParams: CreateConfigParams = {
        index: new BN(0),
        poolFees: {
          tradeFeeNumerator: new BN(1_000),
          protocolFeePercent: 10,
          partnerFeePercent: 5,
          referralFeePercent: 0,
          dynamicFee: null,
        },
        sqrtMinPrice: new BN(1),
        sqrtMaxPrice: new BN(10),
        vaultConfigKey: PublicKey.default,
        poolCreatorAuthority: PublicKey.default,
        activationType: 0,
        collectFeeMode: 0,
      };

      const config = await createConfigIx(
        context.banksClient,
        admin,
        createConfigParams
      );
      console.log("config: ", config);
    });

    it("Admin create config with dynamic fee", async () => {});

    it("Admin close config", async () => {});
  });
});
