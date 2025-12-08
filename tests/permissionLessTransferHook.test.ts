import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  createConfigIx,
  CreateConfigParams,
  createOperator,
  createToken,
  encodePermissions,
  expectThrowsErrorMessage,
  getCpAmmProgramErrorCode,
  getPool,
  initializePool,
  InitializePoolParams,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  setPoolStatus,
  startSvm,
} from "./helpers";
import { generateKpAndFund } from "./helpers/common";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import {
  createToken2022,
  createTransferHookExtensionWithInstruction,
  mintToToken2022,
  revokeAuthorityAndProgramIdTransferHook,
} from "./helpers/token2022";
import { createExtraAccountMetaListAndCounter } from "./helpers/transferHook";

describe("Permissionless transfer hook", () => {
  let svm: LiteSVM;
  let creator: Keypair;
  let admin: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;

  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  let liquidity: BN;
  let sqrtPrice: BN;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    const tokenAMintKeypair = Keypair.generate();
    const tokenBMintKeypair = Keypair.generate();

    tokenAMint = tokenAMintKeypair.publicKey;

    const tokenAExtensions = [
      createTransferHookExtensionWithInstruction(
        tokenAMintKeypair.publicKey,
        admin.publicKey
      ),
    ];

    await createToken2022(
      svm,
      tokenAExtensions,
      tokenAMintKeypair,
      admin.publicKey
    );
    tokenBMint = createToken(svm, admin.publicKey);

    mintToToken2022(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    await createExtraAccountMetaListAndCounter(svm, admin, tokenAMint);

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

    // create config
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

    let permission = encodePermissions([
      OperatorPermission.CreateConfigKey,
      OperatorPermission.SetPoolStatus,
    ]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
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

    const errorCode = getCpAmmProgramErrorCode("InvalidTokenBadge");
    await expectThrowsErrorMessage(async () => {
      await initializePool(svm, initPoolParams);
    }, "InvalidTokenBadge");

    // revoke program id

    await revokeAuthorityAndProgramIdTransferHook(svm, admin, tokenAMint);

    const { pool } = await initializePool(svm, initPoolParams);

    const newStatus = 1;
    await setPoolStatus(svm, {
      whitelistedAddress: whitelistedAccount,
      pool,
      status: newStatus,
    });
    const poolState = await getPool(svm, pool);
    expect(poolState.poolStatus).eq(newStatus);
  });
});
