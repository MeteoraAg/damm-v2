import {
  AnchorProvider,
  BN,
  IdlAccounts,
  IdlTypes,
  Program,
  Wallet,
} from "@coral-xyz/anchor";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import CpAmmIDL from "../../target/idl/cp_amm.json";
import { CpAmm } from "../../target/types/cp_amm";
import { getOrCreateAssociatedTokenAccount, getTokenAccount } from "./token";
import {
  deriveClaimFeeOperatorAddress,
  deriveConfigAddress,
  deriveCustomizablePoolAddress,
  derivePoolAddress,
  derivePoolAuthority,
  derivePositionAddress,
  deriveRewardVaultAddress,
  deriveTokenBadgeAddress,
  deriveTokenVaultAddress,
} from "./accounts";
import { processTransactionMaybeThrow } from "./common";
import { CP_AMM_PROGRAM_ID } from "./constants";
import { assert, expect } from "chai";
import { IdlType } from "@coral-xyz/anchor/dist/cjs/idl";

export type Pool = IdlAccounts<CpAmm>["pool"];
export type Position = IdlAccounts<CpAmm>["position"];
export type Vesting = IdlAccounts<CpAmm>["vesting"];
export type Config = IdlAccounts<CpAmm>["config"];
export type LockPositionParams = IdlTypes<CpAmm>["VestingParameters"];
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
  const program = new Program<CpAmm>(
    CpAmmIDL as CpAmm,
    CP_AMM_PROGRAM_ID,
    provider
  );
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
  cliffFeeNumerator: BN;
  numberOfPeriod: number;
  periodFrequency: BN;
  reductionFactor: BN;
  feeSchedulerMode: number,
};

export type PoolFees = {
  baseFee: BaseFee;
  protocolFeePercent: number;
  partnerFeePercent: number;
  referralFeePercent: number;
  dynamicFee: DynamicFee | null;
};

export type CreateConfigParams = {
  index: BN;
  poolFees: PoolFees;
  sqrtMinPrice: BN;
  sqrtMaxPrice: BN;
  vaultConfigKey: PublicKey;
  poolCreatorAuthority: PublicKey;
  activationType: number; // 0: slot, 1: timestamp
  collectFeeMode: number; // 0: BothToken, 1: OnlyTokenB
};

