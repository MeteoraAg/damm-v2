import {
  createExecuteInstruction,
  createTransferCheckedInstruction,
  ExtraAccountMeta,
  getExtraAccountMetaAddress,
  getExtraAccountMetas,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenTransferHookAccountDataNotFound,
  TokenTransferHookAccountNotFound,
  TokenTransferHookInvalidPubkeyData,
  TokenTransferHookInvalidSeed,
  TokenTransferHookPubkeyDataTooSmall,
  unpackMint,
} from "@solana/spl-token";
import {
  AccountMeta,
  PUBLIC_KEY_LENGTH,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import { LiteSVM } from "litesvm";

export async function getExtraAccountMetasForTransferHook(
  svm: LiteSVM,
  mint: PublicKey
) {
  const info = svm.getAccount(mint);

  if (info.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }

  const accountInfoWithBuffer = {
    ...info,
    data: Buffer.from(info.data),
  };
  const mintInfo = unpackMint(
    mint,
    accountInfoWithBuffer,
    TOKEN_2022_PROGRAM_ID
  );

  const transferHook = getTransferHook(mintInfo);
  if (!transferHook) {
    return [];
  } else {
    const transferWithHookIx =
      await createTransferCheckedWithTransferHookInstruction(
        svm,
        PublicKey.default,
        mint,
        PublicKey.default,
        PublicKey.default,
        BigInt(0),
        mintInfo.decimals,
        [],
        TOKEN_2022_PROGRAM_ID
      );

    // Only 4 keys needed if it's single signer. https://github.com/solana-labs/solana-program-library/blob/d72289c79a04411c69a8bf1054f7156b6196f9b3/token/js/src/extensions/transferFee/instructions.ts#L251
    return transferWithHookIx.keys.slice(4);
  }
}

export function createTransferCheckedWithTransferHookInstruction(
  svm: LiteSVM,
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
  multiSigners: (Signer | PublicKey)[] = [],
  programId = TOKEN_2022_PROGRAM_ID
) {
  const instruction = createTransferCheckedInstruction(
    source,
    mint,
    destination,
    owner,
    amount,
    decimals,
    multiSigners,
    programId
  );
  const info = svm.getAccount(mint);
  const accountInfoWithBuffer = {
    ...info,
    data: Buffer.from(info.data),
  };
  const mintInfo = unpackMint(
    mint,
    accountInfoWithBuffer,
    TOKEN_2022_PROGRAM_ID
  );

  const transferHook = getTransferHook(mintInfo);

  if (transferHook) {
    addExtraAccountMetasForExecute(
      svm,
      instruction,
      transferHook.programId,
      source,
      mint,
      destination,
      owner,
      amount
    );
  }

  return instruction;
}

function deEscalateAccountMeta(
  accountMeta: AccountMeta,
  accountMetas: AccountMeta[]
): AccountMeta {
  const maybeHighestPrivileges = accountMetas
    .filter((x) => x.pubkey.equals(accountMeta.pubkey))
    .reduce<{ isSigner: boolean; isWritable: boolean } | undefined>(
      (acc, x) => {
        if (!acc) return { isSigner: x.isSigner, isWritable: x.isWritable };
        return {
          isSigner: acc.isSigner || x.isSigner,
          isWritable: acc.isWritable || x.isWritable,
        };
      },
      undefined
    );
  if (maybeHighestPrivileges) {
    const { isSigner, isWritable } = maybeHighestPrivileges;
    if (!isSigner && isSigner !== accountMeta.isSigner) {
      accountMeta.isSigner = false;
    }
    if (!isWritable && isWritable !== accountMeta.isWritable) {
      accountMeta.isWritable = false;
    }
  }
  return accountMeta;
}

export function addExtraAccountMetasForExecute(
  svm: LiteSVM,
  instruction: TransactionInstruction,
  programId: PublicKey,
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: number | bigint
) {
  const validateStatePubkey = getExtraAccountMetaAddress(mint, programId);
  const validateStateAccount = svm.getAccount(validateStatePubkey);
  if (validateStateAccount == null) {
    return instruction;
  }
  const accountInfoWithBuffer = {
    ...validateStateAccount,
    data: Buffer.from(validateStateAccount.data),
  };
  const validateStateData = getExtraAccountMetas(accountInfoWithBuffer);

  // Check to make sure the provided keys are in the instruction
  if (
    ![source, mint, destination, owner].every((key) =>
      instruction.keys.some((meta) => meta.pubkey.equals(key))
    )
  ) {
    throw new Error("Missing required account in instruction");
  }

  const executeInstruction = createExecuteInstruction(
    programId,
    source,
    mint,
    destination,
    owner,
    validateStatePubkey,
    BigInt(amount)
  );

  for (const extraAccountMeta of validateStateData) {
    executeInstruction.keys.push(
      deEscalateAccountMeta(
        resolveExtraAccountMeta(
          svm,
          extraAccountMeta,
          executeInstruction.keys,
          executeInstruction.data,
          executeInstruction.programId
        ),
        executeInstruction.keys
      )
    );
  }

  // Add only the extra accounts resolved from the validation state
  instruction.keys.push(...executeInstruction.keys.slice(5));

  // Add the transfer hook program ID and the validation state account
  instruction.keys.push({
    pubkey: programId,
    isSigner: false,
    isWritable: false,
  });
  instruction.keys.push({
    pubkey: validateStatePubkey,
    isSigner: false,
    isWritable: false,
  });
}

export function resolveExtraAccountMeta(
  svm: LiteSVM,
  extraMeta: ExtraAccountMeta,
  previousMetas: AccountMeta[],
  instructionData: Buffer,
  transferHookProgramId: PublicKey
): AccountMeta {
  if (extraMeta.discriminator === 0) {
    return {
      pubkey: new PublicKey(extraMeta.addressConfig),
      isSigner: extraMeta.isSigner,
      isWritable: extraMeta.isWritable,
    };
  } else if (extraMeta.discriminator === 2) {
    const pubkey = unpackPubkeyData(
      svm,
      extraMeta.addressConfig,
      previousMetas,
      instructionData
    );
    return {
      pubkey,
      isSigner: extraMeta.isSigner,
      isWritable: extraMeta.isWritable,
    };
  }

  let programId = PublicKey.default;

  if (extraMeta.discriminator === 1) {
    programId = transferHookProgramId;
  } else {
    const accountIndex = extraMeta.discriminator - (1 << 7);
    if (previousMetas.length <= accountIndex) {
      throw new TokenTransferHookAccountNotFound();
    }
    programId = previousMetas[accountIndex].pubkey;
  }

  const seeds = unpackSeeds(
    svm,
    extraMeta.addressConfig,
    previousMetas,
    instructionData
  );
  const pubkey = PublicKey.findProgramAddressSync(seeds, programId)[0];

  return {
    pubkey,
    isSigner: extraMeta.isSigner,
    isWritable: extraMeta.isWritable,
  };
}

function unpackPubkeyData(
  svm: LiteSVM,
  keyDataConfig: Uint8Array,
  previousMetas: AccountMeta[],
  instructionData: Buffer
): PublicKey {
  const [discriminator, ...rest] = keyDataConfig;
  const remaining = new Uint8Array(rest);
  switch (discriminator) {
    case 1:
      return unpackPubkeyDataFromInstructionData(remaining, instructionData);
    case 2:
      return unpackPubkeyDataFromAccountData(svm, remaining, previousMetas);
    default:
      throw new TokenTransferHookInvalidPubkeyData();
  }
}

function unpackSeeds(
  svm: LiteSVM,
  seeds: Uint8Array,
  previousMetas: AccountMeta[],
  instructionData: Buffer
): Buffer[] {
  const unpackedSeeds: Buffer[] = [];
  let i = 0;
  while (i < 32) {
    const seed = unpackFirstSeed(
      svm,
      seeds.slice(i),
      previousMetas,
      instructionData
    );
    if (seed == null) {
      break;
    }
    unpackedSeeds.push(seed.data);
    i += seed.packedLength;
  }
  return unpackedSeeds;
}

function unpackFirstSeed(
  svm: LiteSVM,
  seeds: Uint8Array,
  previousMetas: AccountMeta[],
  instructionData: Buffer
): Seed | null {
  const [discriminator, ...rest] = seeds;
  const remaining = new Uint8Array(rest);
  switch (discriminator) {
    case 0:
      return null;
    case 1:
      return unpackSeedLiteral(remaining);
    case 2:
      return unpackSeedInstructionArg(remaining, instructionData);
    case 3:
      return unpackSeedAccountKey(remaining, previousMetas);
    case 4:
      return unpackSeedAccountData(svm, remaining, previousMetas);
    default:
      throw new TokenTransferHookInvalidSeed();
  }
}

interface Seed {
  data: Buffer;
  packedLength: number;
}

const DISCRIMINATOR_SPAN = 1;
const LITERAL_LENGTH_SPAN = 1;
const INSTRUCTION_ARG_OFFSET_SPAN = 1;
const INSTRUCTION_ARG_LENGTH_SPAN = 1;
const ACCOUNT_KEY_INDEX_SPAN = 1;
const ACCOUNT_DATA_ACCOUNT_INDEX_SPAN = 1;
const ACCOUNT_DATA_OFFSET_SPAN = 1;
const ACCOUNT_DATA_LENGTH_SPAN = 1;

function unpackSeedLiteral(seeds: Uint8Array): Seed {
  if (seeds.length < 1) {
    throw new TokenTransferHookInvalidSeed();
  }
  const [length, ...rest] = seeds;
  if (rest.length < length) {
    throw new TokenTransferHookInvalidSeed();
  }
  return {
    data: Buffer.from(rest.slice(0, length)),
    packedLength: DISCRIMINATOR_SPAN + LITERAL_LENGTH_SPAN + length,
  };
}

function unpackSeedInstructionArg(
  seeds: Uint8Array,
  instructionData: Buffer
): Seed {
  if (seeds.length < 2) {
    throw new TokenTransferHookInvalidSeed();
  }
  const [index, length] = seeds;
  if (instructionData.length < length + index) {
    throw new TokenTransferHookInvalidSeed();
  }
  return {
    data: instructionData.subarray(index, index + length),
    packedLength:
      DISCRIMINATOR_SPAN +
      INSTRUCTION_ARG_OFFSET_SPAN +
      INSTRUCTION_ARG_LENGTH_SPAN,
  };
}

function unpackSeedAccountKey(
  seeds: Uint8Array,
  previousMetas: AccountMeta[]
): Seed {
  if (seeds.length < 1) {
    throw new TokenTransferHookInvalidSeed();
  }
  const [index] = seeds;
  if (previousMetas.length <= index) {
    throw new TokenTransferHookInvalidSeed();
  }
  return {
    data: previousMetas[index].pubkey.toBuffer(),
    packedLength: DISCRIMINATOR_SPAN + ACCOUNT_KEY_INDEX_SPAN,
  };
}

function unpackSeedAccountData(
  svm: LiteSVM,
  seeds: Uint8Array,
  previousMetas: AccountMeta[]
): Seed {
  if (seeds.length < 3) {
    throw new TokenTransferHookInvalidSeed();
  }
  const [accountIndex, dataIndex, length] = seeds;
  if (previousMetas.length <= accountIndex) {
    throw new TokenTransferHookInvalidSeed();
  }
  const accountInfo = svm.getAccount(previousMetas[accountIndex].pubkey);
  if (accountInfo == null) {
    throw new TokenTransferHookAccountDataNotFound();
  }
  if (accountInfo.data.length < dataIndex + length) {
    throw new TokenTransferHookInvalidSeed();
  }
  return {
    data: Buffer.from(accountInfo.data).subarray(dataIndex, dataIndex + length),
    packedLength:
      DISCRIMINATOR_SPAN +
      ACCOUNT_DATA_ACCOUNT_INDEX_SPAN +
      ACCOUNT_DATA_OFFSET_SPAN +
      ACCOUNT_DATA_LENGTH_SPAN,
  };
}

function unpackPubkeyDataFromInstructionData(
  remaining: Uint8Array,
  instructionData: Buffer
): PublicKey {
  if (remaining.length < 1) {
    throw new TokenTransferHookInvalidPubkeyData();
  }
  const dataIndex = remaining[0];
  if (instructionData.length < dataIndex + PUBLIC_KEY_LENGTH) {
    throw new TokenTransferHookPubkeyDataTooSmall();
  }
  return new PublicKey(
    instructionData.subarray(dataIndex, dataIndex + PUBLIC_KEY_LENGTH)
  );
}

function unpackPubkeyDataFromAccountData(
  svm: LiteSVM,
  remaining: Uint8Array,
  previousMetas: AccountMeta[]
): PublicKey {
  if (remaining.length < 2) {
    throw new TokenTransferHookInvalidPubkeyData();
  }
  const [accountIndex, dataIndex] = remaining;
  if (previousMetas.length <= accountIndex) {
    throw new TokenTransferHookAccountDataNotFound();
  }
  const accountInfo = svm.getAccount(previousMetas[accountIndex].pubkey);
  if (accountInfo == null) {
    throw new TokenTransferHookAccountNotFound();
  }
  if (accountInfo.data.length < dataIndex + PUBLIC_KEY_LENGTH) {
    throw new TokenTransferHookPubkeyDataTooSmall();
  }
  return new PublicKey(
    accountInfo.data.subarray(dataIndex, dataIndex + PUBLIC_KEY_LENGTH)
  );
}
