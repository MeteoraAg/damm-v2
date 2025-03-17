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
const rawAmount = 1_000_000 * 10 ** DECIMALS; // 1 millions

export async function createToken2022(
  banksClient: BanksClient,
  payer: Keypair,
  extensions: ExtensionType[]
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
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

  return mintKeypair.publicKey;
}

export async function mintToToken2022(
  banksClient: BanksClient,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  toWallet: PublicKey
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
    rawAmount,
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
