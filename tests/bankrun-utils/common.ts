import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  BanksClient,
  Clock,
  ProgramTestContext,
  startAnchor,
} from "solana-bankrun";
import { CP_AMM_PROGRAM_ID, DECIMALS } from "./constants";
import BN, { min } from "bn.js";
import { createMint, getMint, getTokenAccount, mintTo, wrapSOL } from "./token";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";

// bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1
export const LOCAL_ADMIN_KEYPAIR = Keypair.fromSecretKey(
  Uint8Array.from([
    230, 207, 238, 109, 95, 154, 47, 93, 183, 250, 147, 189, 87, 15, 117, 184,
    44, 91, 94, 231, 126, 140, 238, 134, 29, 58, 8, 182, 88, 22, 113, 234, 8,
    234, 192, 109, 87, 125, 190, 55, 129, 173, 227, 8, 104, 201, 104, 13, 31,
    178, 74, 80, 54, 14, 77, 78, 226, 57, 47, 122, 166, 165, 57, 144,
  ])
);

export async function startTest() {
  // Program name need to match fixtures program name
  return startAnchor(
    "./",
    [
      {
        name: "cp_amm",
        programId: new PublicKey(CP_AMM_PROGRAM_ID),
      },
    ],
    [
      {
        address: LOCAL_ADMIN_KEYPAIR.publicKey,
        info: {
          executable: false,
          owner: SystemProgram.programId,
          lamports: LAMPORTS_PER_SOL * 100,
          data: new Uint8Array(),
        },
      },
    ]
  );
}

export async function transferSol(
  banksClient: BanksClient,
  from: Keypair,
  to: PublicKey,
  amount: BN
) {
  const systemTransferIx = SystemProgram.transfer({
    fromPubkey: from.publicKey,
    toPubkey: to,
    lamports: BigInt(amount.toString()),
  });

  let transaction = new Transaction();
  const [recentBlockhash] = await banksClient.getLatestBlockhash();
  transaction.recentBlockhash = recentBlockhash;
  transaction.add(systemTransferIx);
  transaction.sign(from);

  await banksClient.processTransaction(transaction);
}

export async function processTransactionMaybeThrow(
  banksClient: BanksClient,
  transaction: Transaction
) {
  const transactionMeta = await banksClient.tryProcessTransaction(transaction);
  if (transactionMeta.result && transactionMeta.result.length > 0) {
    throw Error(transactionMeta.result);
  }
}

export async function expectThrowsAsync(
  fn: () => Promise<void>,
  errorMessage: String
) {
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    } else {
      if (!err.message.toLowerCase().includes(errorMessage.toLowerCase())) {
        throw new Error(
          `Unexpected error: ${err.message}. Expected error: ${errorMessage}`
        );
      }
      return;
    }
  }
  throw new Error("Expected an error but didn't get one");
}

export async function setupTokenMint(
  banksClient: BanksClient,
  payer: Keypair,
  toWallet: PublicKey,
  rawAmount: bigint
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();

  await createMint(banksClient, payer, mintKeypair, payer.publicKey, DECIMALS);

  await mintTo(
    banksClient,
    payer,
    mintKeypair.publicKey,
    payer,
    toWallet,
    rawAmount
  );

  return mintKeypair.publicKey;
}

export async function createUsersAndFund(
  banksClient: BanksClient,
  payer: Keypair,
  user?: Keypair
): Promise<Keypair> {
  if (!user) {
    user = Keypair.generate();
  }

  await transferSol(
    banksClient,
    payer,
    user.publicKey,
    new BN(LAMPORTS_PER_SOL)
  );

  return user;
}

export async function setupTestContext(
  banksClient: BanksClient,
  rootKeypair: Keypair
) {
  const [admin, payer, poolCreator, user] = Array(4)
    .fill(4)
    .map(() => Keypair.generate());

  await Promise.all(
    [admin.publicKey, payer.publicKey, user.publicKey].map((publicKey) =>
      transferSol(banksClient, rootKeypair, publicKey, new BN(LAMPORTS_PER_SOL))
    )
  );

  const tokenAMintKeypair = Keypair.generate();
  const tokenBMintKeypair = Keypair.generate();

  await Promise.all([
    createMint(
      banksClient,
      rootKeypair,
      tokenAMintKeypair,
      rootKeypair.publicKey,
      DECIMALS
    ),
    createMint(
      banksClient,
      rootKeypair,
      tokenBMintKeypair,
      rootKeypair.publicKey,
      DECIMALS
    ),
  ]);
  //
  const rawAmount = 1000 * 10 ** DECIMALS;

  // Mint token A to payer & user
  await Promise.all(
    [payer.publicKey, user.publicKey].map((publicKey) =>
      mintTo(
        banksClient,
        rootKeypair,
        tokenAMintKeypair.publicKey,
        rootKeypair,
        publicKey,
        BigInt(rawAmount)
      )
    )
  );

  // Mint token B to payer & user
  await Promise.all(
    [payer.publicKey, user.publicKey].map((publicKey) =>
      mintTo(
        banksClient,
        rootKeypair,
        tokenBMintKeypair.publicKey,
        rootKeypair,
        publicKey,
        BigInt(rawAmount)
      )
    )
  );

  return {
    admin,
    payer,
    poolCreator,
    tokenAMint: tokenAMintKeypair.publicKey,
    tokenBMint: tokenBMintKeypair.publicKey,
    user,
  };
}

export function randomID(min = 0, max = 10000) {
  return Math.floor(Math.random() * (max - min) + min);
}
