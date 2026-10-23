import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  AccessRegistryOperatorPermission,
  closeTokenBadge,
  createAccessRegistryOperator,
  createAccessRegistryTokenBadge,
  createOperator,
  createToken,
  createTokenBadge,
  deriveAccessRegistryTokenBadge,
  deriveTokenBadgeAddress,
  encodePermissions,
  expectThrowsErrorCode,
  getCpAmmProgramErrorCode,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  setLegacyTokenBadge,
  startSvm,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  createPermenantDelegateExtensionWithInstruction,
  createToken2022,
  mintToToken2022,
} from "./helpers/token2022";

const invalidTokenBadge = getCpAmmProgramErrorCode("InvalidTokenBadge");
const deprecatedEndpoint = getCpAmmProgramErrorCode("DeprecatedEndpoint");
// Anchor ErrorCode::AccountOwnedByWrongProgram
const accountOwnedByWrongProgram = 3007;

describe("Token badge", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  // Token-2022 mint with PermanentDelegate: never permissionless, always needs a badge
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  function poolParams(
    tokenBadges?: PublicKey[]
  ): InitializeCustomizablePoolParams {
    const data = encodeFeeTimeSchedulerParams(
      BigInt(2_500_000),
      0,
      BigInt(0),
      BigInt(0),
      BaseFeeMode.FeeTimeSchedulerLinear
    );
    return {
      payer: creator,
      creator: creator.publicKey,
      tokenAMint,
      tokenBMint,
      poolFees: {
        baseFee: { data: Array.from(data) },
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      hasAlphaVault: false,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE),
      activationType: 0,
      collectFeeMode: 0,
      activationPoint: null,
      tokenBadges,
    };
  }

  beforeEach(async () => {
    svm = startSvm();
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    tokenAMint = tokenAMintKeypair.publicKey;
    await createToken2022(
      svm,
      [
        createPermenantDelegateExtensionWithInstruction(
          tokenAMint,
          admin.publicKey
        ),
      ],
      tokenAMintKeypair,
      admin.publicKey
    );
    tokenBMint = createToken(svm, admin.publicKey);

    mintToToken2022(svm, tokenAMint, admin, creator.publicKey);
    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission: encodePermissions([
        OperatorPermission.CreateTokenBadge,
        OperatorPermission.CloseTokenBadge,
      ]),
    });
    await createAccessRegistryOperator(
      svm,
      admin,
      whitelistedAccount.publicKey,
      [AccessRegistryOperatorPermission.CreateTokenBadge]
    );
  });

  describe("access-registry token badge", () => {
    it("creates a pool with an access-registry badge", async () => {
      const tokenBadge = await createAccessRegistryTokenBadge(
        svm,
        whitelistedAccount,
        tokenAMint
      );
      await initializeCustomizablePool(svm, poolParams([tokenBadge]));
    });

    it("ignores mint_score", async () => {
      const tokenBadge = await createAccessRegistryTokenBadge(
        svm,
        whitelistedAccount,
        tokenAMint,
        255
      );
      await initializeCustomizablePool(svm, poolParams([tokenBadge]));
    });

    it("rejects a pool without a badge", async () => {
      await initializeCustomizablePool(svm, poolParams(), invalidTokenBadge);
    });

    it("rejects a badge of another mint", async () => {
      const otherMint = createToken(svm, admin.publicKey);
      const tokenBadge = await createAccessRegistryTokenBadge(
        svm,
        whitelistedAccount,
        otherMint
      );
      await initializeCustomizablePool(
        svm,
        poolParams([tokenBadge]),
        invalidTokenBadge
      );
    });

    it("rejects a badge with the TokenBadge layout owned by another program", async () => {
      // same discriminator and token_mint as a real badge, but owned by
      // neither access-registry nor cp-amm
      const fakeBadge = Keypair.generate().publicKey;
      setLegacyTokenBadge(svm, fakeBadge, tokenAMint, TOKEN_PROGRAM_ID);
      await initializeCustomizablePool(
        svm,
        poolParams([fakeBadge]),
        accountOwnedByWrongProgram
      );
    });
  });

  describe("legacy cp-amm token badge", () => {
    it("create_token_badge is deprecated", async () => {
      const result = await createTokenBadge(svm, {
        tokenMint: tokenAMint,
        whitelistedAddress: whitelistedAccount,
      });
      expectThrowsErrorCode(result, deprecatedEndpoint);
      expect(svm.getAccount(deriveTokenBadgeAddress(tokenAMint))).to.be.null;
    });

    it("still creates a pool with a legacy badge", async () => {
      const tokenBadge = deriveTokenBadgeAddress(tokenAMint);
      setLegacyTokenBadge(svm, tokenBadge, tokenAMint);
      await initializeCustomizablePool(svm, poolParams([tokenBadge]));
    });

    it("rejects a legacy badge of another mint", async () => {
      const otherMint = createToken(svm, admin.publicKey);
      const tokenBadge = deriveTokenBadgeAddress(otherMint);
      setLegacyTokenBadge(svm, tokenBadge, otherMint);
      await initializeCustomizablePool(
        svm,
        poolParams([tokenBadge]),
        invalidTokenBadge
      );
    });

    it("operator closes a legacy badge", async () => {
      setLegacyTokenBadge(svm, deriveTokenBadgeAddress(tokenAMint), tokenAMint);
      await closeTokenBadge(svm, {
        tokenMint: tokenAMint,
        whitelistedAddress: whitelistedAccount,
      });
      // the access-registry badge lives at a different address
      expect(svm.getAccount(deriveAccessRegistryTokenBadge(tokenAMint))).to.be
        .null;
    });
  });
});
