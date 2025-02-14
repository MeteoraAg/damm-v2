import { BN } from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  startTest,
} from "./bankrun-utils/common";
import { PublicKey } from "@solana/web3.js";
import { wrapSOL } from "./bankrun-utils/token";

describe("Admin update parameters", () => {
  let context: ProgramTestContext;

  

  beforeEach(async () => {
    context = await startTest();
  });

  describe("Admin config", () => {
    it("Admin create config", async () => {
        
    });

    it("Admin create config with dynamic fee", async () => {});

    it("Admin close config", async () => {});
  });
});
