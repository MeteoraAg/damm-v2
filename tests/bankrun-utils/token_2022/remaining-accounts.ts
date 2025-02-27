import { AccountMeta } from "@solana/web3.js";

export enum RemainingAccountsType {
  TransferHookEscrow = "transferHookEscrow",
}

type RemainingAccountsAnchorType = { transferHookEscrow: {} };

export type RemainingAccountsSliceData = {
  accountsType: RemainingAccountsAnchorType;
  length: number;
};

export type RemainingAccountsInfoData = {
  slices: RemainingAccountsSliceData[];
};

// Option<RemainingAccountsInfoData> on Rust
// null is treated as None in Rust. undefined doesn't work.
export type OptionRemainingAccountsInfoData = RemainingAccountsInfoData | null;

export class RemainingAccountsBuilder {
  private remainingAccounts: AccountMeta[] = [];
  private slices: RemainingAccountsSliceData[] = [];

  constructor() {}

  addSlice(
    accountsType: RemainingAccountsType,
    accounts?: AccountMeta[]
  ): this {
    if (!accounts || accounts.length === 0) return this;

    this.slices.push({
      accountsType: { [accountsType]: {} } as RemainingAccountsAnchorType,
      length: accounts.length,
    });
    this.remainingAccounts.push(...accounts);

    return this;
  }

  build(): [OptionRemainingAccountsInfoData, AccountMeta[] | undefined] {
    return this.slices.length === 0
      ? [null, undefined]
      : [{ slices: this.slices }, this.remainingAccounts];
  }
}
