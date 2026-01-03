import { AnchorProvider, Program, Wallet, web3 } from "@coral-xyz/anchor";
import TransferHookIdl from "./idl/transfer_hook.json";
import { TransferHookCounter } from "./idl/transfer_hook";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { sendTransaction } from "..";
import { expect } from "chai";

export const TRANSFER_HOOK_COUNTER_PROGRAM_ID = new web3.PublicKey(
  "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS"
);

export function createTransferHookCounterProgram(): Program<TransferHookCounter> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );

  const program = new Program<TransferHookCounter>(
    TransferHookIdl as TransferHookCounter,
    provider
  );

  return program;
}

export function deriveExtraAccountMetaList(mint: PublicKey) {
  const [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    TRANSFER_HOOK_COUNTER_PROGRAM_ID
  );

  return extraAccountMetaListPda;
}

export async function createExtraAccountMetaListAndCounter(
  svm: LiteSVM,
  payer: Keypair,
  mint: web3.PublicKey
) {
  const program = createTransferHookCounterProgram();
  const extraAccountMetaList = deriveExtraAccountMetaList(mint);
  const counterAccount = deriveCounter(mint, program.programId);

  const transaction = await program.methods
    .initializeExtraAccountMetaList()
    .accountsPartial({
      mint,
      counterAccount,
      extraAccountMetaList,
      payer: payer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  const result = sendTransaction(svm, transaction, [payer]);
  expect(result).instanceOf(TransactionMetadata);
  return [extraAccountMetaList, counterAccount];
}

export function deriveCounter(mint: web3.PublicKey, programId: web3.PublicKey) {
  const [counter] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.toBuffer()],
    programId
  );

  return counter;
}
