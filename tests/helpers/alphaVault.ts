import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import AlphaVaultIDL from "./idl/alpha_vault.json";
import { AlphaVault } from "./idl/alpha_vault";
import { ALPHA_VAULT_PROGRAM_ID } from "./constants";
import { createCpAmmProgram, getPool } from "./cpAmm";
import { derivePoolAuthority } from "./accounts";
import { getOrCreateAssociatedTokenAccount, wrapSOL } from "./token";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import { sendTransaction } from "./svm";
import { expect } from "chai";

export const ALPHA_VAULT_TREASURY_ID = new PublicKey(
  "BJQbRiRWhJCyTYZcAuAL3ngDCx3AyFQGKDq8zhiZAKUw"
);

export interface DepositAlphaVaultParams {
  amount: BN;
  alphaVault: PublicKey;
  ownerKeypair: Keypair;
  payer: Keypair;
}

export type WhitelistMode = 0 | 1 | 2;

export interface SetupProrataAlphaVaultParams {
  quoteMint: PublicKey;
  baseMint: PublicKey;
  pool: PublicKey;
  poolType: number;
  maxBuyingCap: BN;
  startVestingPoint: BN;
  endVestingPoint: BN;
  escrowFee: BN;
  payer: Keypair;
  whitelistMode: WhitelistMode;
  baseKeypair: Keypair;
}

export function deriveAlphaVaultEscrow(
  alphaVault: PublicKey,
  owner: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), alphaVault.toBuffer(), owner.toBuffer()],
    ALPHA_VAULT_PROGRAM_ID
  );
}

export function deriveAlphaVault(base: PublicKey, lbPair: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), base.toBuffer(), lbPair.toBuffer()],
    ALPHA_VAULT_PROGRAM_ID
  );
}

export function deriveCrankFeeWhitelist(owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("crank_fee_whitelist"), owner.toBuffer()],
    ALPHA_VAULT_PROGRAM_ID
  );
}

export function createAlphaVaultProgram() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  const program = new Program<AlphaVault>(
    AlphaVaultIDL as AlphaVault,
    provider
  );
  return program;
}

export function getVaultState(svm: LiteSVM, alphaVault: PublicKey): any {
  const alphaVaultProgram = createAlphaVaultProgram();

  const alphaVaultAccount = svm.getAccount(alphaVault);
  return alphaVaultProgram.coder.accounts.decode(
    "vault",
    Buffer.from(alphaVaultAccount.data)
  );
}

export async function setupProrataAlphaVault(
  svm: LiteSVM,
  params: SetupProrataAlphaVaultParams
): Promise<PublicKey> {
  let {
    quoteMint,
    baseMint,
    pool,
    poolType,
    maxBuyingCap,
    startVestingPoint,
    endVestingPoint,
    payer,
    escrowFee,
    whitelistMode,
    baseKeypair,
  } = params;

  const alphaVaultProgram = createAlphaVaultProgram();

  const baseMintAccount = svm.getAccount(baseMint);
  const quoteMintAccount = svm.getAccount(quoteMint);

  let [alphaVault] = deriveAlphaVault(baseKeypair.publicKey, pool);

  getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    quoteMint,
    alphaVault,
    quoteMintAccount.owner
  );

  getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    baseMint,
    alphaVault,
    baseMintAccount.owner
  );

  const transaction = await alphaVaultProgram.methods
    .initializeProrataVault({
      poolType,
      quoteMint,
      baseMint,
      maxBuyingCap,
      depositingPoint: new BN(0),
      startVestingPoint,
      endVestingPoint,
      escrowFee,
      whitelistMode,
    })
    .accountsPartial({
      vault: alphaVault,
      pool,
      funder: payer.publicKey,
      base: baseKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [payer, baseKeypair]);
  expect(result).instanceOf(TransactionMetadata);

  return alphaVault;
}

