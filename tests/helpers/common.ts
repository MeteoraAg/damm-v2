import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import CpAmmIDL from "../../target/idl/cp_amm.json";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { sendTransaction } from "./svm";
import { expect } from "chai";

export async function transferSol(
  svm: LiteSVM,
  from: Keypair,
  to: PublicKey,
  amount: BN
) {
  const systemTransferIx = SystemProgram.transfer({
    fromPubkey: from.publicKey,
    toPubkey: to,
    lamports: BigInt(amount.toString()),
  });

  let transaction = new Transaction().add(systemTransferIx);
  const result = sendTransaction(svm, transaction, [from]);
  expect(result).instanceOf(TransactionMetadata);
}

export function getCpAmmProgramErrorCode(errorMessage: String) {
  const error = CpAmmIDL.errors.find(
    (e) =>
      e.name.toLowerCase() === errorMessage.toLowerCase() ||
      e.msg.toLowerCase() === errorMessage.toLowerCase()
  );

  if (!error) {
    throw new Error(`Unknown CP AMM error message / name: ${errorMessage}`);
  }

  return error.code;
}

export function generateKpAndFund(svm: LiteSVM): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
  return kp;
}

export function randomID(min = 0, max = 10000) {
  return Math.floor(Math.random() * (max - min) + min);
}

export function convertToByteArray(value: BN): number[] {
  return Array.from(value.toArrayLike(Buffer, "le", 8));
}

export function convertToRateLimiterSecondFactor(
  maxLimiterDuration: BN,
  maxFeeBps: BN
): number[] {
  const buffer1 = maxLimiterDuration.toArrayLike(Buffer, "le", 4);
  const buffer2 = maxFeeBps.toArrayLike(Buffer, "le", 4);
  const buffer = Buffer.concat([buffer1, buffer2]);
  return Array.from(buffer);
}
