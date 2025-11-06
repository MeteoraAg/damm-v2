import { generateKpAndFund } from "./helpers/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  createToken,
  mintSplTokenTo,
  createDynamicConfigIx,
  CreateDynamicConfigParams,
  InitializePoolWithCustomizeConfigParams,
  initializePoolWithCustomizeConfig,
  encodePermissions,
  createOperator,
  OperatorPermission,
  startSvm,
} from "./helpers";
import BN from "bn.js";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Dynamic config test", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  const configId = Math.floor(Math.random() * 1000);

  beforeEach(async () => {
    svm = startSvm();
    creator = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);
    // create dynamic config
    const createDynamicConfigParams: CreateDynamicConfigParams = {
      poolCreatorAuthority: creator.publicKey,
    };

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createDynamicConfigIx(
      svm,
      whitelistedAccount,
      new BN(configId),
      createDynamicConfigParams
    );
  });

  it("create pool with dynamic config", async () => {
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

    const params: InitializePoolWithCustomizeConfigParams = {
      payer: creator,
      creator: creator.publicKey,
      poolCreatorAuthority: creator,
      customizeConfigAddress: config,
      tokenAMint,
      tokenBMint,
      liquidity: MIN_LP_AMOUNT,
      sqrtPrice: MIN_SQRT_PRICE,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      hasAlphaVault: false,
      activationPoint: null,
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        padding: [],
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
    };

    const { pool: _pool } = await initializePoolWithCustomizeConfig(
      svm,
      params
    );
  });
});