export async function depositAlphaVault(
  svm: LiteSVM,
  params: DepositAlphaVaultParams
) {
  let { amount, ownerKeypair, alphaVault, payer } = params;
  const alphaVaultProgram = createAlphaVaultProgram();

  const alphaVaultAccount = svm.getAccount(alphaVault);
  let alphaVaultState = alphaVaultProgram.coder.accounts.decode(
    "vault",
    Buffer.from(alphaVaultAccount.data)
  );
  const quoteMintAccount = svm.getAccount(alphaVaultState.quoteMint);

  let [escrow] = deriveAlphaVaultEscrow(alphaVault, ownerKeypair.publicKey);

  const escrowData = svm.getAccount(escrow);
  if (!escrowData) {
    const createEscrowTx = await alphaVaultProgram.methods
      .createNewEscrow()
      .accountsPartial({
        owner: ownerKeypair.publicKey,
        vault: alphaVault,
        pool: alphaVaultState.pool,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        escrow,
        escrowFeeReceiver: ALPHA_VAULT_TREASURY_ID,
      })
      .transaction();

    const result = sendTransaction(svm, createEscrowTx, [payer]);

    expect(result).instanceOf(TransactionMetadata);
  }

  if (alphaVaultState.quoteMint.equals(NATIVE_MINT)) {
    wrapSOL(svm, payer, amount);
  }

  let sourceToken = getAssociatedTokenAddressSync(
    alphaVaultState.quoteMint,
    ownerKeypair.publicKey,
    true,
    quoteMintAccount.owner,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const transaction = await alphaVaultProgram.methods
    .deposit(amount)
    .accountsPartial({
      vault: alphaVault,
      pool: alphaVaultState.pool,
      escrow,
      sourceToken,
      tokenVault: alphaVaultState.tokenVault,
      tokenMint: alphaVaultState.quoteMint,
      tokenProgram: quoteMintAccount.owner,
      owner: ownerKeypair.publicKey,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [ownerKeypair]);

  expect(result).instanceOf(TransactionMetadata);
}

export async function fillDammV2(
  svm: LiteSVM,
  pool: PublicKey,
  alphaVault: PublicKey,
  onwer: Keypair,
  maxAmount: BN
) {
  const alphaVaultProgram = createAlphaVaultProgram();
  const ammProgram = createCpAmmProgram();
  const alphaVaultAccount = svm.getAccount(alphaVault);
  let alphaVaultState = alphaVaultProgram.coder.accounts.decode(
    "vault",
    Buffer.from(alphaVaultAccount.data)
  );

  let poolState = getPool(svm, pool);
  const tokenAProgram =
    poolState.tokenAFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const tokenBProgram =
    poolState.tokenBFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const dammEventAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    ammProgram.programId
  )[0];

  const [crankFeeWhitelist] = deriveCrankFeeWhitelist(onwer.publicKey);
  const crankFeeWhitelistAccount = svm.getAccount(crankFeeWhitelist);

  const transaction = await alphaVaultProgram.methods
    .fillDammV2(maxAmount)
    .accountsPartial({
      vault: alphaVault,
      tokenVault: alphaVaultState.tokenVault,
      tokenOutVault: alphaVaultState.tokenOutVault,
      ammProgram: ammProgram.programId,
      poolAuthority: derivePoolAuthority(),
      pool,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAProgram,
      tokenBProgram,
      dammEventAuthority,
      cranker: onwer.publicKey,
      crankFeeWhitelist: crankFeeWhitelistAccount
        ? crankFeeWhitelist
        : ALPHA_VAULT_PROGRAM_ID,
      crankFeeReceiver: crankFeeWhitelistAccount
        ? ALPHA_VAULT_PROGRAM_ID
        : ALPHA_VAULT_TREASURY_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      }),
    ])
    .transaction();

  const result = sendTransaction(svm, transaction, [onwer]);
  expect(result).instanceOf(TransactionMetadata);
}
