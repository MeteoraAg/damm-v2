import {
  AccountMeta,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  addExtraAccountMetasForExecute,
  getMint,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { web3 } from "@coral-xyz/anchor";

export const TEST_TRANSFER_HOOK_PROGRAM_ID = new web3.PublicKey(
  "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS"
);

export class TokenExtensionUtil {
  public static async getExtraAccountMetasForTransferHook(
    connection: Connection,
    tokenMint: PublicKey,
    source: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    tokenProgram: PublicKey
  ): Promise<AccountMeta[] | undefined> {
    let mint = await getMint(connection, tokenMint, "confirmed", tokenProgram);
    const transferHook = getTransferHook(mint);

    if (!transferHook) return undefined;

    const instruction = new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      keys: [
        { pubkey: source, isSigner: false, isWritable: false },
        {
          pubkey: tokenMint,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: destination, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: false, isWritable: false },
      ],
    });

    // Note:
    await addExtraAccountMetasForExecute(
      connection,
      instruction,
      transferHook.programId,
      source,
      tokenMint,
      destination,
      owner,
      0, // extra account must not depend on the amount (the amount will be changed due to slippage)
      "confirmed"
    );

    const extraAccountMetas = instruction.keys.slice(5);
    return extraAccountMetas.length > 0 ? extraAccountMetas : undefined;
  }
}
