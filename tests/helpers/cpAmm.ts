import {
  AnchorProvider,
  BN,
  IdlAccounts,
  IdlTypes,
  Program,
  Wallet,
} from "@coral-xyz/anchor";
import {
  ACCOUNT_SIZE,
  ACCOUNT_TYPE_SIZE,
  AccountLayout,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getExtensionData,
  MetadataPointerLayout,
  TOKEN_2022_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
import {
  AccountInfo,
  AccountMeta,
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";
import Decimal from "decimal.js";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import CpAmmIDL from "../../target/idl/cp_amm.json";
import { CpAmm } from "../../target/types/cp_amm";
import {
  deriveClaimFeeOperatorAddress,
  deriveConfigAddress,
  deriveCustomizablePoolAddress,
  deriveEventAuthority,
  deriveOperatorAddress,
  derivePoolAddress,
  derivePoolAuthority,
  derivePositionAddress,
  derivePositionNftAccount,
  deriveRewardVaultAddress,
  deriveTokenBadgeAddress,
  deriveTokenVaultAddress,
} from "./accounts";
import { convertToByteArray } from "./common";
import {
  BASIS_POINT_MAX,
  BIN_STEP_BPS_DEFAULT,
  BIN_STEP_BPS_U128_DEFAULT,
  CP_AMM_PROGRAM_ID,
  DYNAMIC_FEE_DECAY_PERIOD_DEFAULT,
  DYNAMIC_FEE_FILTER_PERIOD_DEFAULT,
  DYNAMIC_FEE_REDUCTION_FACTOR_DEFAULT,
  MAX_PRICE_CHANGE_BPS_DEFAULT,
  NATIVE_MINT,
  ONE,
} from "./constants";
import {
  BaseFeeMode,
  decodeFeeMarketCapSchedulerParams,
  decodeFeeRateLimiterParams,
  decodeFeeTimeSchedulerParams,
  decodePodAlignedFeeMarketCapScheduler,
  decodePodAlignedFeeRateLimiter,
  decodePodAlignedFeeTimeScheduler,
} from "./feeCodec";
import { sendTransaction } from "./svm";
import { getOrCreateAssociatedTokenAccount, wrapSOL } from "./token";

export type Pool = IdlAccounts<CpAmm>["pool"];
export type Position = IdlAccounts<CpAmm>["position"];
export type Vesting = IdlAccounts<CpAmm>["vesting"];
export type Config = IdlAccounts<CpAmm>["config"];
export type LockPositionParams = IdlTypes<CpAmm>["vestingParameters"];
export type TokenBadge = IdlAccounts<CpAmm>["tokenBadge"];

export function getSecondKey(key1: PublicKey, key2: PublicKey) {
  const buf1 = key1.toBuffer();
  const buf2 = key2.toBuffer();
  // Buf1 > buf2
  if (Buffer.compare(buf1, buf2) === 1) {
    return buf2;
  }
  return buf1;
}

export function getFirstKey(key1: PublicKey, key2: PublicKey) {
  const buf1 = key1.toBuffer();
  const buf2 = key2.toBuffer();
  // Buf1 > buf2
  if (Buffer.compare(buf1, buf2) === 1) {
    return buf1;
  }
  return buf2;
}

// For create program instruction only
export function createCpAmmProgram() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  const program = new Program<CpAmm>(CpAmmIDL as CpAmm, provider);
  return program;
}

export type DynamicFee = {
  binStep: number;
  binStepU128: BN;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
};

export type BaseFee = {
  data: number[];
};

export type PoolFees = {
  baseFee: BaseFee;
  padding: number[];
  dynamicFee: DynamicFee | null;
};

export type CreateConfigParams = {
  poolFees: PoolFees;
  sqrtMinPrice: BN;
  sqrtMaxPrice: BN;
  vaultConfigKey: PublicKey;
  poolCreatorAuthority: PublicKey;
  activationType: number; // 0: slot, 1: timestamp
  collectFeeMode: number; // 0: BothToken, 1: OnlyTokenB
};

export type CreateDynamicConfigParams = {
  poolCreatorAuthority: PublicKey;
};

export async function createDynamicConfigIx(
  svm: LiteSVM,
  whitelistedAddress: Keypair,
  index: BN,
  params: CreateDynamicConfigParams
): Promise<PublicKey> {
  const program = createCpAmmProgram();
  const config = deriveConfigAddress(index);
  const transaction = await program.methods
    .createDynamicConfig(index, params)
    .accountsPartial({
      config,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      payer: whitelistedAddress.publicKey,
      whitelistedAddress: whitelistedAddress.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);

  expect(result).instanceOf(TransactionMetadata);

  // Check data
  const configState = getConfig(svm, config);
  expect(configState.poolCreatorAuthority.toString()).eq(
    params.poolCreatorAuthority.toString()
  );

  expect(configState.configType).eq(1); // ConfigType: Dynamic

  return config;
}

export async function createConfigIx(
  svm: LiteSVM,
  whitelistedAddress: Keypair,
  index: BN,
  params: CreateConfigParams
): Promise<PublicKey> {
  const program = createCpAmmProgram();

  const config = deriveConfigAddress(index);

  const transaction = await program.methods
    .createConfig(index, params)
    .accountsPartial({
      config,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      payer: whitelistedAddress.publicKey,
      whitelistedAddress: whitelistedAddress.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);

  expect(result).instanceOf(TransactionMetadata);

  // Check data
  const configState = getConfig(svm, config);
  expect(configState.vaultConfigKey.toString()).eq(
    params.vaultConfigKey.toString()
  );
  expect(configState.poolCreatorAuthority.toString()).eq(
    params.poolCreatorAuthority.toString()
  );
  expect(configState.activationType).eq(params.activationType);
  expect(configState.collectFeeMode).eq(params.collectFeeMode);
  expect(configState.sqrtMinPrice.toNumber()).eq(
    params.sqrtMinPrice.toNumber()
  );
  expect(configState.sqrtMaxPrice.toString()).eq(
    params.sqrtMaxPrice.toString()
  );

  // Check the offset at base_fee_serde.rs
  const baseFeeModeInParams = params.poolFees.baseFee.data[26];
  const baseFeeModeInConfig = configState.poolFees.baseFee.data[8];

  expect(baseFeeModeInConfig).eq(baseFeeModeInParams);
  const baseFeeMode: BaseFeeMode = baseFeeModeInParams;

  switch (baseFeeMode) {
    case BaseFeeMode.FeeTimeSchedulerLinear:
    case BaseFeeMode.FeeTimeSchedulerExponential:
      const feeTimeSchedulerParams = decodeFeeTimeSchedulerParams(
        Buffer.from(params.poolFees.baseFee.data)
      );

      const podAlignedFeeTimeScheduler = decodePodAlignedFeeTimeScheduler(
        Buffer.from(configState.poolFees.baseFee.data)
      );

      expect(feeTimeSchedulerParams.baseFeeMode).eq(
        podAlignedFeeTimeScheduler.baseFeeMode
      );
      expect(feeTimeSchedulerParams.cliffFeeNumerator.toString()).eq(
        podAlignedFeeTimeScheduler.cliffFeeNumerator.toString()
      );
      expect(feeTimeSchedulerParams.numberOfPeriod).eq(
        podAlignedFeeTimeScheduler.numberOfPeriod
      );
      expect(feeTimeSchedulerParams.periodFrequency.toString()).eq(
        podAlignedFeeTimeScheduler.periodFrequency.toString()
      );
      expect(feeTimeSchedulerParams.reductionFactor.toString()).eq(
        podAlignedFeeTimeScheduler.reductionFactor.toString()
      );
      break;
    case BaseFeeMode.FeeMarketCapSchedulerExponential:
    case BaseFeeMode.FeeMarketCapSchedulerLinear:
      const marketCapSchedulerParams = decodeFeeMarketCapSchedulerParams(
        Buffer.from(params.poolFees.baseFee.data)
      );

      const podAlignedMarketCapScheduler =
        decodePodAlignedFeeMarketCapScheduler(
          Buffer.from(configState.poolFees.baseFee.data)
        );

      expect(marketCapSchedulerParams.baseFeeMode).eq(
        podAlignedMarketCapScheduler.baseFeeMode
      );
      expect(marketCapSchedulerParams.cliffFeeNumerator.toString()).eq(
        podAlignedMarketCapScheduler.cliffFeeNumerator.toString()
      );
      expect(marketCapSchedulerParams.numberOfPeriod).eq(
        podAlignedMarketCapScheduler.numberOfPeriod
      );
      expect(marketCapSchedulerParams.priceStepBps).eq(
        podAlignedMarketCapScheduler.priceStepBps
      );
      expect(marketCapSchedulerParams.schedulerExpirationDuration).eq(
        podAlignedMarketCapScheduler.schedulerExpirationDuration
      );
      expect(marketCapSchedulerParams.reductionFactor.toString()).eq(
        podAlignedMarketCapScheduler.reductionFactor.toString()
      );

      break;
    case BaseFeeMode.RateLimiter:
      const rateLimiterParams = decodeFeeRateLimiterParams(
        Buffer.from(params.poolFees.baseFee.data)
      );

      const podAlignedRateLimiter = decodePodAlignedFeeRateLimiter(
        Buffer.from(configState.poolFees.baseFee.data)
      );

      expect(rateLimiterParams.baseFeeMode).eq(
        podAlignedRateLimiter.baseFeeMode
      );
      expect(rateLimiterParams.cliffFeeNumerator.toString()).eq(
        podAlignedRateLimiter.cliffFeeNumerator.toString()
      );
      expect(rateLimiterParams.feeIncrementBps).eq(
        podAlignedRateLimiter.feeIncrementBps
      );
      expect(rateLimiterParams.maxLimiterDuration).eq(
        podAlignedRateLimiter.maxLimiterDuration
      );
      expect(rateLimiterParams.referenceAmount.toString()).eq(
        podAlignedRateLimiter.referenceAmount.toString()
      );
      break;
    default:
      throw new Error("Unreachable");
  }
  expect(configState.poolFees.protocolFeePercent).eq(20);
  expect(configState.poolFees.partnerFeePercent).eq(0);
  expect(configState.poolFees.referralFeePercent).eq(20);
  expect(configState.configType).eq(0); // ConfigType: Static

  return config;
}

export async function closeConfigIx(
  svm: LiteSVM,
  whitelistedAddress: Keypair,
  config: PublicKey
) {
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .closeConfig()
    .accountsPartial({
      config,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      whitelistedAddress: whitelistedAddress.publicKey,
      rentReceiver: whitelistedAddress.publicKey,
    })
    .transaction();
  const result = sendTransaction(svm, transaction, [whitelistedAddress]);
  expect(result).instanceOf(TransactionMetadata);

  const configState = svm.getAccount(config);
  expect(configState.data.length).eq(0);
}

export type CreateTokenBadgeParams = {
  tokenMint: PublicKey;
  whitelistedAddress: Keypair;
};

export async function createTokenBadge(
  svm: LiteSVM,
  params: CreateTokenBadgeParams
) {
  const { tokenMint, whitelistedAddress } = params;
  const program = createCpAmmProgram();
  const tokenBadge = deriveTokenBadgeAddress(tokenMint);
  const transaction = await program.methods
    .createTokenBadge()
    .accountsPartial({
      tokenBadge,
      tokenMint,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      whitelistedAddress: whitelistedAddress.publicKey,
      payer: whitelistedAddress.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);
  expect(result).instanceOf(TransactionMetadata);

  const tokenBadgeState = getTokenBadge(svm, tokenBadge);

  expect(tokenBadgeState.tokenMint.toString()).eq(tokenMint.toString());
}

export type CloseTokenBadgeParams = {
  tokenMint: PublicKey;
  whitelistedAddress: Keypair;
};

export async function closeTokenBadge(
  svm: LiteSVM,
  params: CloseTokenBadgeParams
) {
  const { tokenMint, whitelistedAddress } = params;
  const program = createCpAmmProgram();
  const tokenBadge = deriveTokenBadgeAddress(tokenMint);
  const transaction = await program.methods
    .closeTokenBadge()
    .accountsPartial({
      tokenBadge,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      whitelistedAddress: whitelistedAddress.publicKey,
      rentReceiver: whitelistedAddress.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);
  expect(result).instanceOf(TransactionMetadata);
  const tokenBadgeAccount = svm.getAccount(tokenBadge);
  expect(tokenBadgeAccount.data.length).eq(0);
}

export type ClaimFeeOperatorParams = {
  whitelistedAddress: Keypair;
  claimFeeOperatorAddress: PublicKey;
};
export async function createClaimFeeOperator(
  svm: LiteSVM,
  params: ClaimFeeOperatorParams
) {
  const program = createCpAmmProgram();
  const { whitelistedAddress, claimFeeOperatorAddress } = params;

  const claimFeeOperator = deriveClaimFeeOperatorAddress(
    claimFeeOperatorAddress
  );
  const transaction = await program.methods
    .createClaimFeeOperator()
    .accountsPartial({
      claimFeeOperator,
      claimFeeOperatorAddress,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      payer: whitelistedAddress.publicKey,
      whitelistedAddress: whitelistedAddress.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);

  expect(result).instanceOf(TransactionMetadata);
}

export enum OperatorPermission {
  CreateConfigKey, // 0
  RemoveConfigKey, // 1
  CreateTokenBadge, // 2
  CloseTokenBadge, // 3
  SetPoolStatus, // 4
  CreateClaimProtocolFeeOperator, // 5
  CloseClaimProtocolFeeOperator, // 6
  InitializeReward, // 7
  UpdateRewardDuration, // 8
  UpdateRewardFunder, // 9
  UpdatePoolFees, // 10
}

export function encodePermissions(permissions: OperatorPermission[]): BN {
  return permissions.reduce((acc, perm) => {
    return acc.or(new BN(1).shln(perm));
  }, new BN(0));
}

export type CreateOperatorParams = {
  admin: Keypair;
  whitelistAddress: PublicKey;
  permission: BN;
};
export async function createOperator(
  svm: LiteSVM,
  params: CreateOperatorParams
) {
  const program = createCpAmmProgram();
  const { admin, permission, whitelistAddress } = params;

  const transaction = await program.methods
    .createOperatorAccount(permission)
    .accountsPartial({
      operator: deriveOperatorAddress(whitelistAddress),
      whitelistedAddress: whitelistAddress,
      admin: admin.publicKey,
      payer: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [admin]);

  expect(result).instanceOf(TransactionMetadata);
}

export type CloseFeeOperatorParams = {
  whitelistedAddress: Keypair;
  operator: PublicKey;
  rentReceiver: PublicKey;
};
export async function closeClaimFeeOperator(
  svm: LiteSVM,
  params: CloseFeeOperatorParams
) {
  const program = createCpAmmProgram();
  const { whitelistedAddress, operator, rentReceiver } = params;
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator);
  const transaction = await program.methods
    .closeClaimFeeOperator()
    .accountsPartial({
      claimFeeOperator,
      rentReceiver,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),
      whitelistedAddress: whitelistedAddress.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);
  expect(result).instanceOf(TransactionMetadata);

  const account = svm.getAccount(claimFeeOperator);

  expect(account.data.length).eq(0);
}

export type UpdatePoolFeesParams = {
  pool: PublicKey;
  whitelistedOperator: Keypair;
  cliffFeeNumerator: BN | null;
  dynamicFee: DynamicFee | null;
};

export async function updatePoolFeesParameters(
  svm: LiteSVM,
  params: UpdatePoolFeesParams
): Promise<TransactionMetadata | FailedTransactionMetadata> {
  const { pool, whitelistedOperator, cliffFeeNumerator, dynamicFee } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .updatePoolFees({
      cliffFeeNumerator,
      dynamicFee,
    })
    .accountsPartial({
      pool,
      operator: deriveOperatorAddress(whitelistedOperator.publicKey),
      whitelistedAddress: whitelistedOperator.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedOperator]);
  return result;
}

export type ClaimProtocolFeeParams = {
  claimFeeOperator: Keypair;
  pool: PublicKey;
  treasury: PublicKey;
};
export async function claimProtocolFee(
  svm: LiteSVM,
  params: ClaimProtocolFeeParams
) {
  const program = createCpAmmProgram();
  const { claimFeeOperator, pool, treasury } = params;
  const poolAuthority = derivePoolAuthority();
  const claimFeeOperatorAddress = deriveClaimFeeOperatorAddress(
    claimFeeOperator.publicKey
  );
  const poolState = getPool(svm, pool);

  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;
  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;

  const tokenAVaultAccount = svm.getAccount(
    poolState.tokenAVault
  ) as AccountInfo<Buffer>;

  const tokenBVaultAccount = svm.getAccount(
    poolState.tokenBVault
  ) as AccountInfo<Buffer>;

  const tokenAVaultState = unpackAccount(
    poolState.tokenAVault,
    tokenAVaultAccount,
    tokenAProgram
  );

  const tokenBVaultState = unpackAccount(
    poolState.tokenBVault,
    tokenBVaultAccount,
    tokenBProgram
  );

  const protocolFeeA = tokenAVaultState.isFrozen
    ? new BN(0)
    : poolState.protocolAFee;

  const protocolFeeB = tokenBVaultState.isFrozen
    ? new BN(0)
    : poolState.protocolBFee;

  const tokenAAccount = getOrCreateAssociatedTokenAccount(
    svm,
    claimFeeOperator,
    poolState.tokenAMint,
    treasury,
    tokenAProgram
  );

  const tokenBAccount = getOrCreateAssociatedTokenAccount(
    svm,
    claimFeeOperator,
    poolState.tokenBMint,
    treasury,
    tokenBProgram
  );

  const transaction = await program.methods
    .claimProtocolFee(protocolFeeA, protocolFeeB)
    .accountsPartial({
      poolAuthority,
      pool,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAAccount,
      tokenBAccount,
      claimFeeOperator: claimFeeOperatorAddress,
      operator: claimFeeOperator.publicKey,
      tokenAProgram,
      tokenBProgram,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [claimFeeOperator]);
  expect(result).instanceOf(TransactionMetadata);
}

export type ClaimPartnerFeeParams = {
  partner: Keypair;
  pool: PublicKey;
  maxAmountA: BN;
  maxAmountB: BN;
};
export async function claimPartnerFee(
  svm: LiteSVM,
  params: ClaimPartnerFeeParams
) {
  const program = createCpAmmProgram();
  const { partner, pool, maxAmountA, maxAmountB } = params;
  const poolAuthority = derivePoolAuthority();
  const poolState = getPool(svm, pool);
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;
  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;
  const tokenAAccount = getOrCreateAssociatedTokenAccount(
    svm,
    partner,
    poolState.tokenAMint,
    partner.publicKey,
    tokenAProgram
  );

  const tokenBAccount = getOrCreateAssociatedTokenAccount(
    svm,
    partner,
    poolState.tokenBMint,
    partner.publicKey,
    tokenBProgram
  );
  const transaction = await program.methods
    .claimPartnerFee(maxAmountA, maxAmountB)
    .accountsPartial({
      poolAuthority,
      pool,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAAccount,
      tokenBAccount,
      partner: partner.publicKey,
      tokenAProgram,
      tokenBProgram,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [partner]);

  expect(result).instanceOf(TransactionMetadata);
}

export type InitializePoolParams = {
  payer: Keypair;
  creator: PublicKey;
  config: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  liquidity: BN;
  sqrtPrice: BN;
  activationPoint: BN | null;
};

export async function initializePool(
  svm: LiteSVM,
  params: InitializePoolParams
): Promise<{
  pool: PublicKey;
  position: PublicKey;
  result: TransactionMetadata | FailedTransactionMetadata;
}> {
  const {
    config,
    tokenAMint,
    tokenBMint,
    payer,
    creator,
    liquidity,
    sqrtPrice,
    activationPoint,
  } = params;
  const program = createCpAmmProgram();

  const poolAuthority = derivePoolAuthority();
  const pool = derivePoolAddress(config, tokenAMint, tokenBMint);

  const positionNftKP = Keypair.generate();
  const position = derivePositionAddress(positionNftKP.publicKey);
  const positionNftAccount = derivePositionNftAccount(positionNftKP.publicKey);

  const tokenAVault = deriveTokenVaultAddress(tokenAMint, pool);
  const tokenBVault = deriveTokenVaultAddress(tokenBMint, pool);

  const tokenAProgram = svm.getAccount(tokenAMint).owner;
  const tokenBProgram = svm.getAccount(tokenBMint).owner;

  const payerTokenA = getAssociatedTokenAddressSync(
    tokenAMint,
    payer.publicKey,
    true,
    tokenAProgram
  );
  const payerTokenB = getAssociatedTokenAddressSync(
    tokenBMint,
    payer.publicKey,
    true,
    tokenBProgram
  );

  let transaction = await program.methods
    .initializePool({
      liquidity: liquidity,
      sqrtPrice: sqrtPrice,
      activationPoint: activationPoint,
    })
    .accountsPartial({
      creator,
      positionNftAccount,
      positionNftMint: positionNftKP.publicKey,
      payer: payer.publicKey,
      config,
      poolAuthority,
      pool,
      position,
      tokenAMint,
      tokenBMint,
      tokenAVault,
      tokenBVault,
      payerTokenA,
      payerTokenB,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      tokenAProgram,
      tokenBProgram,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  // requires more compute budget than usual
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 350_000,
    })
  );

  const result = sendTransaction(svm, transaction, [payer, positionNftKP]);
  if (result instanceof TransactionMetadata) {
    // validate pool data
    const poolState = getPool(svm, pool);
    expect(poolState.tokenAMint.toString()).eq(tokenAMint.toString());
    expect(poolState.tokenBMint.toString()).eq(tokenBMint.toString());
    expect(poolState.tokenAVault.toString()).eq(tokenAVault.toString());
    expect(poolState.tokenBVault.toString()).eq(tokenBVault.toString());
    expect(poolState.liquidity.toString()).eq(liquidity.toString());
    expect(poolState.sqrtPrice.toString()).eq(sqrtPrice.toString());

    expect(poolState.rewardInfos[0].initialized).eq(0);
    expect(poolState.rewardInfos[1].initialized).eq(0);
    expect(poolState.poolFees.initSqrtPrice.toString()).eq(
      sqrtPrice.toString()
    );
  }

  return { pool, position: position, result };
}

export type InitializePoolWithCustomizeConfigParams = {
  payer: Keypair;
  poolCreatorAuthority: Keypair;
  creator: PublicKey;
  customizeConfigAddress: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  poolFees: PoolFeesParams;
  sqrtMinPrice: BN;
  sqrtMaxPrice: BN;
  hasAlphaVault: boolean;
  liquidity: BN;
  sqrtPrice: BN;
  activationType: number;
  collectFeeMode: number;
  activationPoint: BN | null;
};

export async function initializePoolWithCustomizeConfig(
  svm: LiteSVM,
  params: InitializePoolWithCustomizeConfigParams
): Promise<{ pool: PublicKey; position: PublicKey }> {
  const {
    tokenAMint,
    tokenBMint,
    payer,
    creator,
    poolCreatorAuthority,
    customizeConfigAddress,
    poolFees,
    hasAlphaVault,
    liquidity,
    sqrtMaxPrice,
    sqrtMinPrice,
    sqrtPrice,
    collectFeeMode,
    activationPoint,
    activationType,
  } = params;
  const program = createCpAmmProgram();

  const poolAuthority = derivePoolAuthority();
  const pool = derivePoolAddress(
    customizeConfigAddress,
    tokenAMint,
    tokenBMint
  );

  const positionNftKP = Keypair.generate();
  const position = derivePositionAddress(positionNftKP.publicKey);
  const positionNftAccount = derivePositionNftAccount(positionNftKP.publicKey);

  const tokenAProgram = svm.getAccount(tokenAMint).owner;
  const tokenBProgram = svm.getAccount(tokenBMint).owner;

  const tokenAVault = deriveTokenVaultAddress(tokenAMint, pool);
  const tokenBVault = deriveTokenVaultAddress(tokenBMint, pool);

  const payerTokenA = getAssociatedTokenAddressSync(
    tokenAMint,
    payer.publicKey,
    true,
    tokenAProgram
  );
  const payerTokenB = getAssociatedTokenAddressSync(
    tokenBMint,
    payer.publicKey,
    true,
    tokenBProgram
  );

  const transaction = await program.methods
    .initializePoolWithDynamicConfig({
      poolFees,
      sqrtMinPrice,
      sqrtMaxPrice,
      hasAlphaVault,
      liquidity,
      sqrtPrice,
      activationType,
      collectFeeMode,
      activationPoint,
    })
    .accountsPartial({
      creator,
      positionNftAccount,
      positionNftMint: positionNftKP.publicKey,
      payer: payer.publicKey,
      poolCreatorAuthority: poolCreatorAuthority.publicKey,
      config: customizeConfigAddress,
      poolAuthority,
      pool,
      position,
      tokenAMint,
      tokenBMint,
      tokenAVault,
      tokenBVault,
      payerTokenA,
      payerTokenB,
      tokenAProgram,
      tokenBProgram,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    })
    .transaction();
  // requires more compute budget than usual
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 350_000,
    })
  );

  const result = sendTransaction(svm, transaction, [
    payer,
    positionNftKP,
    poolCreatorAuthority,
  ]);
  expect(result).instanceOf(TransactionMetadata);

  // validate pool data
  const poolState = getPool(svm, pool);
  expect(poolState.tokenAMint.toString()).eq(tokenAMint.toString());
  expect(poolState.tokenBMint.toString()).eq(tokenBMint.toString());
  expect(poolState.tokenAVault.toString()).eq(tokenAVault.toString());
  expect(poolState.tokenBVault.toString()).eq(tokenBVault.toString());
  expect(poolState.liquidity.toString()).eq(liquidity.toString());
  expect(poolState.sqrtPrice.toString()).eq(sqrtPrice.toString());
  expect(poolState.poolType).eq(1); // Pool type: customize

  expect(poolState.rewardInfos[0].initialized).eq(0);
  expect(poolState.rewardInfos[1].initialized).eq(0);

  expect(poolState.poolFees.initSqrtPrice.toString()).eq(sqrtPrice.toString());

  return { pool, position: position };
}

export type SetPoolStatusParams = {
  whitelistedAddress: Keypair;
  pool: PublicKey;
  status: number;
};

export async function setPoolStatus(svm: LiteSVM, params: SetPoolStatusParams) {
  const { whitelistedAddress, pool, status } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .setPoolStatus(status)
    .accountsPartial({
      pool,
      operator: deriveOperatorAddress(whitelistedAddress.publicKey),

      whitelistedAddress: whitelistedAddress.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [whitelistedAddress]);

  expect(result).instanceOf(TransactionMetadata);
}

export type PoolFeesParams = {
  baseFee: BaseFee;
  padding: number[];
  dynamicFee: DynamicFee | null;
};

export type InitializeCustomizablePoolParams = {
  payer: Keypair;
  creator: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  poolFees: PoolFeesParams;
  sqrtMinPrice: BN;
  sqrtMaxPrice: BN;
  hasAlphaVault: boolean;
  liquidity: BN;
  sqrtPrice: BN;
  activationType: number;
  collectFeeMode: number;
  activationPoint: BN | null;
};

export async function initializeCustomizablePool(
  svm: LiteSVM,
  params: InitializeCustomizablePoolParams
): Promise<{ pool: PublicKey; position: PublicKey }> {
  const {
    tokenAMint,
    tokenBMint,
    payer,
    creator,
    poolFees,
    hasAlphaVault,
    liquidity,
    sqrtMaxPrice,
    sqrtMinPrice,
    sqrtPrice,
    collectFeeMode,
    activationPoint,
    activationType,
  } = params;
  const program = createCpAmmProgram();

  const poolAuthority = derivePoolAuthority();
  const pool = deriveCustomizablePoolAddress(tokenAMint, tokenBMint);

  const positionNftKP = Keypair.generate();
  const position = derivePositionAddress(positionNftKP.publicKey);
  const positionNftAccount = derivePositionNftAccount(positionNftKP.publicKey);

  const tokenAProgram = svm.getAccount(tokenAMint).owner;
  const tokenBProgram = svm.getAccount(tokenBMint).owner;

  const tokenAVault = deriveTokenVaultAddress(tokenAMint, pool);
  const tokenBVault = deriveTokenVaultAddress(tokenBMint, pool);

  const payerTokenA = getAssociatedTokenAddressSync(
    tokenAMint,
    payer.publicKey,
    true,
    tokenAProgram
  );
  const payerTokenB = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    tokenBMint,
    payer.publicKey,
    tokenBProgram
  );

  if (tokenBMint.equals(NATIVE_MINT)) {
    wrapSOL(svm, payer, new BN(LAMPORTS_PER_SOL));
  }

  const transaction = await program.methods
    .initializeCustomizablePool({
      poolFees,
      sqrtMinPrice,
      sqrtMaxPrice,
      hasAlphaVault,
      liquidity,
      sqrtPrice,
      activationType,
      collectFeeMode,
      activationPoint,
    })
    .accountsPartial({
      creator,
      positionNftAccount,
      positionNftMint: positionNftKP.publicKey,
      payer: payer.publicKey,
      poolAuthority,
      pool,
      position,
      tokenAMint,
      tokenBMint,
      tokenAVault,
      tokenBVault,
      payerTokenA,
      payerTokenB,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      tokenAProgram,
      tokenBProgram,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  // requires more compute budget than usual
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 350_000,
    })
  );

  const result = sendTransaction(svm, transaction, [payer, positionNftKP]);
  expect(result).instanceOf(TransactionMetadata);

  // validate pool data
  const poolState = getPool(svm, pool);
  expect(poolState.tokenAMint.toString()).eq(tokenAMint.toString());
  expect(poolState.tokenBMint.toString()).eq(tokenBMint.toString());
  expect(poolState.tokenAVault.toString()).eq(tokenAVault.toString());
  expect(poolState.tokenBVault.toString()).eq(tokenBVault.toString());
  expect(poolState.liquidity.toString()).eq(liquidity.toString());
  expect(poolState.sqrtPrice.toString()).eq(sqrtPrice.toString());

  expect(poolState.rewardInfos[0].initialized).eq(0);
  expect(poolState.rewardInfos[1].initialized).eq(0);

  expect(poolState.poolFees.initSqrtPrice.toString()).eq(sqrtPrice.toString());

  // Check the offset at base_fee_serde.rs
  const baseFeeModeInParams = params.poolFees.baseFee.data[26];
  const baseFeeModeInConfig = poolState.poolFees.baseFee.baseFeeInfo.data[8];

  expect(baseFeeModeInConfig).eq(baseFeeModeInParams);
  const baseFeeMode: BaseFeeMode = baseFeeModeInParams;

  switch (baseFeeMode) {
    case BaseFeeMode.FeeTimeSchedulerLinear:
    case BaseFeeMode.FeeTimeSchedulerExponential:
      const feeTimeSchedulerParams = decodeFeeTimeSchedulerParams(
        Buffer.from(params.poolFees.baseFee.data)
      );

      const podAlignedFeeTimeScheduler = decodePodAlignedFeeTimeScheduler(
        Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
      );

      expect(feeTimeSchedulerParams.baseFeeMode).eq(
        podAlignedFeeTimeScheduler.baseFeeMode
      );
      expect(feeTimeSchedulerParams.cliffFeeNumerator.toString()).eq(
        podAlignedFeeTimeScheduler.cliffFeeNumerator.toString()
      );
      expect(feeTimeSchedulerParams.numberOfPeriod).eq(
        podAlignedFeeTimeScheduler.numberOfPeriod
      );
      expect(feeTimeSchedulerParams.periodFrequency.toString()).eq(
        podAlignedFeeTimeScheduler.periodFrequency.toString()
      );
      expect(feeTimeSchedulerParams.reductionFactor.toString()).eq(
        podAlignedFeeTimeScheduler.reductionFactor.toString()
      );
      break;
    case BaseFeeMode.FeeMarketCapSchedulerExponential:
    case BaseFeeMode.FeeMarketCapSchedulerLinear:
      const marketCapSchedulerParams = decodeFeeMarketCapSchedulerParams(
        Buffer.from(params.poolFees.baseFee.data)
      );

      const podAlignedMarketCapScheduler =
        decodePodAlignedFeeMarketCapScheduler(
          Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
        );

      expect(marketCapSchedulerParams.baseFeeMode).eq(
        podAlignedMarketCapScheduler.baseFeeMode
      );
      expect(marketCapSchedulerParams.cliffFeeNumerator.toString()).eq(
        podAlignedMarketCapScheduler.cliffFeeNumerator.toString()
      );
      expect(marketCapSchedulerParams.numberOfPeriod).eq(
        podAlignedMarketCapScheduler.numberOfPeriod
      );
      expect(marketCapSchedulerParams.priceStepBps).eq(
        podAlignedMarketCapScheduler.priceStepBps
      );
      expect(marketCapSchedulerParams.schedulerExpirationDuration).eq(
        podAlignedMarketCapScheduler.schedulerExpirationDuration
      );
      expect(marketCapSchedulerParams.reductionFactor.toString()).eq(
        podAlignedMarketCapScheduler.reductionFactor.toString()
      );

      break;
    case BaseFeeMode.RateLimiter:
      const rateLimiterParams = decodeFeeRateLimiterParams(
        Buffer.from(params.poolFees.baseFee.data)
      );

      const podAlignedRateLimiter = decodePodAlignedFeeRateLimiter(
        Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
      );

      expect(rateLimiterParams.baseFeeMode).eq(
        podAlignedRateLimiter.baseFeeMode
      );
      expect(rateLimiterParams.cliffFeeNumerator.toString()).eq(
        podAlignedRateLimiter.cliffFeeNumerator.toString()
      );
      expect(rateLimiterParams.feeIncrementBps).eq(
        podAlignedRateLimiter.feeIncrementBps
      );
      expect(rateLimiterParams.maxLimiterDuration).eq(
        podAlignedRateLimiter.maxLimiterDuration
      );
      expect(rateLimiterParams.referenceAmount.toString()).eq(
        podAlignedRateLimiter.referenceAmount.toString()
      );
      break;
    default:
      throw new Error("Unreachable");
  }

  return { pool, position: position };
}

export type InitializeRewardParams = {
  payer: Keypair;
  index: number;
  rewardDuration: BN;
  pool: PublicKey;
  rewardMint: PublicKey;
  funder: PublicKey;
  operator?: PublicKey;
};

export async function initializeReward(
  svm: LiteSVM,
  params: InitializeRewardParams
): Promise<TransactionMetadata | FailedTransactionMetadata> {
  const { index, rewardDuration, pool, rewardMint, payer, funder, operator } =
    params;
  const program = createCpAmmProgram();

  const poolAuthority = derivePoolAuthority();
  const rewardVault = deriveRewardVaultAddress(pool, index);

  const tokenProgram = svm.getAccount(rewardMint).owner;
  const tokenBadge = deriveTokenBadgeAddress(rewardMint);
  const remainingAccounts: AccountMeta[] = [];

  if (svm.getAccount(tokenBadge)) {
    remainingAccounts.push({
      pubkey: tokenBadge,
      isSigner: false,
      isWritable: false,
    });
  } else {
    remainingAccounts.push({
      pubkey: CP_AMM_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    });
  }
  if (operator) {
    remainingAccounts.push({
      pubkey: operator,
      isSigner: false,
      isWritable: false,
    });
  }

  const transaction = await program.methods
    .initializeReward(index, rewardDuration, funder)
    .accountsPartial({
      pool,
      poolAuthority,
      rewardVault,
      rewardMint,
      payer: payer.publicKey,
      signer: payer.publicKey,
      tokenProgram,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .transaction();

  const result = sendTransaction(svm, transaction, [payer]);
  if (result instanceof TransactionMetadata) {
    // validate reward data
    const poolState = getPool(svm, pool);
    expect(poolState.rewardInfos[index].initialized).eq(1);
    expect(poolState.rewardInfos[index].vault.toString()).eq(
      rewardVault.toString()
    );
    expect(poolState.rewardInfos[index].mint.toString()).eq(
      rewardMint.toString()
    );
  }
  return result;
}

export type UpdateRewardDurationParams = {
  index: number;
  signer: Keypair;
  pool: PublicKey;
  newDuration: BN;
  operator?: PublicKey;
};

export async function updateRewardDuration(
  svm: LiteSVM,
  params: UpdateRewardDurationParams
): Promise<void> {
  const { pool, signer, index, newDuration, operator } = params;
  const program = createCpAmmProgram();
  let remainingAccounts =
    operator == null
      ? []
      : [
          {
            pubkey: operator,
            isSigner: false,
            isWritable: false,
          },
        ];
  const transaction = await program.methods
    .updateRewardDuration(index, newDuration)
    .accountsPartial({
      pool,
      signer: signer.publicKey,
    })
    .remainingAccounts(remainingAccounts)
    .transaction();

  const result = sendTransaction(svm, transaction, [signer]);
  expect(result).instanceOf(TransactionMetadata);

  const poolState = getPool(svm, pool);
  expect(poolState.rewardInfos[index].rewardDuration.toNumber()).eq(
    newDuration.toNumber()
  );
}

export type UpdateRewardFunderParams = {
  index: number;
  signer: Keypair;
  pool: PublicKey;
  newFunder: PublicKey;
  operator?: PublicKey;
};

export async function updateRewardFunder(
  svm: LiteSVM,
  params: UpdateRewardFunderParams
): Promise<void> {
  const { pool, signer, index, newFunder, operator } = params;
  const program = createCpAmmProgram();
  let remainingAccounts =
    operator == null
      ? []
      : [
          {
            pubkey: operator,
            isSigner: false,
            isWritable: false,
          },
        ];
  const transaction = await program.methods
    .updateRewardFunder(index, newFunder)
    .accountsPartial({
      pool,
      signer: signer.publicKey,
    })
    .remainingAccounts(remainingAccounts)
    .transaction();

  const result = sendTransaction(svm, transaction, [signer]);
  expect(result).instanceOf(TransactionMetadata);

  const poolState = getPool(svm, pool);
  expect(poolState.rewardInfos[index].funder.toString()).eq(
    newFunder.toString()
  );
}

export type FundRewardParams = {
  funder: Keypair;
  index: number;
  pool: PublicKey;
  carryForward: boolean;
  amount: BN;
};

export async function fundReward(
  svm: LiteSVM,
  params: FundRewardParams
): Promise<void> {
  const { index, carryForward, pool, funder, amount } = params;
  const program = createCpAmmProgram();

  const poolState = getPool(svm, pool);
  const rewardVault = poolState.rewardInfos[index].vault;
  const tokenProgram = svm.getAccount(poolState.rewardInfos[index].mint).owner;
  const funderTokenAccount = getAssociatedTokenAddressSync(
    poolState.rewardInfos[index].mint,
    funder.publicKey,
    true,
    tokenProgram
  );

  const transaction = await program.methods
    .fundReward(index, amount, carryForward)
    .accountsPartial({
      pool,
      rewardVault: poolState.rewardInfos[index].vault,
      rewardMint: poolState.rewardInfos[index].mint,
      funderTokenAccount,
      funder: funder.publicKey,
      tokenProgram,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [funder]);
  expect(result).instanceOf(TransactionMetadata);
}

export type ClaimRewardParams = {
  index: number;
  user: Keypair;
  position: PublicKey;
  pool: PublicKey;
  skipReward: number;
};

export async function claimReward(
  svm: LiteSVM,
  params: ClaimRewardParams
): Promise<TransactionMetadata | FailedTransactionMetadata> {
  const { index, pool, user, position, skipReward } = params;
  const program = createCpAmmProgram();

  const poolState = getPool(svm, pool);
  const positionState = getPosition(svm, position);
  const poolAuthority = derivePoolAuthority();
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  // TODO should use token flag in pool state to get token program ID
  const tokenProgram = svm.getAccount(poolState.rewardInfos[index].mint).owner;

  const userTokenAccount = getOrCreateAssociatedTokenAccount(
    svm,
    user,
    poolState.rewardInfos[index].mint,
    user.publicKey,
    tokenProgram
  );

  const transaction = await program.methods
    .claimReward(index, skipReward)
    .accountsPartial({
      pool,
      positionNftAccount,
      rewardVault: poolState.rewardInfos[index].vault,
      rewardMint: poolState.rewardInfos[index].mint,
      poolAuthority,
      position,
      userTokenAccount,
      owner: user.publicKey,
      tokenProgram,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [user]);
  return result;
}

export type WithdrawIneligibleRewardParams = {
  index: number;
  funder: Keypair;
  pool: PublicKey;
};

export async function withdrawIneligibleReward(
  svm: LiteSVM,
  params: WithdrawIneligibleRewardParams
): Promise<void> {
  const { index, pool, funder } = params;
  const program = createCpAmmProgram();

  const poolState = getPool(svm, pool);
  const poolAuthority = derivePoolAuthority();
  const tokenProgram = svm.getAccount(poolState.rewardInfos[index].mint).owner;
  const funderTokenAccount = getAssociatedTokenAddressSync(
    poolState.rewardInfos[index].mint,
    funder.publicKey,
    true,
    tokenProgram
  );

  const transaction = await program.methods
    .withdrawIneligibleReward(index)
    .accountsPartial({
      pool,
      rewardVault: poolState.rewardInfos[index].vault,
      rewardMint: poolState.rewardInfos[index].mint,
      poolAuthority,
      funderTokenAccount,
      funder: funder.publicKey,
      tokenProgram,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [funder]);
  expect(result).instanceOf(TransactionMetadata);
}

export async function refreshVestings(
  svm: LiteSVM,
  position: PublicKey,
  pool: PublicKey,
  owner: PublicKey,
  payer: Keypair,
  vestings: PublicKey[]
) {
  const program = createCpAmmProgram();
  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);
  const transaction = await program.methods
    .refreshVesting()
    .accountsPartial({
      position,
      positionNftAccount,
      pool,
      owner,
    })
    .remainingAccounts(
      vestings.map((pubkey) => {
        return {
          isSigner: false,
          isWritable: true,
          pubkey,
        };
      })
    )
    .transaction();

  const result = sendTransaction(svm, transaction, [payer]);
  expect(result).instanceOf(TransactionMetadata);
}

export async function permanentLockPosition(
  svm: LiteSVM,
  position: PublicKey,
  owner: Keypair,
  payer: Keypair
) {
  const program = createCpAmmProgram();

  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const transaction = await program.methods
    .permanentLockPosition(positionState.unlockedLiquidity)
    .accountsPartial({
      position,
      positionNftAccount,
      pool: positionState.pool,
      owner: owner.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [payer, owner]);
  expect(result).instanceOf(TransactionMetadata);
}

export async function lockPosition(
  svm: LiteSVM,
  position: PublicKey,
  owner: Keypair,
  payer: Keypair,
  params: LockPositionParams
) {
  const program = createCpAmmProgram();
  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const vestingKP = Keypair.generate();

  const transaction = await program.methods
    .lockPosition(params)
    .accountsPartial({
      position,
      positionNftAccount,
      vesting: vestingKP.publicKey,
      owner: owner.publicKey,
      pool: positionState.pool,
      program: CP_AMM_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      payer: payer.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [payer, owner, vestingKP]);
  expect(result).instanceOf(TransactionMetadata);

  return vestingKP.publicKey;
}

export async function createPosition(
  svm: LiteSVM,
  payer: Keypair,
  owner: PublicKey,
  pool: PublicKey
): Promise<PublicKey> {
  const program = createCpAmmProgram();

  const positionNftKP = Keypair.generate();
  const position = derivePositionAddress(positionNftKP.publicKey);
  const poolAuthority = derivePoolAuthority();
  const positionNftAccount = derivePositionNftAccount(positionNftKP.publicKey);

  const transaction = await program.methods
    .createPosition()
    .accountsPartial({
      owner,
      positionNftMint: positionNftKP.publicKey,
      poolAuthority,
      positionNftAccount,
      payer: payer.publicKey,
      pool,
      position,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [payer, positionNftKP]);
  expect(result).instanceOf(TransactionMetadata);

  const positionState = getPosition(svm, position);

  expect(positionState.nftMint.toString()).eq(
    positionNftKP.publicKey.toString()
  );

  const positionNftData = AccountLayout.decode(
    svm.getAccount(positionNftAccount).data
  );

  // validate metadata
  const tlvData = svm
    .getAccount(positionState.nftMint)
    .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
  const metadata = unpack(
    getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
  );
  expect(metadata.name).eq("Meteora Position NFT");
  expect(metadata.symbol).eq("MPN");

  // validate metadata pointer
  const metadataAddress = MetadataPointerLayout.decode(
    getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
  ).metadataAddress;
  expect(metadataAddress.toString()).eq(positionState.nftMint.toString());

  // validate owner
  expect(positionNftData.owner.toString()).eq(owner.toString());
  expect(Number(positionNftData.amount)).eq(1);
  expect(positionNftData.mint.toString()).eq(
    positionNftKP.publicKey.toString()
  );

  return position;
}

export type AddLiquidityParams = {
  owner: Keypair;
  pool: PublicKey;
  position: PublicKey;
  liquidityDelta: BN;
  tokenAAmountThreshold: BN;
  tokenBAmountThreshold: BN;
};

export async function addLiquidity(svm: LiteSVM, params: AddLiquidityParams) {
  const {
    owner,
    pool,
    position,
    liquidityDelta,
    tokenAAmountThreshold,
    tokenBAmountThreshold,
  } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);
  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;
  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;

  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey,
    true,
    tokenAProgram
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .addLiquidity({
      liquidityDelta,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
    })
    .accountsPartial({
      pool,
      position,
      positionNftAccount,
      owner: owner.publicKey,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [owner]);

  expect(result).instanceOf(TransactionMetadata);
}

export type RemoveLiquidityParams = AddLiquidityParams;

export async function removeLiquidity(
  svm: LiteSVM,
  params: RemoveLiquidityParams
) {
  const {
    owner,
    pool,
    position,
    liquidityDelta,
    tokenAAmountThreshold,
    tokenBAmountThreshold,
  } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);
  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const poolAuthority = derivePoolAuthority();
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;
  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;

  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey,
    true,
    tokenAProgram
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .removeLiquidity({
      liquidityDelta,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
    })
    .accountsPartial({
      poolAuthority,
      pool,
      position,
      positionNftAccount,
      owner: owner.publicKey,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [owner]);
  expect(result).instanceOf(TransactionMetadata);
}

export type RemoveAllLiquidityParams = {
  owner: Keypair;
  pool: PublicKey;
  position: PublicKey;
  tokenAAmountThreshold: BN;
  tokenBAmountThreshold: BN;
};

export async function removeAllLiquidity(
  svm: LiteSVM,
  params: RemoveAllLiquidityParams
) {
  const {
    owner,
    pool,
    position,
    tokenAAmountThreshold,
    tokenBAmountThreshold,
  } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);
  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const poolAuthority = derivePoolAuthority();
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;
  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;

  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey,
    true,
    tokenAProgram
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .removeAllLiquidity(tokenAAmountThreshold, tokenBAmountThreshold)
    .accountsPartial({
      poolAuthority,
      pool,
      position,
      positionNftAccount,
      owner: owner.publicKey,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [owner]);
  expect(result).instanceOf(TransactionMetadata);
}

export async function closePosition(
  svm: LiteSVM,
  params: {
    owner: Keypair;
    pool: PublicKey;
    position: PublicKey;
  }
) {
  const { owner, pool, position } = params;
  const program = createCpAmmProgram();
  const positionState = getPosition(svm, position);
  const poolAuthority = derivePoolAuthority();
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const transaction = await program.methods
    .closePosition()
    .accountsPartial({
      positionNftMint: positionState.nftMint,
      positionNftAccount,
      pool,
      position,
      poolAuthority,
      rentReceiver: owner.publicKey,
      owner: owner.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [owner]);
  expect(result).instanceOf(TransactionMetadata);
}

export type SwapParams = {
  payer: Keypair;
  pool: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  amountIn: BN;
  minimumAmountOut: BN;
  referralTokenAccount: PublicKey | null;
};

export async function swapInstruction(
  svm: LiteSVM,
  params: SwapParams
): Promise<Transaction> {
  const {
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amountIn,
    minimumAmountOut,
    referralTokenAccount,
  } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);

  const poolAuthority = derivePoolAuthority();
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;

  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;
  const inputTokenAccount = getAssociatedTokenAddressSync(
    inputTokenMint,
    payer.publicKey,
    true,
    tokenAProgram
  );

  const outputTokenAccount = getAssociatedTokenAddressSync(
    outputTokenMint,
    payer.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .swap({
      amountIn,
      minimumAmountOut,
    })
    .accountsPartial({
      poolAuthority,
      pool,
      payer: payer.publicKey,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
      referralTokenAccount,
    })
    .remainingAccounts(
      // TODO should check condition to add this in remaining accounts
      [
        {
          isSigner: false,
          isWritable: false,
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        },
      ]
    )
    .transaction();

  return transaction;
}
export enum SwapMode {
  ExactIn,
  PartialFillIn,
  ExactOut,
}

export type Swap2Params = {
  payer: Keypair;
  pool: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  amount0: BN;
  amount1: BN;
  swapMode: SwapMode;
  referralTokenAccount: PublicKey | null;
};

export async function swap2Instruction(svm: LiteSVM, params: Swap2Params) {
  const {
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amount0,
    amount1,
    swapMode,
    referralTokenAccount,
  } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);

  const poolAuthority = derivePoolAuthority();
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;

  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;
  const inputTokenAccount = getAssociatedTokenAddressSync(
    inputTokenMint,
    payer.publicKey,
    true,
    tokenAProgram
  );
  const outputTokenAccount = getAssociatedTokenAddressSync(
    outputTokenMint,
    payer.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .swap2({
      amount0,
      amount1,
      swapMode,
    })
    .accountsPartial({
      poolAuthority,
      pool,
      payer: payer.publicKey,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
      referralTokenAccount,
    })
    .remainingAccounts(
      // TODO should check condition to add this in remaining accounts
      [
        {
          isSigner: false,
          isWritable: false,
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        },
      ]
    )
    .transaction();

  return transaction;
}

export async function swapTestInstruction(svm: LiteSVM, params: Swap2Params) {
  const {
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amount0,
    amount1,
    swapMode,
    referralTokenAccount,
  } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);

  const poolAuthority = derivePoolAuthority();
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;

  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;
  const inputTokenAccount = getAssociatedTokenAddressSync(
    inputTokenMint,
    payer.publicKey,
    true,
    tokenAProgram
  );
  const outputTokenAccount = getAssociatedTokenAddressSync(
    outputTokenMint,
    payer.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .swapTest({
      amount0,
      amount1,
      swapMode,
    })
    .accountsPartial({
      poolAuthority,
      pool,
      payer: payer.publicKey,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
      referralTokenAccount,
    })
    .remainingAccounts(
      // TODO should check condition to add this in remaining accounts
      [
        {
          isSigner: false,
          isWritable: false,
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        },
      ]
    )
    .transaction();

  return transaction;
}

export async function swap2ExactIn(
  svm: LiteSVM,
  params: Omit<Swap2Params, "swapMode">
) {
  const swapIx = await swap2Instruction(svm, {
    ...params,
    swapMode: SwapMode.ExactIn,
  });

  const result = sendTransaction(svm, swapIx, [params.payer]);
  expect(result).instanceOf(TransactionMetadata);
}

export async function swap2ExactOut(
  svm: LiteSVM,
  params: Omit<Swap2Params, "swapMode">
) {
  const swapIx = await swap2Instruction(svm, {
    ...params,
    swapMode: SwapMode.ExactOut,
  });

  const result = sendTransaction(svm, swapIx, [params.payer]);

  expect(result).instanceOf(TransactionMetadata);
}

export async function swap2PartialFillIn(
  svm: LiteSVM,
  params: Omit<Swap2Params, "swapMode">
) {
  const swapIx = await swap2Instruction(svm, {
    ...params,
    swapMode: SwapMode.PartialFillIn,
  });

  const result = sendTransaction(svm, swapIx, [params.payer]);
  expect(result).instanceOf(TransactionMetadata);
}

export async function swapExactIn(svm: LiteSVM, params: SwapParams) {
  const transaction = await swapInstruction(svm, params);

  const result = sendTransaction(svm, transaction, [params.payer]);

  expect(result).instanceOf(TransactionMetadata);
}

export type ClaimPositionFeeParams = {
  owner: Keypair;
  pool: PublicKey;
  position: PublicKey;
};

export async function claimPositionFee(
  svm: LiteSVM,
  params: ClaimPositionFeeParams
) {
  const { owner, pool, position } = params;

  const program = createCpAmmProgram();
  const poolState = getPool(svm, pool);
  const positionState = getPosition(svm, position);
  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);

  const poolAuthority = derivePoolAuthority();
  const tokenAProgram = svm.getAccount(poolState.tokenAMint).owner;
  const tokenBProgram = svm.getAccount(poolState.tokenBMint).owner;

  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey,
    true,
    tokenAProgram
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey,
    true,
    tokenBProgram
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .claimPositionFee()
    .accountsPartial({
      poolAuthority,
      owner: owner.publicKey,
      pool,
      position,
      positionNftAccount,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [owner]);

  expect(result).instanceOf(TransactionMetadata);
}

export type SplitPositionParams = {
  firstPositionOwner: Keypair;
  secondPositionOwner: Keypair;
  pool: PublicKey;
  firstPosition: PublicKey;
  firstPositionNftAccount: PublicKey;
  secondPosition: PublicKey;
  secondPositionNftAccount: PublicKey;
  permanentLockedLiquidityPercentage: number;
  unlockedLiquidityPercentage: number;
  feeAPercentage: number;
  feeBPercentage: number;
  reward0Percentage: number;
  reward1Percentage: number;
};
export async function splitPosition(svm: LiteSVM, params: SplitPositionParams) {
  const {
    pool,
    firstPositionOwner,
    secondPositionOwner,
    firstPosition,
    secondPosition,
    firstPositionNftAccount,
    secondPositionNftAccount,
    permanentLockedLiquidityPercentage,
    unlockedLiquidityPercentage,
    feeAPercentage,
    feeBPercentage,
    reward0Percentage,
    reward1Percentage,
  } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .splitPosition({
      permanentLockedLiquidityPercentage,
      unlockedLiquidityPercentage,
      feeAPercentage,
      feeBPercentage,
      reward0Percentage,
      reward1Percentage,
      padding: new Array(16).fill(0),
    })
    .accountsPartial({
      pool,
      firstPosition,
      firstPositionNftAccount,
      secondPosition,
      secondPositionNftAccount,
      firstOwner: firstPositionOwner.publicKey,
      secondOwner: secondPositionOwner.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [
    firstPositionOwner,
    secondPositionOwner,
  ]);

  return result;
}

export type SplitPosition2Params = {
  firstPositionOwner: Keypair;
  secondPositionOwner: Keypair;
  pool: PublicKey;
  firstPosition: PublicKey;
  firstPositionNftAccount: PublicKey;
  secondPosition: PublicKey;
  secondPositionNftAccount: PublicKey;
  numerator: number;
};
export async function splitPosition2(
  svm: LiteSVM,
  params: SplitPosition2Params
) {
  const {
    pool,
    firstPositionOwner,
    secondPositionOwner,
    firstPosition,
    secondPosition,
    firstPositionNftAccount,
    secondPositionNftAccount,
    numerator,
  } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .splitPosition2(numerator)
    .accountsPartial({
      pool,
      firstPosition,
      firstPositionNftAccount,
      secondPosition,
      secondPositionNftAccount,
      firstOwner: firstPositionOwner.publicKey,
      secondOwner: secondPositionOwner.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [
    firstPositionOwner,
    secondPositionOwner,
  ]);

  return result;
}

export function getPool(svm: LiteSVM, pool: PublicKey): Pool {
  const program = createCpAmmProgram();
  const account = svm.getAccount(pool);
  return program.coder.accounts.decode("pool", Buffer.from(account.data));
}

export function getPosition(svm: LiteSVM, position: PublicKey): Position {
  const program = createCpAmmProgram();
  const account = svm.getAccount(position);
  return program.coder.accounts.decode("position", Buffer.from(account.data));
}

export function getVesting(svm: LiteSVM, vesting: PublicKey): Vesting {
  const program = createCpAmmProgram();
  const account = svm.getAccount(vesting);
  return program.coder.accounts.decode("vesting", Buffer.from(account.data));
}

export function getConfig(svm: LiteSVM, config: PublicKey): Config {
  const program = createCpAmmProgram();
  const account = svm.getAccount(config);
  return program.coder.accounts.decode("config", Buffer.from(account.data));
}

export function getTokenBadge(svm: LiteSVM, tokenBadge: PublicKey): TokenBadge {
  const program = createCpAmmProgram();
  const account = svm.getAccount(tokenBadge);
  return program.coder.accounts.decode("tokenBadge", Buffer.from(account.data));
}

export function getDynamicFeeParams(
  baseFeeNumerator: BN,
  maxPriceChangeBps: number = MAX_PRICE_CHANGE_BPS_DEFAULT // default 15%
): DynamicFee {
  if (maxPriceChangeBps > MAX_PRICE_CHANGE_BPS_DEFAULT) {
    throw new Error(
      `maxPriceChangeBps (${maxPriceChangeBps} bps) must be less than or equal to ${MAX_PRICE_CHANGE_BPS_DEFAULT}`
    );
  }

  const priceRatio = maxPriceChangeBps / BASIS_POINT_MAX + 1;
  // Q64
  const sqrtPriceRatioQ64 = new BN(
    Decimal.sqrt(priceRatio.toString())
      .mul(Decimal.pow(2, 64))
      .floor()
      .toFixed()
  );
  const deltaBinId = sqrtPriceRatioQ64
    .sub(ONE)
    .div(BIN_STEP_BPS_U128_DEFAULT)
    .muln(2);

  const maxVolatilityAccumulator = new BN(deltaBinId.muln(BASIS_POINT_MAX));

  const squareVfaBin = maxVolatilityAccumulator
    .mul(new BN(BIN_STEP_BPS_DEFAULT))
    .pow(new BN(2));

  const maxDynamicFeeNumerator = baseFeeNumerator.muln(20).divn(100); // default max dynamic fee = 20% of base fee.
  const vFee = maxDynamicFeeNumerator
    .mul(new BN(100_000_000_000))
    .sub(new BN(99_999_999_999));

  const variableFeeControl = vFee.div(squareVfaBin);

  return {
    binStep: BIN_STEP_BPS_DEFAULT,
    binStepU128: BIN_STEP_BPS_U128_DEFAULT,
    filterPeriod: DYNAMIC_FEE_FILTER_PERIOD_DEFAULT,
    decayPeriod: DYNAMIC_FEE_DECAY_PERIOD_DEFAULT,
    reductionFactor: DYNAMIC_FEE_REDUCTION_FACTOR_DEFAULT,
    maxVolatilityAccumulator: maxVolatilityAccumulator.toNumber(),
    variableFeeControl: variableFeeControl.toNumber(),
  };
}

export function getDefaultDynamicFee(): DynamicFee {
  return {
    binStep: 0,
    binStepU128: new BN(0),
    filterPeriod: 0,
    decayPeriod: 0,
    reductionFactor: 0,
    maxVolatilityAccumulator: 0,
    variableFeeControl: 0,
  };
}

export function getFeeShedulerParams(
  maxBaseFeeNumerator: BN,
  minBaseFeeNumerator: BN,
  baseFeeMode: BaseFeeMode,
  numberOfPeriod: number,
  totalDuration: number
) {
  if (maxBaseFeeNumerator.eq(minBaseFeeNumerator)) {
    if (numberOfPeriod != 0 || totalDuration != 0) {
      throw new Error("numberOfPeriod and totalDuration must both be zero");
    }

    return {
      cliffFeeNumerator: maxBaseFeeNumerator,
      firstFactor: 0,
      secondFactor: convertToByteArray(new BN(0)),
      thirdFactor: new BN(0),
      baseFeeMode: 0,
    };
  }

  const periodFrequency = new BN(totalDuration / numberOfPeriod);

  let reductionFactor: BN;
  if (baseFeeMode == BaseFeeMode.FeeTimeSchedulerLinear) {
    const totalReduction = maxBaseFeeNumerator.sub(minBaseFeeNumerator);
    reductionFactor = totalReduction.divn(numberOfPeriod);
  } else {
    const ratio =
      minBaseFeeNumerator.toNumber() / maxBaseFeeNumerator.toNumber();
    const decayBase = Math.pow(ratio, 1 / numberOfPeriod);
    reductionFactor = new BN(BASIS_POINT_MAX * (1 - decayBase));
  }

  return {
    cliffFeeNumerator: maxBaseFeeNumerator,
    numberOfPeriod,
    periodFrequency,
    reductionFactor,
    baseFeeMode,
  };
}

export async function buildSwapTestTxs(params: {
  payer: PublicKey;
  pool: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  inputTokenAccount: PublicKey;
  outputTokenAccount: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  tokenAProgram: PublicKey;
  tokenBProgram: PublicKey;
  poolAuthority?: PublicKey;
  eventAuthority?: PublicKey;
  programPk?: PublicKey;
  sysvarInstructionPubkey?: PublicKey;
  referralAccount?: PublicKey;
  amount0: BN;
  amount1: BN;
  swapMode: number;
}): Promise<{ swapTestTx: Transaction; swapPinocchioTx: Transaction }> {
  const program = createCpAmmProgram();
  const swapTestTx = await getSwapTransaction(program.methods.swapTest, params);
  const swapPinocchioTx = await getSwapTransaction(
    program.methods.swap2,
    params
  );
  return { swapTestTx, swapPinocchioTx };
}

async function getSwapTransaction(
  swapMethod,
  params: {
    payer: PublicKey;
    pool: PublicKey;
    tokenAMint: PublicKey;
    tokenBMint: PublicKey;
    inputTokenAccount: PublicKey;
    outputTokenAccount: PublicKey;
    tokenAVault: PublicKey;
    tokenBVault: PublicKey;
    tokenAProgram: PublicKey;
    tokenBProgram: PublicKey;
    poolAuthority?: PublicKey;
    eventAuthority?: PublicKey;
    programPk?: PublicKey;
    sysvarInstructionPubkey?: PublicKey;
    referralAccount?: PublicKey;
    amount0: BN;
    amount1: BN;
    swapMode: number;
  }
): Promise<Transaction> {
  const {
    payer,
    pool,
    amount0,
    amount1,
    swapMode,
    tokenAMint,
    tokenBMint,
    inputTokenAccount,
    outputTokenAccount,
    tokenAProgram,
    tokenBProgram,
    tokenAVault,
    tokenBVault,
    eventAuthority,
    programPk,
    poolAuthority,
    sysvarInstructionPubkey,
    referralAccount,
  } = params;
  const tx = await swapMethod({
    amount0,
    amount1,
    swapMode,
  })
    .accountsStrict({
      poolAuthority: poolAuthority ?? derivePoolAuthority(),
      pool,
      payer,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram,
      tokenBProgram,
      tokenAMint,
      tokenBMint,
      referralTokenAccount: referralAccount ?? null,
      eventAuthority: eventAuthority ?? deriveEventAuthority(),
      program: programPk ?? CP_AMM_PROGRAM_ID,
    })
    .remainingAccounts([
      {
        isSigner: false,
        isWritable: false,
        pubkey: sysvarInstructionPubkey ?? SYSVAR_INSTRUCTIONS_PUBKEY,
      },
    ])
    .transaction();
  return tx;
}
