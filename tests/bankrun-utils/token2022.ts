import {
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  ExtensionType,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMetadataPointerInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import { DECIMALS } from "./constants";
import { getOrCreateAssociatedTokenAccount } from "./token";

export async function createToken2022(
  banksClient: BanksClient,
  payer: Keypair,
  mintKeypair: Keypair,
  extensions: ExtensionType[]
) {
  const maxFee = BigInt(9 * Math.pow(10, DECIMALS));
  const feeBasisPoints = 100;
  const transferFeeConfigAuthority = Keypair.generate();
  const withdrawWithheldAuthority = Keypair.generate();

  let mintLen = getMintLen(extensions);
  const mintLamports = (await banksClient.getRent()).minimumBalance(
    BigInt(mintLen)
  );
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: Number(mintLamports.toString()),
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      transferFeeConfigAuthority.publicKey,
      withdrawWithheldAuthority.publicKey,
      feeBasisPoints,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      DECIMALS,
      payer.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const [recentBlockhash] = await banksClient.getLatestBlockhash();
  transaction.recentBlockhash = recentBlockhash;
  transaction.sign(payer, mintKeypair);

  await banksClient.processTransaction(transaction);
}

export async function mintToToken2022(
  banksClient: BanksClient,
  payer: Keypair,
  mintAuthority: Keypair,
  mint: PublicKey,
  toWallet: PublicKey,
  amount: bigint
) {
  const destination = await getOrCreateAssociatedTokenAccount(
    banksClient,
    payer,
    mint,
    toWallet,
    TOKEN_2022_PROGRAM_ID
  );
  const mintIx = createMintToInstruction(
    mint,
    destination,
    mintAuthority.publicKey,
    amount,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  let transaction = new Transaction();
  const [recentBlockhash] = await banksClient.getLatestBlockhash();
  transaction.recentBlockhash = recentBlockhash;
  transaction.add(mintIx);
  transaction.sign(payer, mintAuthority);

  await banksClient.processTransaction(transaction);
}
