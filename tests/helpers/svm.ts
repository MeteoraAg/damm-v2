import { PublicKey, Signer, SystemProgram, Transaction } from "@solana/web3.js";
import {
  AccountInfoBytes,
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import { expect } from "chai";
import BN from "bn.js";
import { ALPHA_VAULT_PROGRAM_ID, CP_AMM_PROGRAM_ID } from ".";
import path from "path";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./transferHook";

export function startSvm() {
  const svm = new LiteSVM();

  const sourceFileCpammPath = path.resolve("./target/deploy/cp_amm.so");
  const sourceFileAlphaVaultPath = path.resolve(
    "./tests/fixtures/alpha_vault.so"
  );
  const sourceFileTransferhookPath = path.resolve(
    "./tests/fixtures/transfer_hook_counter.so"
  );
  svm.addProgramFromFile(new PublicKey(CP_AMM_PROGRAM_ID), sourceFileCpammPath);
  svm.addProgramFromFile(
    new PublicKey(ALPHA_VAULT_PROGRAM_ID),
    sourceFileAlphaVaultPath
  );
  svm.addProgramFromFile(
    new PublicKey(TRANSFER_HOOK_COUNTER_PROGRAM_ID),
    sourceFileTransferhookPath
  );

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
  const result = svm.sendTransaction(transaction);
  svm.expireBlockhash();

  return result;
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
