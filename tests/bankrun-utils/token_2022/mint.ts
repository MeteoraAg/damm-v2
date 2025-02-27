import { AnchorProvider, web3 } from "@coral-xyz/anchor";
import {
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  AccountState,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createInitializeDefaultAccountStateInstruction,
  createInitializeGroupMemberPointerInstruction,
  createInitializeGroupPointerInstruction,
  createInitializeInterestBearingMintInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  ExtensionType,
  getMintLen,
  getTypeLen,
  mintTo,
  thawAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { TEST_TRANSFER_HOOK_PROGRAM_ID } from "./token-extensions";
import {
  createInitializeConfidentialTransferFeeConfigInstruction,
  createInitializeConfidentialTransferMintInstruction,
} from "./confidential_transfer";
import { DECIMALS } from "../constants";

let feeBasisPoints: number;
let maxFee: bigint;

let mintAuthority: web3.Keypair;

export async function createMintTransaction(
  connection: web3.Connection,
  UserKP: web3.Keypair,
  payer: web3.Keypair,
  extensions: ExtensionType[],
  shouldMint: boolean = true,
  shouldHaveFreezeAuthority: boolean = false
) {
  // Set the decimals, fee basis points, and maximum fee
  feeBasisPoints = 100; // 1%
  maxFee = BigInt(9 * Math.pow(10, DECIMALS)); // 9 tokens

  // Define the amount to be minted and the amount to be transferred, accounting for decimals
  let mintAmount = BigInt(1_000_000 * Math.pow(10, DECIMALS)); // Mint 1,000,000 tokens

  mintAuthority = new web3.Keypair();
  let mintKeypair = new web3.Keypair();
  let TOKEN = mintKeypair.publicKey;

  // Generate keys for transfer fee config authority and withdrawal authority
  let transferFeeConfigAuthority = new web3.Keypair();
  let withdrawWithheldAuthority = new web3.Keypair();

  let { instructions, postInstructions, additionalLength, rentReserveSpace } =
    createExtensionMintIx(
      extensions,
      UserKP,
      payer,
      TOKEN,
      transferFeeConfigAuthority,
      withdrawWithheldAuthority
    );

  let mintLen = getMintLen(extensions) + additionalLength;
  const mintLamports = await connection.getMinimumBalanceForRentExemption(
    mintLen + rentReserveSpace
  );

  const mintTransaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: UserKP.publicKey,
      newAccountPubkey: TOKEN,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  if (instructions.length > 0) mintTransaction.add(...instructions);

  mintTransaction.add(
    createInitializeMintInstruction(
      TOKEN,
      DECIMALS,
      mintAuthority.publicKey,
      shouldHaveFreezeAuthority ? mintAuthority.publicKey : null,
      TOKEN_2022_PROGRAM_ID
    ),
    ...postInstructions
  );

  await sendAndConfirmTransaction(
    connection,
    mintTransaction,
    [UserKP, mintKeypair],
    undefined
  );

  const userToken = await createAssociatedTokenAccountIdempotent(
    connection,
    UserKP,
    TOKEN,
    UserKP.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID
  );

  if (shouldMint) {
    if (extensions.indexOf(ExtensionType.DefaultAccountState) != -1) {
      await thawAccount(
        connection,
        mintAuthority, // Transaction fee payer
        userToken, // Token Account to unfreeze
        TOKEN, // Mint Account address
        mintAuthority.publicKey, // Freeze Authority
        undefined, // Additional signers
        undefined, // Confirmation options
        TOKEN_2022_PROGRAM_ID // Token Extension Program ID
      );
    }

    await mintTo(
      connection,
      UserKP,
      TOKEN,
      userToken,
      mintAuthority,
      mintAmount,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  }

  return TOKEN;
}

function createExtensionMintIx(
  extensions: ExtensionType[],
  UserKP: web3.Keypair,
  payer: web3.Keypair,
  TOKEN: web3.PublicKey,
  transferFeeConfigAuthority: web3.Keypair,
  withdrawWithheldAuthority: web3.Keypair
): {
  instructions: web3.TransactionInstruction[];
  postInstructions: web3.TransactionInstruction[];
  additionalLength: number;
  rentReserveSpace: number;
} {
  const ix = [];
  const postIx = [];
  let confidentialTransferMintSizePatch = 0;
  let confidentialTransferFeeConfigSizePatch = 0;
  let groupPointerSize = 0;

  if (extensions.includes(ExtensionType.TransferFeeConfig)) {
    ix.push(
      createInitializeTransferFeeConfigInstruction(
        TOKEN,
        transferFeeConfigAuthority.publicKey,
        withdrawWithheldAuthority.publicKey,
        feeBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  if (extensions.includes(ExtensionType.InterestBearingConfig)) {
    ix.push(
      createInitializeInterestBearingMintInstruction(
        TOKEN,
        UserKP.publicKey,
        10,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  if (extensions.includes(ExtensionType.DefaultAccountState)) {
    ix.push(
      createInitializeDefaultAccountStateInstruction(
        TOKEN, // Mint Account address
        AccountState.Frozen, // Default AccountState
        TOKEN_2022_PROGRAM_ID // Token Extension Program ID
      )
    );
  }

  if (extensions.includes(ExtensionType.PermanentDelegate)) {
    ix.push(
      createInitializePermanentDelegateInstruction(
        TOKEN, // Mint Account address
        payer.publicKey, // Designated Permanent Delegate
        TOKEN_2022_PROGRAM_ID // Token Extension Program ID
      )
    );
  }

  if (extensions.includes(ExtensionType.MintCloseAuthority)) {
    ix.push(
      createInitializeMintCloseAuthorityInstruction(
        TOKEN, // Mint Account address
        payer.publicKey, // Designated Close Authority
        TOKEN_2022_PROGRAM_ID // Token Extension Program ID
      )
    );
  }

  if (extensions.includes(ExtensionType.TransferHook)) {
    ix.push(
      createInitializeTransferHookInstruction(
        TOKEN,
        payer.publicKey,
        TEST_TRANSFER_HOOK_PROGRAM_ID, // Transfer Hook Program ID
        TOKEN_2022_PROGRAM_ID
      )
    );

    // create ExtraAccountMetaList account
    postIx.push(
      createInitializeExtraAccountMetaListInstruction(UserKP.publicKey, TOKEN)
    );
  }

  if (extensions.includes(ExtensionType.ConfidentialTransferMint)) {
    confidentialTransferMintSizePatch =
      65 - getTypeLen(ExtensionType.ConfidentialTransferMint);
    ix.push(
      createInitializeConfidentialTransferMintInstruction(
        TOKEN,
        mintAuthority.publicKey
      )
    );
  }

  // ConfidentialTransferFeeConfig
  // When both TransferFeeConfig and ConfidentialTransferMint are enabled, ConfidentialTransferFeeConfig is also required

  if (
    extensions.includes(ExtensionType.TransferFeeConfig) &&
    extensions.includes(ExtensionType.ConfidentialTransferMint)
  ) {
    // fixedLengthExtensions.push(ExtensionType.ConfidentialTransferFeeConfig);
    // [May 25, 2024] ExtensionType.ConfidentialTransferFeeConfig is not yet supported in spl-token
    // ConfidentialTransferFeeConfig struct fields:
    //   - authority: OptionalNonZeroPubkey (32 bytes)
    //   - withdraw_withheld_authority_elgamal_pubkey: ElGamalPubkey (32 bytes)
    //   - harvest_to_mint_enabled: bool (1 byte)
    //   - withheld_amount: EncryptedWithheldAmount (64 bytes)
    confidentialTransferFeeConfigSizePatch = 2 + 2 + 129; // type + length + data
    ix.push(
      createInitializeConfidentialTransferFeeConfigInstruction(
        TOKEN,
        mintAuthority.publicKey,
        mintAuthority.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  if (extensions.includes(ExtensionType.GroupPointer)) {
    ix.push(
      createInitializeGroupPointerInstruction(
        TOKEN,
        UserKP.publicKey,
        TOKEN,
        TOKEN_2022_PROGRAM_ID
      )
    );

    // This extension is not yet stable
    //  Trying this https://solana.com/developers/courses/token-extensions/group-member#lab
    //  However, the instruction always failed with error 0xc.
    // groupPointerSize = TOKEN_GROUP_SIZE;
    // postIx.push(
    //   createInitializeGroupInstruction({
    //     group: TOKEN,
    //     maxSize: 10,
    //     mint: TOKEN,
    //     mintAuthority: UserKP.publicKey,
    //     programId: TOKEN_2022_PROGRAM_ID,
    //     updateAuthority: UserKP.publicKey,
    //   })
    // );
  }

  if (extensions.includes(ExtensionType.GroupMemberPointer)) {
    ix.push(
      createInitializeGroupMemberPointerInstruction(
        TOKEN,
        UserKP.publicKey,
        TOKEN,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }

  return {
    instructions: ix,
    postInstructions: postIx,
    additionalLength:
      confidentialTransferMintSizePatch +
      confidentialTransferFeeConfigSizePatch,
    rentReserveSpace: groupPointerSize,
  };
}

export function createInitializeExtraAccountMetaListInstruction(
  payer: web3.PublicKey,
  tokenMint: web3.PublicKey
): web3.TransactionInstruction {
  // create ExtraAccountMetaList account
  const [extraAccountMetaListPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), tokenMint.toBuffer()],
    TEST_TRANSFER_HOOK_PROGRAM_ID
  );
  const [counterAccountPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), tokenMint.toBuffer()],
    TEST_TRANSFER_HOOK_PROGRAM_ID
  );

  return {
    programId: TEST_TRANSFER_HOOK_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: extraAccountMetaListPDA, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: counterAccountPDA, isSigner: false, isWritable: true },
      {
        pubkey: TOKEN_2022_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.from([0x5c, 0xc5, 0xae, 0xc5, 0x29, 0x7c, 0x13, 0x03]), // InitializeExtraAccountMetaList
  };
}
