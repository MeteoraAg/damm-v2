import { Keypair, PublicKey } from "@solana/web3.js";
import {
  closeTokenBadge,
  createOperator,
  createTokenBadge,
  encodePermissions,
  OperatorPermission,
  startSvm,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import {
  createPermenantDelegateExtensionWithInstruction,
  createToken2022,
} from "./helpers/token2022";
import { LiteSVM } from "litesvm";

describe("Admin function: Create token badge", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
  let tokenAMint: PublicKey;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    tokenAMint = tokenAMintKeypair.publicKey;

    const extensions = [
      createPermenantDelegateExtensionWithInstruction(
        tokenAMint,
        admin.publicKey
      ),
    ];

    await createToken2022(svm, extensions, tokenAMintKeypair, admin.publicKey);

    let permission = encodePermissions([
      OperatorPermission.CreateTokenBadge,
      OperatorPermission.CloseTokenBadge,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });
  });

  it("Admin create token badge", async () => {
    await createTokenBadge(svm, {
      tokenMint: tokenAMint,
      whitelistedAddress: whitelistedAccount,
    });
  });

  it("Admin close token badge", async () => {
    await createTokenBadge(svm, {
      tokenMint: tokenAMint,
      whitelistedAddress: whitelistedAccount,
    });
    await closeTokenBadge(svm, {
      tokenMint: tokenAMint,
      whitelistedAddress: whitelistedAccount,
    });
  });
});
