import {
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  ExtensionType,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMetadataPointerInstruction,
  createMintToInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferHookInstruction,
  createUpdateTransferHookInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { DECIMALS } from "./constants";
import { getOrCreateAssociatedTokenAccount } from "./token";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./transferHook";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { sendTransaction } from ".";
import { expect } from "chai";
const rawAmount = 1_000_000_000 * 10 ** DECIMALS; // 1 millions

interface ExtensionWithInstruction {
  extension: ExtensionType;
  instruction: TransactionInstruction;
}

export function createPermenantDelegateExtensionWithInstruction(
  mint: PublicKey,
  permenantDelegate: PublicKey
): ExtensionWithInstruction {
  return {
    extension: ExtensionType.PermanentDelegate,
    instruction: createInitializePermanentDelegateInstruction(
      mint,
      permenantDelegate,
      TOKEN_2022_PROGRAM_ID
    ),
  };
}

export function createTransferFeeExtensionWithInstruction(
  mint: PublicKey,
  maxFee?: bigint,
  feeBasisPoint?: number,
  transferFeeConfigAuthority?: Keypair,
  withdrawWithheldAuthority?: Keypair
): ExtensionWithInstruction {
  maxFee = maxFee || BigInt(9 * Math.pow(10, DECIMALS));
  feeBasisPoint = feeBasisPoint || 100;
  transferFeeConfigAuthority = transferFeeConfigAuthority || Keypair.generate();
  withdrawWithheldAuthority = withdrawWithheldAuthority || Keypair.generate();
  return {
    extension: ExtensionType.TransferFeeConfig,
    instruction: createInitializeTransferFeeConfigInstruction(
      mint,
      transferFeeConfigAuthority.publicKey,
      withdrawWithheldAuthority.publicKey,
      feeBasisPoint,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    ),
  };
}

export function createTransferHookExtensionWithInstruction(
  mint: PublicKey,
  authority: PublicKey
): ExtensionWithInstruction {
  return {
    extension: ExtensionType.TransferHook,
    instruction: createInitializeTransferHookInstruction(
      mint,
      authority,
      TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    ),
  };
}

export async function createToken2022(
  svm: LiteSVM,
  extensions: ExtensionWithInstruction[],
  mintKeypair: Keypair,
  mintAuthority: PublicKey
): Promise<PublicKey> {
  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
  let mintLen = getMintLen(extensions.map((ext) => ext.extension));
  const mintLamports = svm.getRent().minimumBalance(BigInt(mintLen));
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: Number(mintLamports.toString()),
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    ...extensions.map((ext) => ext.instruction),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      DECIMALS,
      mintAuthority,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const result = sendTransaction(svm, transaction, [payer, mintKeypair]);

  expect(result).instanceOf(TransactionMetadata);

  return mintKeypair.publicKey;
}

export async function mintToToken2022(
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
    toWallet,
    TOKEN_2022_PROGRAM_ID
  );
  const mintIx = createMintToInstruction(
    mint,
    destination,
    mintAuthority.publicKey,
    rawAmount,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  let transaction = new Transaction();
  transaction.add(mintIx);

  const result = sendTransaction(svm, transaction, [payer, mintAuthority]);

  expect(result).instanceOf(TransactionMetadata);
}

export async function revokeAuthorityAndProgramIdTransferHook(
  svm: LiteSVM,
  authority: Keypair,
  mint: PublicKey
) {
  const transaction = new Transaction().add(
    createUpdateTransferHookInstruction(
      mint,
      authority.publicKey,
      PublicKey.default,
      [],
      TOKEN_2022_PROGRAM_ID
    ),
    createSetAuthorityInstruction(
      mint,
      authority.publicKey,
      AuthorityType.TransferHookProgramId,
      null,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const result = sendTransaction(svm, transaction, [authority]);

  expect(result).instanceOf(TransactionMetadata);
}
