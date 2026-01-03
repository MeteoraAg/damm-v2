import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createFreezeAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  MintLayout,
  RawMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { DECIMALS, NATIVE_MINT } from "./constants";
import { sendTransaction } from "./svm";
const rawAmount = 100_000_000 * 10 ** DECIMALS; // 1 millions

export function getOrCreateAssociatedTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID
) {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint,
      tokenProgram
    );
    let transaction = new Transaction();
    transaction.add(createAtaIx);

    const result = sendTransaction(svm, transaction, [payer]);
    expect(result).instanceOf(TransactionMetadata);
  }

  return ataKey;
}

export function createToken(
  svm: LiteSVM,
  mintAuthority: PublicKey,
  freezeAuthority?: PublicKey
): PublicKey {
  const mintKeypair = Keypair.generate();
  const rent = svm.getRent();
  const lamports = rent.minimumBalance(BigInt(MINT_SIZE));

  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: MINT_SIZE,
    lamports: Number(lamports.toString()),
    programId: TOKEN_PROGRAM_ID,
  });

  const initializeMintIx = createInitializeMint2Instruction(
    mintKeypair.publicKey,
    DECIMALS,
    mintAuthority,
    freezeAuthority
  );

  let transaction = new Transaction();

  transaction.add(createAccountIx, initializeMintIx);

  const result = sendTransaction(svm, transaction, [payer, mintKeypair]);
  expect(result).instanceOf(TransactionMetadata);

  return mintKeypair.publicKey;
}

export function freezeTokenAccount(
  svm: LiteSVM,
  freezeAuthority: Keypair,
  tokenMint: PublicKey,
  tokenAccount: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID
) {
  const freezeInstruction = createFreezeAccountInstruction(
    tokenAccount,
    tokenMint,
    freezeAuthority.publicKey,
    [],
    tokenProgram
  );
  let transaction = new Transaction();

  transaction.add(freezeInstruction);

  const result = sendTransaction(svm, transaction, [freezeAuthority]);
  expect(result).instanceOf(TransactionMetadata);
}

export function wrapSOL(svm: LiteSVM, payer: Keypair, amount: BN) {
  const solAta = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    NATIVE_MINT,
    payer.publicKey
  );

  const solTransferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: solAta,
    lamports: BigInt(amount.toString()),
  });

  const syncNativeIx = createSyncNativeInstruction(solAta);

  let transaction = new Transaction();
  transaction.add(solTransferIx, syncNativeIx);
  const result = sendTransaction(svm, transaction, [payer]);
  expect(result).instanceOf(TransactionMetadata);
}

export function mintSplTokenTo(
  svm: LiteSVM,
  mint: PublicKey,
  mintAuthority: Keypair,
  toWallet: PublicKey
) {
  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

  const destination = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    mint,
    toWallet
  );

  const mintIx = createMintToInstruction(
    mint,
    destination,
    mintAuthority.publicKey,
    rawAmount
  );

  let transaction = new Transaction();

  transaction.add(mintIx);
  const result = sendTransaction(svm, transaction, [payer, mintAuthority]);
  expect(result).instanceOf(TransactionMetadata);
}

export function getMint(svm: LiteSVM, mint: PublicKey): RawMint {
  const account = svm.getAccount(mint);
  const mintState = MintLayout.decode(account.data);
  return mintState;
}

export function getTokenAccount(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(key);
  const tokenAccountState = AccountLayout.decode(account.data);
  return tokenAccountState;
}

export function getTokenBalance(svm: LiteSVM, ataAccount: PublicKey): string {
  const account = svm.getAccount(ataAccount);
  return account
    ? new BN(AccountLayout.decode(account.data).amount.toString()).toString()
    : "0";
}
