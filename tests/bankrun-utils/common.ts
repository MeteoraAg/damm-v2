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
import { CP_AMM_PROGRAM_ID } from "./cp-amm";
import BN from "bn.js";
import { createMint, getMint, getTokenAccount, mintTo, wrapSOL } from "./token";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";

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

export async function advanceClockBySeconds(
  context: ProgramTestContext,
  seconds: BN
) {
  const clock = await context.banksClient.getClock();
  context.setClock(
    new Clock(
      clock.slot,
      clock.epochStartTimestamp,
      clock.epoch,
      clock.leaderScheduleEpoch,
      clock.unixTimestamp + BigInt(seconds.toString())
    )
  );
}

export async function warpSlotBy(context: ProgramTestContext, slots: BN) {
  const clock = await context.banksClient.getClock();
  context.warpToSlot(clock.slot + BigInt(slots.toString()));
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

interface MemeMintSetupParams {
  mintAmount?: bigint;
  decimals?: number;
  mintAuthority?: Keypair;
}

export async function setupTokenMint(
  banksClient: BanksClient,
  payer: Keypair,
  params: MemeMintSetupParams
) {
  const mintKeypair = Keypair.generate();
  const { mintAmount, decimals, mintAuthority } = params;

  await createMint(
    banksClient,
    payer,
    mintKeypair,
    mintAuthority ? mintAuthority.publicKey : payer.publicKey,
    decimals ?? 9
  );

  const multiplier = new BN(10 ** (decimals ?? 9));

  await mintTo(
    banksClient,
    payer,
    mintKeypair.publicKey,
    mintAuthority ?? payer,
    mintAuthority ? mintAuthority.publicKey : payer.publicKey,
    mintAmount ?? BigInt(new BN("1000000000").mul(multiplier).toString())
  );

  return mintKeypair.publicKey;
}

export interface PoolSetupParams {
  tokenAAmount: BN;
  tokenBAmount: BN;
}

export async function createUsersAndFund(
  banksClient: BanksClient,
  payer: Keypair,
  mintAuthority: Keypair,
  count: number,
  memeMint: PublicKey,
  uiAmount: BN
): Promise<Keypair[]> {
  const users = [];
  const mintState = await getMint(banksClient, memeMint);
  const solMultiplier = new BN(10 ** 9);
  const tokenMultiplier = new BN(10 ** mintState.decimals);

  for (let i = 0; i < count; i++) {
    const user = Keypair.generate();
    users.push(user);

    await mintTo(
      banksClient,
      payer,
      memeMint,
      mintAuthority,
      user.publicKey,
      BigInt(uiAmount.mul(tokenMultiplier).toString())
    );

    await transferSol(
      banksClient,
      payer,
      user.publicKey,
      uiAmount.mul(solMultiplier)
    );
  }
  return users;
}
