import { PublicKey, Signer, SystemProgram, Transaction } from "@solana/web3.js";
import {
  AccountInfoBytes,
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import { expect } from "chai";
import BN from "bn.js";
import { CP_AMM_PROGRAM_ID } from ".";
import path from "path";

export function startSvm() {
  const svm = new LiteSVM();

  const sourceFilePath = path.resolve("./target/deploy/cp_amm.so");
  svm.addProgramFromFile(new PublicKey(CP_AMM_PROGRAM_ID), sourceFilePath);

  const accountInfo: AccountInfoBytes = {
    data: new Uint8Array(),
    executable: false,
    lamports: 1200626308,
    owner: SystemProgram.programId,
  };

  svm.setAccount(
    new PublicKey("4EWqcx3aNZmMetCnxwLYwyNjan6XLGp3Ca2W316vrSjv"),
    accountInfo
  );

  return svm;
}

export function sendTransaction(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Signer[]
) {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(...signers);
  return svm.sendTransaction(transaction);
}

export function sendTransactionOrExpectThrowError(
  svm: LiteSVM,
  transaction: Transaction,
  logging = false,
  errorCode?: number
) {
  const result = svm.sendTransaction(transaction);
  if (logging) {
    if (result instanceof TransactionMetadata) {
      console.log(result.logs());
    } else {
      console.log(result.meta().logs());
    }
  }
  if (errorCode) {
    expectThrowsErrorCode(result, errorCode);
  } else {
    expect(result).instanceOf(TransactionMetadata);
  }

  return result;
}

export function expectThrowsErrorCode(
  response: TransactionMetadata | FailedTransactionMetadata,
  errorCode: number
) {
  if (response instanceof FailedTransactionMetadata) {
    const message = response.err().toString();

    if (!message.toString().includes(errorCode.toString())) {
      throw new Error(
        `Unexpected error: ${message}. Expected error: ${errorCode}`
      );
    }

    return;
  } else {
    throw new Error("Expected an error but didn't get one");
  }
}

export function warpToTimestamp(svm: LiteSVM, timestamp: BN) {
  let clock = svm.getClock();
  clock.unixTimestamp = BigInt(timestamp.toString());
  svm.setClock(clock);
}

export function warpSlotBy(svm: LiteSVM, slots: BN) {
  const clock = svm.getClock();
  svm.warpToSlot(clock.slot + BigInt(slots.toString()));
}
