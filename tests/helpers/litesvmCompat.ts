import {
  address,
  getTransactionDecoder,
  lamports as toLamports,
  type Address,
  type EncodedAccount,
} from "@solana/kit";
import {
  AccountInfo,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Clock,
  FailedTransactionMetadata,
  LiteSVM as KitLiteSVM,
  Rent,
  TransactionMetadata,
} from "litesvm";

export type AccountInfoBytes = AccountInfo<Uint8Array>;

function toAddress(pubkey: PublicKey): Address {
  return address(pubkey.toBase58());
}

/**
 * litesvm 1.x takes and returns `@solana/kit` types (`Address`, `EncodedAccount`, kit
 * `Transaction`). The test suite is written against `@solana/web3.js`, so this wrapper keeps the
 * litesvm 0.x method signatures and converts between the two type systems at the boundary.
 * Only the methods the tests call are exposed.
 */
export class LiteSVM {
  private readonly inner: KitLiteSVM;

  constructor() {
    this.inner = new KitLiteSVM();
  }

  // Returns `null` when the account does not exist, which matches litesvm 0.x
  getAccount(pubkey: PublicKey): AccountInfoBytes | null {
    const account = this.inner.getAccount(toAddress(pubkey));
    if (!account.exists) {
      return null;
    }
    return {
      data: new Uint8Array(account.data),
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: new PublicKey(account.programAddress),
    };
  }

  setAccount(pubkey: PublicKey, info: AccountInfoBytes): void {
    const account: EncodedAccount = {
      address: toAddress(pubkey),
      data: info.data,
      executable: info.executable,
      lamports: toLamports(BigInt(info.lamports)),
      programAddress: toAddress(info.owner),
      space: BigInt(info.data.length),
    };
    this.inner.setAccount(account);
  }

  airdrop(
    pubkey: PublicKey,
    amount: bigint
  ): TransactionMetadata | FailedTransactionMetadata | null {
    return this.inner.airdrop(toAddress(pubkey), toLamports(amount));
  }

  addProgramFromFile(programId: PublicKey, path: string): void {
    this.inner.addProgramFromFile(toAddress(programId), path);
  }

  sendTransaction(
    tx: Transaction | VersionedTransaction
  ): TransactionMetadata | FailedTransactionMetadata {
    const wire = tx.serialize();
    return this.inner.sendTransaction(getTransactionDecoder().decode(wire));
  }

  latestBlockhash(): string {
    return this.inner.latestBlockhash();
  }

  expireBlockhash(): void {
    this.inner.expireBlockhash();
  }

  warpToSlot(slot: bigint): void {
    this.inner.warpToSlot(slot);
  }

  getClock(): Clock {
    return this.inner.getClock();
  }

  setClock(clock: Clock): void {
    this.inner.setClock(clock);
  }

  getRent(): Rent {
    return this.inner.getRent();
  }
}
