import { ProgramTestContext } from "solana-bankrun";
import { setupTestContext, startTest } from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createTokenBadge } from "./bankrun-utils";
import { ExtensionType } from "@solana/spl-token";

describe("Admin function: Create token badge", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let tokenMint: PublicKey;

  beforeEach(async () => {
    context = await startTest();
    const extensions = [ExtensionType.TransferFeeConfig];
    const prepareContext = await setupTestContext(
      context.banksClient,
      context.payer,
      true,
      extensions
    );
    admin = prepareContext.admin;
    tokenMint = prepareContext.tokenAMint;
  });

  it.skip("Create token badge", async () => {
    await createTokenBadge(context.banksClient, { tokenMint, admin });
  });
});
