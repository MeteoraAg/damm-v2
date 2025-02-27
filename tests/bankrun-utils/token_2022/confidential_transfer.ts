import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { struct, u8 } from "@solana/buffer-layout";
import { publicKey } from "@solana/buffer-layout-utils";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TokenInstruction,
} from "@solana/spl-token";

enum ConfidentialTransferInstruction {
  // We are interested in initilization only
  InitializeMint = 0,
  // ...
  // https://github.com/solana-labs/solana-program-library/blob/d4bbd51b5167d3f0c8a247b5f304a92e6482cd6f/token/program-2022/src/extension/confidential_transfer/instruction.rs#L33
}

interface InitializeConfidentialTransferMintInstructionData {
  instruction: TokenInstruction.ConfidentialTransferExtension;
  confidentialTransferInstruction: ConfidentialTransferInstruction.InitializeMint;
  authority: PublicKey | null;
  autoApproveNewAccounts: boolean;
  auditorElgamalPubkey: PublicKey | null;
}

const initializeConfidentialTransferMintInstructionData =
  struct<InitializeConfidentialTransferMintInstructionData>([
    u8("instruction"),
    u8("confidentialTransferInstruction"),
    publicKey("authority"),
    u8("autoApproveNewAccounts"),
    publicKey("auditorElgamalPubkey"),
  ]);

export function createInitializeConfidentialTransferMintInstruction(
  mint: PublicKey,
  authority: PublicKey,
  autoApproveNewAccounts: boolean = true,
  auditorElgamalPubkey: PublicKey = PublicKey.default,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID
) {
  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];
  const data = Buffer.alloc(
    initializeConfidentialTransferMintInstructionData.span
  );
  initializeConfidentialTransferMintInstructionData.encode(
    {
      instruction: TokenInstruction.ConfidentialTransferExtension,
      confidentialTransferInstruction:
        ConfidentialTransferInstruction.InitializeMint,
      authority,
      auditorElgamalPubkey,
      autoApproveNewAccounts,
    },
    data
  );

  return new TransactionInstruction({ keys, programId, data });
}

enum ConfidentialTransferFeeInstruction {
  // We are interested in initilization only
  InitializeConfidentialTransferFeeConfig = 0,
  // ...
  // https://github.com/solana-labs/solana-program-library/blob/d4bbd51b5167d3f0c8a247b5f304a92e6482cd6f/token/program-2022/src/extension/confidential_transfer_fee/instruction.rs#L37
}

const TOKEN_INSTRUCTION_CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION = 37;
const EXTENSION_TYPE_CONFIDENTIAL_TRANSFER_FEE_CONFIG = 16 as ExtensionType;

interface InitializeConfidentialTransferFeeConfigInstructionData {
  //TokenInstruction.ConfidentialTransferFeeExtension = 37 is commented out
  //instruction: TokenInstruction.ConfidentialTransferFeeExtension;
  instruction: 37;
  confidentialTransferFeeInstruction: ConfidentialTransferFeeInstruction.InitializeConfidentialTransferFeeConfig;
  authority: PublicKey | null;
  withdrawWithheldAuthorityElgamalPubkey: PublicKey | null;
}

const initializeConfidentialTransferFeeConfigInstructionData =
  struct<InitializeConfidentialTransferFeeConfigInstructionData>([
    u8("instruction"),
    u8("confidentialTransferFeeInstruction"),
    publicKey("authority"),
    publicKey("withdrawWithheldAuthorityElgamalPubkey"),
  ]);

export function createInitializeConfidentialTransferFeeConfigInstruction(
  mint: PublicKey,
  authority: PublicKey,
  withdrawWithheldAuthorityElgamalPubkey: PublicKey = PublicKey.default,
  programId: PublicKey = TOKEN_2022_PROGRAM_ID
) {
  const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];
  const data = Buffer.alloc(
    initializeConfidentialTransferFeeConfigInstructionData.span
  );
  initializeConfidentialTransferFeeConfigInstructionData.encode(
    {
      instruction: TOKEN_INSTRUCTION_CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION,
      confidentialTransferFeeInstruction:
        ConfidentialTransferFeeInstruction.InitializeConfidentialTransferFeeConfig,
      authority,
      withdrawWithheldAuthorityElgamalPubkey,
    },
    data
  );

  return new TransactionInstruction({ keys, programId, data });
}