export async function createConfigIx(
  banksClient: BanksClient,
  admin: Keypair,
  params: CreateConfigParams
): Promise<PublicKey> {
  const program = createCpAmmProgram();

  const config = deriveConfigAddress(params.index);
  const transaction = await program.methods
    .createConfig(params)
    .accounts({
      config,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  // Check data
  const configState = await getConfig(banksClient, config);
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
  expect(configState.poolFees.baseFee.cliffFeeNumerator.toNumber()).eq(
    params.poolFees.baseFee.cliffFeeNumerator.toNumber()
  );
  expect(configState.poolFees.baseFee.numberOfPeriod).eq(
    params.poolFees.baseFee.numberOfPeriod
  );
  expect(configState.poolFees.baseFee.reductionFactor.toNumber()).eq(
    params.poolFees.baseFee.reductionFactor.toNumber()
  );
  expect(configState.poolFees.baseFee.feeSchedulerMode).eq(
    params.poolFees.baseFee.feeSchedulerMode
  );
  expect(configState.poolFees.baseFee.periodFrequency.toNumber()).eq(
    params.poolFees.baseFee.periodFrequency.toNumber()
  );
  expect(configState.poolFees.protocolFeePercent).eq(
    params.poolFees.protocolFeePercent
  );
  expect(configState.poolFees.partnerFeePercent).eq(
    params.poolFees.partnerFeePercent
  );
  expect(configState.poolFees.referralFeePercent).eq(
    params.poolFees.referralFeePercent
  );

  return config;
}

export async function closeConfigIx(
  banksClient: BanksClient,
  admin: Keypair,
  config: PublicKey
) {
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .closeConfig()
    .accounts({
      config,
      admin: admin.publicKey,
      rentReceiver: admin.publicKey,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const configState = await banksClient.getAccount(config);
  expect(configState).to.be.null;
}

export type CreateTokenBadgeParams = {
  tokenMint: PublicKey;
  admin: Keypair;
};

export async function createTokenBadge(
  banksClient: BanksClient,
  params: CreateTokenBadgeParams
) {
  const { tokenMint, admin } = params;
  const program = createCpAmmProgram();
  const tokenBadge = deriveTokenBadgeAddress(tokenMint);
  const transaction = await program.methods
    .createTokenBadge()
    .accounts({
      tokenBadge,
      tokenMint,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const tokenBadgeState = await getTokenBadge(banksClient, tokenBadge);

  expect(tokenBadgeState.tokenMint.toString()).eq(tokenMint.toString());
}

export type ClaimFeeOperatorParams = {
  admin: Keypair;
  operator: PublicKey;
};
export async function createClaimFeeOperator(
  banksClient: BanksClient,
  params: ClaimFeeOperatorParams
) {
  const program = createCpAmmProgram();
  const { admin, operator } = params;

  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator);
  const transaction = await program.methods
    .createClaimFeeOperator()
    .accounts({
      claimFeeOperator,
      operator,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type CloseFeeOperatorParams = {
  admin: Keypair;
  operator: PublicKey;
  rentReceiver: PublicKey;
};
export async function closeClaimFeeOperator(
  banksClient: BanksClient,
  params: CloseFeeOperatorParams
) {
  const program = createCpAmmProgram();
  const { admin, operator, rentReceiver } = params;

  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator);
  const transaction = await program.methods
    .closeClaimFeeOperator()
    .accounts({
      claimFeeOperator,
      rentReceiver,
      admin: admin.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const account = await banksClient.getAccount(claimFeeOperator);

  expect(account).to.be.null;
}

export type ClaimProtocolFeeParams = {
  operator: Keypair;
  pool: PublicKey;
  treasury: PublicKey;
};
export async function claimProtocolFee(
  banksClient: BanksClient,
  params: ClaimProtocolFeeParams
) {
  const program = createCpAmmProgram();
  const { operator, pool, treasury } = params;
  const poolAuthority = derivePoolAuthority();
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);
  const poolState = await getPool(banksClient, pool);
  const tokenAAccount = await getOrCreateAssociatedTokenAccount(
    banksClient,
    operator,
    poolState.tokenAMint,
    treasury
  );

  const tokenBAccount = await getOrCreateAssociatedTokenAccount(
    banksClient,
    operator,
    poolState.tokenBMint,
    treasury
  );

  const transaction = await program.methods
    .claimProtocolFee()
    .accounts({
      poolAuthority,
      pool,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAAccount,
      tokenBAccount,
      claimFeeOperator,
      operator: operator.publicKey,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(operator);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type ClaimPartnerFeeParams = {
  partner: Keypair;
  pool: PublicKey;
  maxAmountA: BN;
  maxAmountB: BN;
};
export async function claimPartnerFee(
  banksClient: BanksClient,
  params: ClaimPartnerFeeParams
) {
  const program = createCpAmmProgram();
  const { partner, pool, maxAmountA, maxAmountB } = params;
  const poolAuthority = derivePoolAuthority();
  const poolState = await getPool(banksClient, pool);
  const tokenAAccount = await getOrCreateAssociatedTokenAccount(
    banksClient,
    partner,
    poolState.tokenAMint,
    partner.publicKey
  );

  const tokenBAccount = await getOrCreateAssociatedTokenAccount(
    banksClient,
    partner,
    poolState.tokenBMint,
    partner.publicKey
  );
  const transaction = await program.methods
    .claimPartnerFee(maxAmountA, maxAmountB)
    .accounts({
      poolAuthority,
      pool,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAAccount,
      tokenBAccount,
      partner: partner.publicKey,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(partner);

  await processTransactionMaybeThrow(banksClient, transaction);
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
  banksClient: BanksClient,
  params: InitializePoolParams
): Promise<{ pool: PublicKey; position: PublicKey }> {
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

  const position = derivePositionAddress(pool, creator);

  const tokenAVault = deriveTokenVaultAddress(tokenAMint, pool);
  const tokenBVault = deriveTokenVaultAddress(tokenBMint, pool);

  const payerTokenA = getAssociatedTokenAddressSync(
    tokenAMint,
    payer.publicKey
  );
  const payerTokenB = getAssociatedTokenAddressSync(
    tokenBMint,
    payer.publicKey
  );

  const transaction = await program.methods
    .initializePool({
      liquidity: liquidity,
      sqrtPrice: sqrtPrice,
      activationPoint: activationPoint,
    })
    .accounts({
      creator,
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
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  await processTransactionMaybeThrow(banksClient, transaction);

  // validate pool data
  const poolState = await getPool(banksClient, pool);
  expect(poolState.tokenAMint.toString()).eq(tokenAMint.toString());
  expect(poolState.tokenBMint.toString()).eq(tokenBMint.toString());
  expect(poolState.tokenAVault.toString()).eq(tokenAVault.toString());
  expect(poolState.tokenBVault.toString()).eq(tokenBVault.toString());
  expect(poolState.liquidity.toString()).eq(liquidity.toString());
  expect(poolState.sqrtPrice.toString()).eq(sqrtPrice.toString());

  expect(poolState.rewardInfos[0].initialized).eq(0);
  expect(poolState.rewardInfos[1].initialized).eq(0);

  return { pool, position: position };
}

export type SetPoolStatusParams = {
  admin: Keypair;
  pool: PublicKey;
  status: number;
};

export async function setPoolStatus(
  banksClient: BanksClient,
  params: SetPoolStatusParams
) {
  const { admin, pool, status } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .setPoolStatus(status)
    .accounts({
      pool,
      admin: admin.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type PoolFeesParams = {
  baseFee: BaseFee;
  protocolFeePercent: number;
  partnerFeePercent: number;
  referralFeePercent: number;
  dynamicFee: DynamicFee | null;
};

export type InitializeCustomizeablePoolParams = {
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

export async function initializeCustomizeablePool(
  banksClient: BanksClient,
  params: InitializeCustomizeablePoolParams
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

  const position = derivePositionAddress(pool, creator);

  const tokenAVault = deriveTokenVaultAddress(tokenAMint, pool);
  const tokenBVault = deriveTokenVaultAddress(tokenBMint, pool);

  const payerTokenA = getAssociatedTokenAddressSync(
    tokenAMint,
    payer.publicKey
  );
  const payerTokenB = getAssociatedTokenAddressSync(
    tokenBMint,
    payer.publicKey
  );

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
    .accounts({
      creator,
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
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  await processTransactionMaybeThrow(banksClient, transaction);

  // validate pool data
  const poolState = await getPool(banksClient, pool);
  expect(poolState.tokenAMint.toString()).eq(tokenAMint.toString());
  expect(poolState.tokenBMint.toString()).eq(tokenBMint.toString());
  expect(poolState.tokenAVault.toString()).eq(tokenAVault.toString());
  expect(poolState.tokenBVault.toString()).eq(tokenBVault.toString());
  expect(poolState.liquidity.toString()).eq(liquidity.toString());
  expect(poolState.sqrtPrice.toString()).eq(sqrtPrice.toString());

  expect(poolState.rewardInfos[0].initialized).eq(0);
  expect(poolState.rewardInfos[1].initialized).eq(0);

  return { pool, position: position };
}

export type InitializeRewardParams = {
  payer: Keypair;
  index: number;
  rewardDuration: BN;
  pool: PublicKey;
  rewardMint: PublicKey;
};

export async function initializeReward(
  banksClient: BanksClient,
  params: InitializeRewardParams
): Promise<void> {
  const { index, rewardDuration, pool, rewardMint, payer } = params;
  const program = createCpAmmProgram();

  const poolAuthority = derivePoolAuthority();
  const rewardVault = deriveRewardVaultAddress(pool, index);

  const transaction = await program.methods
    .initializeReward(index, rewardDuration, payer.publicKey)
    .accounts({
      pool,
      poolAuthority,
      rewardVault,
      rewardMint,
      admin: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  await processTransactionMaybeThrow(banksClient, transaction);

  // validate reward data
  const poolState = await getPool(banksClient, pool);
  expect(poolState.rewardInfos[index].initialized).eq(1);
  expect(poolState.rewardInfos[index].vault.toString()).eq(
    rewardVault.toString()
  );
  expect(poolState.rewardInfos[index].mint.toString()).eq(
    rewardMint.toString()
  );
}

export type UpdateRewardDurationParams = {
  index: number;
  admin: Keypair;
  pool: PublicKey;
  newDuration: BN;
};

export async function updateRewardDuration(
  banksClient: BanksClient,
  params: UpdateRewardDurationParams
): Promise<void> {
  const { pool, admin, index, newDuration } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .updateRewardDuration(index, newDuration)
    .accounts({
      pool,
      admin: admin.publicKey,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const poolState = await getPool(banksClient, pool);
  expect(poolState.rewardInfos[index].rewardDuration.toNumber()).eq(
    newDuration.toNumber()
  );
}

export type UpdateRewardFunderParams = {
  index: number;
  admin: Keypair;
  pool: PublicKey;
  newFunder: PublicKey;
};

export async function updateRewardFunder(
  banksClient: BanksClient,
  params: UpdateRewardFunderParams
): Promise<void> {
  const { pool, admin, index, newFunder } = params;
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .updateRewardFunder(index, newFunder)
    .accounts({
      pool,
      admin: admin.publicKey,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const poolState = await getPool(banksClient, pool);
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
  banksClient: BanksClient,
  params: FundRewardParams
): Promise<void> {
  const { index, carryForward, pool, funder, amount } = params;
  const program = createCpAmmProgram();

  const poolState = await getPool(banksClient, pool);
  const rewardVault = poolState.rewardInfos[index].vault;
  const funderTokenAccount = getAssociatedTokenAddressSync(
    poolState.rewardInfos[index].mint,
    funder.publicKey
  );

  const rewardVaultPreBalance = Number(
    AccountLayout.decode((await banksClient.getAccount(rewardVault)).data)
      .amount
  );
  const funderPreBalance = Number(
    AccountLayout.decode(
      (await banksClient.getAccount(funderTokenAccount)).data
    ).amount
  );

  const transaction = await program.methods
    .fundReward(index, amount, carryForward)
    .accounts({
      pool,
      rewardVault: poolState.rewardInfos[index].vault,
      rewardMint: poolState.rewardInfos[index].mint,
      funderTokenAccount,
      funder: funder.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(funder);

  await processTransactionMaybeThrow(banksClient, transaction);

  const rewardVaultPostBalance = Number(
    AccountLayout.decode((await banksClient.getAccount(rewardVault)).data)
      .amount
  );
  const funderPostBalance = Number(
    AccountLayout.decode(
      (await banksClient.getAccount(funderTokenAccount)).data
    ).amount
  );

  expect(funderPreBalance - funderPostBalance).eq(amount.toNumber());

  expect(rewardVaultPostBalance - rewardVaultPreBalance).eq(amount.toNumber());
}

export type ClaimRewardParams = {
  index: number;
  user: Keypair;
  pool: PublicKey;
};

export async function claimReward(
  banksClient: BanksClient,
  params: ClaimRewardParams
): Promise<void> {
  const { index, pool, user } = params;
  const program = createCpAmmProgram();

  const poolState = await getPool(banksClient, pool);
  const position = derivePositionAddress(pool, user.publicKey);
  const poolAuthority = derivePoolAuthority();
  const userTokenAccount = getAssociatedTokenAddressSync(
    poolState.rewardInfos[index].mint,
    user.publicKey
  );

  const transaction = await program.methods
    .claimReward(index)
    .accounts({
      pool,
      rewardVault: poolState.rewardInfos[index].vault,
      rewardMint: poolState.rewardInfos[index].mint,
      poolAuthority,
      position,
      userTokenAccount,
      owner: user.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(user);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type WithdrawIneligibleRewardParams = {
  index: number;
  funder: Keypair;
  pool: PublicKey;
};

export async function withdrawIneligibleReward(
  banksClient: BanksClient,
  params: WithdrawIneligibleRewardParams
): Promise<void> {
  const { index, pool, funder } = params;
  const program = createCpAmmProgram();

  const poolState = await getPool(banksClient, pool);
  const poolAuthority = derivePoolAuthority();
  const funderTokenAccount = getAssociatedTokenAddressSync(
    poolState.rewardInfos[index].mint,
    funder.publicKey
  );

  const transaction = await program.methods
    .withdrawIneligibleReward(index)
    .accounts({
      pool,
      rewardVault: poolState.rewardInfos[index].vault,
      rewardMint: poolState.rewardInfos[index].mint,
      poolAuthority,
      funderTokenAccount,
      funder: funder.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(funder);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export async function refreshVestings(
  banksClient: BanksClient,
  position: PublicKey,
  pool: PublicKey,
  owner: PublicKey,
  payer: Keypair,
  vestings: PublicKey[]
) {
  const program = createCpAmmProgram();

  const transaction = await program.methods
    .refreshVesting()
    .accounts({
      position,
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

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export async function permanentLockPosition(
  banksClient: BanksClient,
  position: PublicKey,
  owner: Keypair,
  payer: Keypair
) {
  const program = createCpAmmProgram();

  const positionState = await getPosition(banksClient, position);

  const transaction = await program.methods
    .permanentLockPosition(positionState.unlockedLiquidity)
    .accounts({
      position,
      pool: positionState.pool,
      owner: owner.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer, owner);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export async function lockPosition(
  banksClient: BanksClient,
  position: PublicKey,
  owner: Keypair,
  payer: Keypair,
  params: LockPositionParams
) {
  const program = createCpAmmProgram();
  const positionState = await getPosition(banksClient, position);

  const vestingKP = Keypair.generate();

  const transaction = await program.methods
    .lockPosition(params)
    .accounts({
      position,
      vesting: vestingKP.publicKey,
      owner: owner.publicKey,
      pool: positionState.pool,
      program: CP_AMM_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      payer: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer, owner, vestingKP);

  await processTransactionMaybeThrow(banksClient, transaction);

  return vestingKP.publicKey;
}

export async function createPosition(
  banksClient: BanksClient,
  payer: Keypair,
  owner: PublicKey,
  pool: PublicKey
): Promise<PublicKey> {
  const program = createCpAmmProgram();

  const position = derivePositionAddress(pool, owner);

  const transaction = await program.methods
    .createPosition()
    .accounts({
      owner,
      payer: payer.publicKey,
      pool,
      position,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  await processTransactionMaybeThrow(banksClient, transaction);

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

export async function addLiquidity(
  banksClient: BanksClient,
  params: AddLiquidityParams
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
  const poolState = await getPool(banksClient, pool);
  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey
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
    .accounts({
      pool,
      position,
      owner: owner.publicKey,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(owner);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type RemoveLiquidityParams = AddLiquidityParams;

export async function removeLiquidity(
  banksClient: BanksClient,
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
  const poolState = await getPool(banksClient, pool);

  const poolAuthority = derivePoolAuthority();
  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .removeLiquidity({
      maxLiquidityDelta: liquidityDelta,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
    })
    .accounts({
      poolAuthority,
      pool,
      position,
      owner: owner.publicKey,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(owner);

  await processTransactionMaybeThrow(banksClient, transaction);
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

export async function swap(banksClient: BanksClient, params: SwapParams) {
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
  const poolState = await getPool(banksClient, pool);

  const poolAuthority = derivePoolAuthority();
  const inputTokenAccount = getAssociatedTokenAddressSync(
    inputTokenMint,
    payer.publicKey
  );
  const outputTokenAccount = getAssociatedTokenAddressSync(
    outputTokenMint,
    payer.publicKey
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
    .accounts({
      poolAuthority,
      pool,
      payer: payer.publicKey,
      inputTokenAccount,
      outputTokenAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      tokenAMint,
      tokenBMint,
      referralTokenAccount,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type ClaimpositionFeeParams = {
  owner: Keypair;
  pool: PublicKey;
  position: PublicKey;
};

export async function claimPositionFee(
  banksClient: BanksClient,
  params: ClaimpositionFeeParams
) {
  const { owner, pool, position } = params;

  const program = createCpAmmProgram();
  const poolState = await getPool(banksClient, pool);

  const poolAuthority = derivePoolAuthority();
  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    owner.publicKey
  );
  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    owner.publicKey
  );
  const tokenAVault = poolState.tokenAVault;
  const tokenBVault = poolState.tokenBVault;
  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const transaction = await program.methods
    .claimPositionFee()
    .accounts({
      poolAuthority,
      owner: owner.publicKey,
      pool,
      position,
      tokenAAccount,
      tokenBAccount,
      tokenAVault,
      tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      tokenAMint,
      tokenBMint,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(owner);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export async function getPool(
  banksClient: BanksClient,
  pool: PublicKey
): Promise<Pool> {
  const program = createCpAmmProgram();
  const account = await banksClient.getAccount(pool);
  return program.coder.accounts.decode("Pool", Buffer.from(account.data));
}

export async function getPosition(
  banksClient: BanksClient,
  position: PublicKey
): Promise<Position> {
  const program = createCpAmmProgram();
  const account = await banksClient.getAccount(position);
  return program.coder.accounts.decode("Position", Buffer.from(account.data));
}

export async function getVesting(
  banksClient: BanksClient,
  vesting: PublicKey
): Promise<Vesting> {
  const program = createCpAmmProgram();
  const account = await banksClient.getAccount(vesting);
  return program.coder.accounts.decode("Vesting", Buffer.from(account.data));
}

export async function getConfig(
  banksClient: BanksClient,
  config: PublicKey
): Promise<Config> {
  const program = createCpAmmProgram();
  const account = await banksClient.getAccount(config);
  return program.coder.accounts.decode("Config", Buffer.from(account.data));
}

export function getStakeProgramErrorCodeHexString(errorMessage: String) {
  const error = CpAmmIDL.errors.find(
    (e) =>
      e.name.toLowerCase() === errorMessage.toLowerCase() ||
      e.msg.toLowerCase() === errorMessage.toLowerCase()
  );

  if (!error) {
    throw new Error(`Unknown CP AMM error message / name: ${errorMessage}`);
  }

  return "0x" + error.code.toString(16);
}

export async function getTokenBadge(
  banksClient: BanksClient,
  tokenBadge: PublicKey
): Promise<TokenBadge> {
  const program = createCpAmmProgram();
  const account = await banksClient.getAccount(tokenBadge);
  return program.coder.accounts.decode("TokenBadge", Buffer.from(account.data));
}
