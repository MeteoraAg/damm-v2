import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
  convertToByteArray,
  expectThrowsAsync,
  generateKpAndFund,
  startTest,
} from "./bankrun-utils/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createConfigIx,
  CreateConfigParams,
  getPool,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  setPoolStatus,
  createToken,
  mintSplTokenTo,
  getCpAmmProgramErrorCodeHexString,
} from "./bankrun-utils";
import BN from "bn.js";
import {
  createToken2022,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
  revokeAuthorityAndProgramIdTransferHook,
} from "./bankrun-utils/token2022";
import { createExtraAccountMetaListAndCounter } from "./bankrun-utils/transferHook";

describe("Permissionless transfer hook", () => {
  let context: ProgramTestContext;
  let creator: Keypair;
  let config: PublicKey;

  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  let liquidity: BN;
  let sqrtPrice: BN;
  let admin: Keypair;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    const root = Keypair.generate();
    context = await startTest(root);

    const tokenAMintKeypair = Keypair.generate();
    const tokenBMintKeypair = Keypair.generate();

    tokenAMint = tokenAMintKeypair.publicKey;

    const tokenAExtensions = [
      createTransferHookExtensionWithInstruction(
        tokenAMintKeypair.publicKey,
        context.payer.publicKey
      ),
    ];

    creator = await generateKpAndFund(context.banksClient, context.payer);
    admin = await generateKpAndFund(context.banksClient, context.payer);

    await createToken2022(
      context.banksClient,
      context.payer,
      tokenAExtensions,
      tokenAMintKeypair
    );
    tokenBMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    await mintToToken2022(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      creator.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenBMint,
      context.payer,
      creator.publicKey
    );

    await createExtraAccountMetaListAndCounter(
      context.banksClient,
      admin,
      tokenAMint
    );
    // create config
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          cliffFeeNumerator: new BN(2_500_000),
          firstFactor: 0,
          secondFactor: convertToByteArray(new BN(0)),
          thirdFactor: new BN(0),
          baseFeeMode: 0,
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

    config = await createConfigIx(
      context.banksClient,
      admin,
      new BN(configId),
      createConfigParams
    );
  });

  it("Initialize pool with permission less transfer hook", async () => {
    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE);

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };

    const errorCode = getCpAmmProgramErrorCodeHexString("InvalidTokenBadge");
    await expectThrowsAsync(async () => {
      await initializePool(context.banksClient, initPoolParams);
    }, errorCode);

    // revoke program id

    await revokeAuthorityAndProgramIdTransferHook(
      context.banksClient,
      context.payer,
      tokenAMint
    );

    const { pool } = await initializePool(context.banksClient, initPoolParams);

    const newStatus = 1;
    await setPoolStatus(context.banksClient, {
      admin,
      pool,
      status: newStatus,
    });
    const poolState = await getPool(context.banksClient, pool);
    expect(poolState.poolStatus).eq(newStatus);
  });
});
