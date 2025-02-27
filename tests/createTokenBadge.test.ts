import { BN } from "bn.js";
import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  LOCAL_ADMIN_KEYPAIR,
  createUsersAndFund,
  randomID,
  setupTestContext,
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
  createTokenBadge,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  OFFSET,
} from "./bankrun-utils";
import { shlDiv } from "./bankrun-utils/math";

describe("Admin function: Create config", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let tokenMint: PublicKey;

  beforeEach(async () => {
    context = await startTest();
    context = await startTest();
    const prepareContext = await setupTestContext(
      context.banksClient,
      context.payer,
      false
    );
    admin = prepareContext.admin;
    tokenMint = prepareContext.tokenAMint;
  });

  it.skip("Create token badge", async () => {
    await createTokenBadge(context.banksClient, { tokenMint, admin });
  });
});
