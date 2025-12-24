import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Signer, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  AccountInfoBytes,
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import path from "path";
import {
  ALPHA_VAULT_PROGRAM_ID,
  CP_AMM_PROGRAM_ID,
  createCpAmmProgram,
  JUPITER_V6_PROGRAM_ID,
  NATIVE_MINT,
  ZAP_PROGRAM_ID,
} from ".";
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
  const sourceFileZapProgramPath = path.resolve("./tests/fixtures/zap.so");
  const sourceFileJupiterPath = path.resolve("./tests/fixtures/jupiter.so");
  svm.addProgramFromFile(new PublicKey(CP_AMM_PROGRAM_ID), sourceFileCpammPath);
  svm.addProgramFromFile(
    new PublicKey(ALPHA_VAULT_PROGRAM_ID),
    sourceFileAlphaVaultPath
  );
  svm.addProgramFromFile(
    new PublicKey(TRANSFER_HOOK_COUNTER_PROGRAM_ID),
    sourceFileTransferhookPath
  );
  svm.addProgramFromFile(JUPITER_V6_PROGRAM_ID, sourceFileJupiterPath);
  svm.addProgramFromFile(ZAP_PROGRAM_ID, sourceFileZapProgramPath);
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

  svm.setAccount(NATIVE_MINT, {
    owner: TOKEN_PROGRAM_ID,
    lamports: 1461600,
    data: Buffer.from([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 1, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0,
    ]),
    executable: false,
  });

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

export function parseEventInstruction(
  metadata: TransactionMetadata,
  eventName: string
) {
  const program = createCpAmmProgram();

  const innerInstructions = metadata.innerInstructions();

  for (const i of innerInstructions) {
    for (const j of i) {
      const data = j.instruction().data();
      const eventData = base64.encode(Buffer.from(data.slice(8)));
      const event = program.coder.events.decode(eventData);
      if (event) {
        if (event.name === eventName) {
          return event;
        }
      }
    }
  }

  return null;
}
