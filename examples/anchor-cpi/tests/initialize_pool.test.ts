import * as anchor from "@coral-xyz/anchor";

import {
  CpAmm,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  getFirstKey,
  getSecondKey,
} from "@meteora-ag/cp-amm-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

import { BN } from "bn.js";
import { CpiExampleDammV2 } from "../target/types/cpi_example_damm_v2";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

describe("cpi_example_damm_v2", () => {
  const provider = anchor.AnchorProvider.env();
  const { connection, wallet } = provider;

  anchor.setProvider(provider);

  const program = anchor.workspace.cpi_example_damm_v2 as Program<CpiExampleDammV2>;

  // instance of the CpAmm SDK
  const cpAmm = new CpAmm(connection);

  let mintA: PublicKey;
  let mintB: PublicKey;

  // pool authority: https://docs.meteora.ag/developer-guide/guides/damm-v2/overview
  const poolAuthority = new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");

  before(async () => {
    mintA = await createMint(connection, wallet.payer, wallet.publicKey, null, 6);
    mintB = await createMint(connection, wallet.payer, wallet.publicKey, null, 9);

    // logs to use then instead of generating new ones each time
    console.log("---- mintA:", mintA.toBase58());
    console.log("---- mintB:", mintB.toBase58());

    const mintAata = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintA,
      wallet.publicKey
    );
    const mintBata = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintB,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      mintA,
      mintAata.address,
      wallet.publicKey,
      10_000_000_000_000 // 10,000,000 tokens with 6 decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mintB,
      mintBata.address,
      wallet.publicKey,
      10_000_000_000 // 10,000 tokens with 9 decimals
    );
  });

  it("initialize Pool", async () => {
    // Fetch all available configs from the Meteora protocol.
    // Configs define parameters such as fees, protocolFeeRate, etc.
    // We will use the second config (index 1) for this pool (It's best to look for one that suits your needs.).
    const allConfigs = await cpAmm.getAllConfigs();

    // Pool PDA (Program Derived Address) - account that stores the liquidity pool state.
    // Derived using: "pool" seed, config, and the two ordered mints (smaller first, larger second).
    // This account contains data like total liquidity, current price (sqrt_price), accrued fees, etc.
    const [poolPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        allConfigs[1].publicKey.toBuffer(),
        getFirstKey(mintA, mintB),
        getSecondKey(mintA, mintB),
      ],
      cpAmm._program.programId
    );

    // Token A vault PDA - account that physically holds token A deposited into the pool.
    // Acts as the reserve for the first token in the pair.
    const [tokenAVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), mintA.toBuffer(), poolPda.toBuffer()],
      cpAmm._program.programId
    );

    // Token B vault PDA - account that physically holds token B deposited into the pool.
    // Acts as the reserve for the second token in the pair.
    const [tokenBVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), mintB.toBuffer(), poolPda.toBuffer()],
      cpAmm._program.programId
    );

    // Event authority PDA - account used by the program to emit on-chain events.
    // Allows the program to log important actions like swaps, deposits, withdrawals, etc.
    const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      cpAmm._program.programId
    );

    // User's Associated Token Account (ATA) for token A.
    // Tokens A will be deposited from this account into the pool.
    const mintAata = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintA,
      wallet.publicKey
    );

    // User's Associated Token Account (ATA) for token B.
    // Tokens B will be deposited from this account into the pool.
    const mintBata = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintB,
      wallet.publicKey
    );

    // Keypair for the position NFT mint.
    // This NFT represents ownership of a liquidity position in the pool.
    // The NFT holder can withdraw liquidity and claim accrued fees.
    const positionNftMint = Keypair.generate();

    // Position NFT account PDA.
    // Account that stores the NFT representing the user's liquidity position.
    const [positionNftAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("position_nft_account"), positionNftMint.publicKey.toBuffer()],
      cpAmm._program.programId
    );

    // Position PDA - account that stores the liquidity position data.
    // Contains information like liquidity amount, pending fees, price range (if applicable), etc.
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), positionNftMint.publicKey.toBuffer()],
      cpAmm._program.programId
    );

    // Compute the parameters required to create the pool:
    // - liquidityDelta: amount of liquidity to add (derived from token amounts)
    // - initSqrtPrice: initial pool price as sqrt (square root of the relative token price)
    const { liquidityDelta, initSqrtPrice } = cpAmm.preparePoolCreationParams({
      tokenAAmount: new BN(5_000_000_000),
      tokenBAmount: new BN(1_000_000_000),
      minSqrtPrice: MIN_SQRT_PRICE,
      maxSqrtPrice: MAX_SQRT_PRICE,
    });

    // Execute the transaction to initialize the pool.
    const tx = await program.methods
      .cpiInitializePool(liquidityDelta, initSqrtPrice)
      .accounts({
        signer: wallet.publicKey, // Transaction signer (pool creator)
        tokenAMint: mintA, // Mint for the first token in the pair
        tokenBMint: mintB, // Mint for the second token in the pair
        tokenAVault: tokenAVaultPda, // Vault where token A will be deposited
        tokenBVault: tokenBVaultPda, // Vault where token B will be deposited
        payerTokenA: mintAata.address, // User account providing token A
        payerTokenB: mintBata.address, // User account providing token B
        config: allConfigs[1].publicKey, // Protocol config used for this pool
        tokenAProgram: TOKEN_PROGRAM_ID, // SPL Token Program
        tokenBProgram: TOKEN_PROGRAM_ID, // SPL Token Program
        pool: poolPda, // Pool account being created
        poolAuthority: poolAuthority, // Pool authority (administrative operations)
        eventAuthority: eventAuthorityPda, // Authority used to emit events
        firstPositionNftMint: positionNftMint.publicKey, // Mint for the first liquidity position NFT
        firstPositionNftAccount: positionNftAccount, // Account where the position NFT will be minted
        firstPosition: positionPda, // Account for the first liquidity position
      })
      .signers([wallet.payer, positionNftMint])
      .rpc();

    console.log("---- Your transaction signature", tx);
  });

  it("get initialized pool", async () => {
    const pools = await cpAmm.fetchPoolStatesByTokenAMint(mintA);

    const pool = pools.find((p) => p.account.tokenBMint.equals(mintB));

    console.log("---- initialized pool:", JSON.stringify(pool, null, 2));

    const getPositionNft = await cpAmm.getUserPositionByPool(pool.publicKey, wallet.publicKey);

    console.log(
      "---- wallet position nft:",
      JSON.stringify(getPositionNft[0].positionState, null, 2)
    );
  });
});
