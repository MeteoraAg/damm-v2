import * as anchor from "@coral-xyz/anchor";

import { CpAmm, SwapMode, getCurrentPoint } from "@meteora-ag/cp-amm-sdk";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

import { BN } from "bn.js";
import { CpiExampleDammV2 } from "../target/types/cpi_example_damm_v2";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

describe("cpi_example_damm_v2", () => {
  const provider = anchor.AnchorProvider.env();
  const { connection, wallet } = provider;

  anchor.setProvider(provider);

  const program = anchor.workspace.cpi_example_damm_v2 as Program<CpiExampleDammV2>;

  // instance of the CpAmm SDK
  const cpAmm = new CpAmm(connection);

  const mintA = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // USDC
  const mintB = new PublicKey("So11111111111111111111111111111111111111112"); // wrapped SOL

  console.log(mintA.toBase58());

  // pool authority: https://docs.meteora.ag/developer-guide/guides/damm-v2/overview
  const poolAuthority = new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");

  it("swap2 CPI", async () => {
    const pools = await cpAmm.fetchPoolStatesByTokenAMint(mintA);

    // find the specific pool for the mint pair
    const pool = pools.find((p) => p.account.tokenBMint.equals(mintB));

    // Event authority PDA - account used by the program to emit on-chain events.
    // Allows the program to log important actions like swaps, deposits, withdrawals, etc.
    const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      cpAmm._program.programId
    );

    // User's Associated Token Account (ATA) for token A.
    // Tokens A will be deposited from this account into the pool.
    const mintAata = getAssociatedTokenAddressSync(mintA, wallet.publicKey);

    // User's Associated Token Account (ATA) for token B.
    const mintBata = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintB,
      wallet.publicKey
    );

    const amountIn = new BN(0.2 * 10 ** 6); // 0.2 USDC

    const currentPoint = await getCurrentPoint(connection, pool.account.activationType);

    // get quote
    const { minimumAmountOut } = cpAmm.getQuote2({
      poolState: pool.account,
      swapMode: SwapMode.ExactIn,
      amountIn,
      slippage: 50,
      inputTokenMint: mintA,
      tokenADecimal: 6,
      tokenBDecimal: 9,
      hasReferral: false,
      currentPoint,
    });

    // Execute the transaction to initialize the pool.
    const tx = await program.methods
      .cpiSwap2(amountIn, minimumAmountOut, SwapMode.ExactIn)
      .accounts({
        signer: wallet.publicKey, // Transaction signer (pool creator)
        tokenAMint: mintA, // Mint for the first token in the pair
        tokenBMint: mintB, // Mint for the second token in the pair
        inputTokenAccount: mintAata, // User's ATA for token A (input token)
        outputTokenAccount: mintBata.address, // User's ATA for token B (output token)
        tokenAVault: pool.account.tokenAVault, // Vault where token A will be deposited
        tokenBVault: pool.account.tokenBVault, // Vault where token B will be transferred from
        tokenAProgram: TOKEN_PROGRAM_ID, // SPL Token Program
        tokenBProgram: TOKEN_PROGRAM_ID, // SPL Token Program
        pool: pool.publicKey, // Pool account being created
        poolAuthority: poolAuthority, // Pool authority (administrative operations)
        eventAuthority: eventAuthorityPda, // Authority used to emit events
        referralTokenAccount: null,
      })
      .rpc();

    console.log("---- Your transaction signature", tx);
  });
});
