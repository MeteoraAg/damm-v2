import {
  AnchorProvider,
  BN,
  IdlAccounts,
  Program,
  Wallet,
} from "@coral-xyz/anchor";
import {
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
  deriveConfigAddress,
  derivePoolAddress,
  derivePoolAuthority,
  derivePositionAddress,
  deriveTokenVaultAddress,
} from "./accounts";
import { processTransactionMaybeThrow } from "./common";
import { CP_AMM_PROGRAM_ID } from "./constants";
import { assert, expect } from "chai";

export type Pool = IdlAccounts<CpAmm>["pool"];
export type Position = IdlAccounts<CpAmm>["position"];
export type Config = IdlAccounts<CpAmm>["config"];

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

export type PoolFees = {
  tradeFeeNumerator: BN;
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
  expect(configState.poolFees.tradeFeeNumerator.toNumber()).eq(
    params.poolFees.tradeFeeNumerator.toNumber()
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
  config: PublicKey,
) {
  const program = createCpAmmProgram();
  const transaction = await program.methods
    .closeConfig()
    .accounts({
      config,
      admin: admin.publicKey,
      rentReceiver: admin.publicKey
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const configState = await banksClient.getAccount(config);
  expect(configState).to.be.null;
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
  const position = derivePositionAddress(pool, params.creator);

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

  console.log({
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
  });

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

  return { pool, position };
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
      liquidityDelta,
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

export async function getConfig(
  banksClient: BanksClient,
  config: PublicKey
): Promise<Config> {
  const program = createCpAmmProgram();
  const account = await banksClient.getAccount(config);
  return program.coder.accounts.decode("Config", Buffer.from(account.data));
}
