import {
  AnchorProvider,
  BN,
  IdlAccounts,
  IdlTypes,
  Program,
  Wallet,
} from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountMeta,
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as borsh from "borsh";
import { AccountInfoBytes, LiteSVM } from "litesvm";
import { sendTransaction } from ".";
import { BASIS_POINT_MAX, DLMM_PROGRAM_ID } from "./constants";
import { LbClmm } from "./idl/dlmm";
import LbClmmIDL from "./idl/dlmm.json";
import { getExtraAccountMetasForTransferHook } from "./transferHook/transferHookUtils";

export type LbPair = IdlAccounts<LbClmm>["lbPair"];
type BinArrayBitmapExtension = IdlAccounts<LbClmm>["binArrayBitmapExtension"];
type RemainingAccountsInfo = IdlTypes<LbClmm>["remainingAccountsInfo"];
type PresetParameterV1 = Omit<IdlAccounts<LbClmm>["presetParameter"], "">;
type StrategyTypeEnum = IdlTypes<LbClmm>["strategyType"];

const CONSTANTS = Object.entries(LbClmmIDL.constants);
const BIN_ARRAY_BITMAP_SIZE = new BN(
  CONSTANTS.find(([k, v]) => v.name == "BIN_ARRAY_BITMAP_SIZE")[1].value
);
const EXTENSION_BINARRAY_BITMAP_SIZE = new BN(
  CONSTANTS.find(
    ([k, v]) => v.name == "EXTENSION_BINARRAY_BITMAP_SIZE"
  )[1].value
);
const BIN_ARRAY_INDEX_BOUND = [
  BIN_ARRAY_BITMAP_SIZE.mul(
    EXTENSION_BINARRAY_BITMAP_SIZE.add(new BN(1))
  ).neg(),
  BIN_ARRAY_BITMAP_SIZE.mul(EXTENSION_BINARRAY_BITMAP_SIZE.add(new BN(1))).sub(
    new BN(1)
  ),
];
const MAX_BIN_PER_ARRAY = new BN(
  CONSTANTS.find(([k, v]) => v.name == "MAX_BIN_PER_ARRAY")[1].value
);
const DEFAULT_BITMAP_RANGE = [
  BIN_ARRAY_BITMAP_SIZE.neg(),
  BIN_ARRAY_BITMAP_SIZE.sub(new BN(1)),
];

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

const AccountsType = {
  TransferHookX: {
    transferHookX: {},
  },
  TransferHookY: {
    transferHookY: {},
  },
  TransferHookReward: {
    transferHookReward: {},
  },
};

export function createLbClmmProgram(): Program<LbClmm> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  return new Program<LbClmm>(LbClmmIDL, provider);
}

export function getLbPairState(
  svm: LiteSVM,
  lbPair: PublicKey,
  nullable = false
) {
  const program = createLbClmmProgram();
  const lbPairInfo = svm.getAccount(lbPair);
  if (!lbPairInfo || !lbPairInfo.data.length)
    if (nullable) return null;
    else throw new Error("lbPair is not initialized");

  return program.coder.accounts.decode<LbPair>(
    "lbPair",
    Buffer.from(lbPairInfo.data)
  );
}

function getBinArrayBitmapExtensionState(
  svm: LiteSVM,
  program: Program<LbClmm>,
  binArrayBitmapExtension: PublicKey,
  nullable = false
) {
  const binArrayBitmapExtensionInfo = svm.getAccount(binArrayBitmapExtension);
  if (!binArrayBitmapExtensionInfo || !binArrayBitmapExtensionInfo.data.length)
    if (nullable) return null;
    else throw new Error("Invalid binArrayBitmapExtension");

  return program.coder.accounts.decode<BinArrayBitmapExtension>(
    "binArrayBitmapExtension",
    Buffer.from(binArrayBitmapExtensionInfo.data)
  );
}

function deriveBinArrayBitmapExtension(
  lbPair: PublicKey,
  programId: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bitmap"), lbPair.toBytes()],
    programId
  );
}

export function binIdToBinArrayIndex(binId: BN) {
  if (binId.isNeg()) {
    const idx = binId.add(new BN(1)).div(MAX_BIN_PER_ARRAY);
    return idx.sub(new BN(1));
  }
  const idx = binId.div(MAX_BIN_PER_ARRAY);
  return idx;
}

function deriveBinArray(lbPair: PublicKey, index: BN, programId: PublicKey) {
  let binArrayBytes: Uint8Array;
  if (index.isNeg()) {
    binArrayBytes = new Uint8Array(index.toTwos(64).toBuffer("le", 8));
  } else {
    binArrayBytes = new Uint8Array(index.toBuffer("le", 8));
  }

  return PublicKey.findProgramAddressSync(
    [Buffer.from("bin_array"), lbPair.toBytes(), binArrayBytes],
    programId
  );
}

function isOverflowDefaultBinArrayBitmap(binArrayIndex: BN) {
  return (
    binArrayIndex.gt(BIN_ARRAY_BITMAP_SIZE.sub(new BN(1))) ||
    binArrayIndex.lt(BIN_ARRAY_BITMAP_SIZE.neg())
  );
}

function getBitFromBinArrayIndexInBitmapExtension(
  binArrayIndex: BN,
  state: BinArrayBitmapExtension
) {
  // In extension, the range start with -513 and 512
  // Brain burst, let's just shift back to the actual index and calculate from there ...
  const idx = binArrayIndex.isNeg()
    ? binArrayIndex.add(new BN(1)).abs().sub(BIN_ARRAY_BITMAP_SIZE)
    : binArrayIndex.sub(BIN_ARRAY_BITMAP_SIZE);

  const bitmapOffset = idx.div(BIN_ARRAY_BITMAP_SIZE);

  const bitmap = binArrayIndex.isNeg()
    ? state.negativeBinArrayBitmap[bitmapOffset.toNumber()]
    : state.positiveBinArrayBitmap[bitmapOffset.toNumber()];

  const { div: offsetToU64InBitmap, mod: offsetToBit } = idx.divmod(new BN(64));

  // Each U512 have 8 u64
  const { mod: offsetToU64InChunkBitmap } = offsetToU64InBitmap.divmod(
    new BN(8)
  );

  if (!bitmap) {
    console.log(binArrayIndex.toString());
    console.log(bitmapOffset.toString());
  }

  const chunkedBitmap = bitmap[offsetToU64InChunkBitmap.toNumber()];
  return chunkedBitmap.testn(offsetToBit.toNumber());
}

function getNextBinArrayIndexWithLiquidity(
  binArrayIndex: BN,
  pairState: LbPair,
  swapForY: boolean,
  state: BinArrayBitmapExtension | null
): BN | null {
  const [minBinArrayIndex, maxBinArrayIndex] = BIN_ARRAY_INDEX_BOUND;
  const step = swapForY ? new BN(-1) : new BN(1);
  // Start search from the next bin array index
  while (true) {
    if (isOverflowDefaultBinArrayBitmap(binArrayIndex)) {
      // Search in extension
      if (state) {
        const isBitSet = getBitFromBinArrayIndexInBitmapExtension(
          binArrayIndex,
          state
        );
        if (isBitSet) {
          return binArrayIndex;
        }
      } else {
        break;
      }
    } else {
      // Because bitmap in pair state is continuous, -512 will be index 0. The add will shift to the actual index.
      const actualIdx = binArrayIndex.add(BIN_ARRAY_BITMAP_SIZE);
      // FullBitmap = U1024
      let { div: offsetInFullBitmap, mod: index } = actualIdx.divmod(
        new BN(64)
      );
      if (
        pairState.binArrayBitmap[offsetInFullBitmap.toNumber()].testn(
          index.toNumber()
        )
      ) {
        return binArrayIndex;
      }
    }
    binArrayIndex = binArrayIndex.add(step);
    if (
      binArrayIndex.gt(maxBinArrayIndex) ||
      binArrayIndex.lt(minBinArrayIndex)
    ) {
      break;
    }
  }
  return null;
}

export async function createBinArrays(
  svm: LiteSVM,
  lbPair: PublicKey,
  indexes: BN[],
  admin: Keypair
) {
  const program = createLbClmmProgram();
  const results = [];
  for (const idx of indexes) {
    const [binArray] = deriveBinArray(lbPair, idx, program.programId);

    const info = svm.getAccount(binArray);

    if (!info || !info.data.length) {
      const tx = await program.methods
        .initializeBinArray(idx)
        .accountsPartial({
          binArray,
          funder: admin.publicKey,
          lbPair,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({
            units: 300_000,
          }),
        ])
        .transaction();

      const res = sendTransaction(svm, tx, [admin]);
      results.push(res);
    }
  }
  return results;
}

function getBinArraysForSwap(
  svm: LiteSVM,
  lbPair: PublicKey,
  swapForY: boolean,
  binArraysNeeded = 4
) {
  const program = createLbClmmProgram();
  const [minBinArrayIdx, maxBinArrayIdx] = BIN_ARRAY_INDEX_BOUND;

  const binArrays: PublicKey[] = [];
  const lbPairState = getLbPairState(svm, lbPair);
  const activeBinArrayIdx = binIdToBinArrayIndex(new BN(lbPairState.activeId));

  const [bitmapExtension] = deriveBinArrayBitmapExtension(
    lbPair,
    program.programId
  );

  const bitmapExtState = getBinArrayBitmapExtensionState(
    svm,
    program,
    bitmapExtension,
    true
  );

  let binArrayIdx = activeBinArrayIdx;

  while (binArrays.length < binArraysNeeded) {
    if (
      binArrayIdx.gt(new BN(maxBinArrayIdx)) ||
      binArrayIdx.lt(new BN(minBinArrayIdx))
    ) {
      break;
    }

    const nextBinArrayIndex = getNextBinArrayIndexWithLiquidity(
      binArrayIdx,
      lbPairState,
      swapForY,
      bitmapExtState
    );

    // Bin array exhausted
    if (!nextBinArrayIndex) {
      break;
    } else {
      const [binArray] = deriveBinArray(
        lbPair,
        nextBinArrayIndex,
        program.programId
      );

      binArrays.push(binArray);
      if (swapForY) {
        binArrayIdx = nextBinArrayIndex.sub(new BN(1));
      } else {
        binArrayIdx = nextBinArrayIndex.add(new BN(1));
      }
    }
  }

  return binArrays;
}

export async function dlmmSwapIx(params: {
  svm: LiteSVM;
  lbPair: PublicKey;
  amount: BN;
  swapForY: boolean;
  userAddress: PublicKey;
  destinationAddress?: PublicKey;
}) {
  const { svm, lbPair, amount, swapForY, userAddress, destinationAddress } =
    params;

  const program = createLbClmmProgram();
  const lbPairState = getLbPairState(svm, lbPair);

  const mintAccountsInfo = [lbPairState.tokenXMint, lbPairState.tokenYMint].map(
    (mint) => svm.getAccount(mint)
  );

  const binArrays = getBinArraysForSwap(svm, lbPair, swapForY);

  const binArraysAccountMeta: AccountMeta[] = binArrays.map((pubkey) => ({
    isSigner: false,
    isWritable: true,
    pubkey,
  }));

  const tokenXAta = getAssociatedTokenAddressSync(
    lbPairState.tokenXMint,
    userAddress,
    false,
    mintAccountsInfo[0].owner,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tokenYAta = getAssociatedTokenAddressSync(
    lbPairState.tokenYMint,
    userAddress,
    false,
    mintAccountsInfo[1].owner,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  let [inToken, outToken] = swapForY
    ? [tokenXAta, tokenYAta]
    : [tokenYAta, tokenXAta];

  if (destinationAddress) {
    outToken = swapForY
      ? getAssociatedTokenAddressSync(
          lbPairState.tokenYMint,
          destinationAddress,
          true,
          mintAccountsInfo[1].owner,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      : getAssociatedTokenAddressSync(
          lbPairState.tokenXMint,
          destinationAddress,
          true,
          mintAccountsInfo[0].owner,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
  }

  const [binArrayBitmapExtension] = deriveBinArrayBitmapExtension(
    lbPair,
    program.programId
  );

  const bitmapExtensionState = getBinArrayBitmapExtensionState(
    svm,
    program,
    binArrayBitmapExtension,
    true
  );

  const transferHookXAccounts = await getExtraAccountMetasForTransferHook(
    svm,
    lbPairState.tokenXMint
  );

  const transferHookYAccounts = await getExtraAccountMetasForTransferHook(
    svm,
    lbPairState.tokenYMint
  );

  let remainingAccountsInfo: RemainingAccountsInfo = { slices: [] };

  if (transferHookXAccounts.length > 0) {
    remainingAccountsInfo.slices.push({
      accountsType: AccountsType.TransferHookX,
      length: transferHookXAccounts.length,
    });
  }

  if (transferHookYAccounts.length > 0) {
    remainingAccountsInfo.slices.push({
      accountsType: AccountsType.TransferHookY,
      length: transferHookYAccounts.length,
    });
  }

  return program.methods
    .swap2(amount, new BN(0), remainingAccountsInfo)
    .accountsPartial({
      lbPair,
      binArrayBitmapExtension:
        bitmapExtensionState != null
          ? binArrayBitmapExtension
          : program.programId,
      reserveX: lbPairState.reserveX,
      reserveY: lbPairState.reserveY,
      tokenXMint: lbPairState.tokenXMint,
      tokenYMint: lbPairState.tokenYMint,
      tokenXProgram: mintAccountsInfo[0].owner,
      tokenYProgram: mintAccountsInfo[1].owner,
      user: userAddress,
      userTokenIn: inToken,
      userTokenOut: outToken,
      oracle: lbPairState.oracle,
      hostFeeIn: null,
      memoProgram: MEMO_PROGRAM_ID,
    })
    .remainingAccounts([...transferHookXAccounts, ...transferHookYAccounts])
    .remainingAccounts(binArraysAccountMeta)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ]);
}

function sortTokenMints(tokenX: PublicKey, tokenY: PublicKey) {
  const [minKey, maxKey] =
    tokenX.toBuffer().compare(tokenY.toBuffer()) == 1
      ? [tokenY, tokenX]
      : [tokenX, tokenY];

  return [minKey, maxKey];
}

function deriveLbPair(
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  baseFactor: BN,
  programId: PublicKey
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toBuffer("le", 2)),
      new Uint8Array(baseFactor.toBuffer("le", 2)),
    ],
    programId
  );
}

function deriveReserve(token: PublicKey, lbPair: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), token.toBuffer()],
    DLMM_PROGRAM_ID
  );
}

function deriveOracle(lbPair: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), lbPair.toBytes()],
    DLMM_PROGRAM_ID
  );
}

function setPresetParametersV1Account(
  svm: LiteSVM,
  program: Program<LbClmm>,
  param: PresetParameterV1
) {
  const buf = Buffer.alloc(36);

  const disc = Buffer.from([242, 62, 244, 34, 181, 112, 58, 170]);
  disc.copy(buf, 0);

  let offset = 8;
  buf.writeUInt16LE(param.binStep, offset);
  offset += 2;
  buf.writeUInt16LE(param.baseFactor, offset);
  offset += 2;
  buf.writeUInt16LE(param.filterPeriod, offset);
  offset += 2;
  buf.writeUInt16LE(param.decayPeriod, offset);
  offset += 2;
  buf.writeUInt16LE(param.reductionFactor, offset);
  offset += 2;
  buf.writeUInt32LE(param.variableFeeControl, offset);
  offset += 4;
  buf.writeUInt32LE(param.maxVolatilityAccumulator, offset);
  offset += 4;
  buf.writeInt32LE(param.minBinId, offset);
  offset += 4;
  buf.writeInt32LE(param.maxBinId, offset);
  offset += 4;
  buf.writeUInt16LE(param.protocolShare, offset);
  offset += 2;

  const presetParamPda = PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter"),
      new Uint8Array(new BN(param.binStep).toBuffer("le", 2)),
      new Uint8Array(new BN(param.baseFactor).toBuffer("le", 2)),
    ],
    program.programId
  )[0];

  const accountInfo: AccountInfoBytes = {
    data: buf,
    executable: false,
    lamports: 1200626308,
    owner: program.programId,
  };

  svm.setAccount(presetParamPda, accountInfo);

  return presetParamPda;
}

export async function createLbPair(params: {
  svm: LiteSVM;
  tokenX: PublicKey;
  tokenY: PublicKey;
  activeId: BN;
  keypair: Keypair;
}) {
  const { svm, tokenX, tokenY, activeId, keypair } = params;

  const baseFactor = 10_000;
  const binStep = 10;

  const program = createLbClmmProgram();
  setPresetParametersV1Account(svm, program, {
    binStep,
    baseFactor,
    filterPeriod: 30,
    decayPeriod: 600,
    reductionFactor: 5000,
    variableFeeControl: 40000,
    protocolShare: 0,
    maxBinId: 43690,
    minBinId: -43690,
    maxVolatilityAccumulator: 350000,
  });

  const [lbPair] = deriveLbPair(
    tokenX,
    tokenY,
    new BN(binStep),
    new BN(baseFactor),
    program.programId
  );

  const [reserveX] = deriveReserve(tokenX, lbPair);
  const [reserveY] = deriveReserve(tokenY, lbPair);
  const [oracle] = deriveOracle(lbPair);

  const binArrayBitmapExtension = null;

  const presetParamPda = PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter"),
      new Uint8Array(new BN(binStep).toBuffer("le", 2)),
      new Uint8Array(new BN(baseFactor).toBuffer("le", 2)),
    ],
    program.programId
  )[0];

  const tx = await program.methods
    .initializeLbPair(activeId.toNumber(), binStep)
    .accountsPartial({
      funder: keypair.publicKey,
      lbPair,
      rent: SYSVAR_RENT_PUBKEY,
      reserveX,
      reserveY,
      oracle,
      binArrayBitmapExtension,
      tokenMintX: tokenX,
      tokenMintY: tokenY,
      tokenProgram: TOKEN_PROGRAM_ID,
      presetParameter: presetParamPda,
    })
    .transaction();

  sendTransaction(svm, tx, [keypair]);

  return lbPair;
}

export async function createDlmmPosition(
  svm: LiteSVM,
  lbPair: PublicKey,
  lowerBinId: number,
  admin: Keypair,
  width?: number
): Promise<PublicKey> {
  const program = createLbClmmProgram();
  const positionWidth = width ? width : DEFAULT_BIN_PER_POSITION.toNumber();
  const position = Keypair.generate();

  const tx = await program.methods
    .initializePosition(lowerBinId, positionWidth)
    .accountsPartial({
      lbPair,
      owner: admin.publicKey,
      payer: admin.publicKey,
      position: position.publicKey,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .transaction();

  const res = sendTransaction(svm, tx, [admin, position]);

  return position.publicKey;
}

async function getBinArraysForModifyLiquidity(
  lbPair: PublicKey,
  minBinId: number,
  program: Program<LbClmm>
) {
  const lowerBinId = new BN(minBinId);

  const binArrayLowerIndex = binIdToBinArrayIndex(lowerBinId);
  const binArrayUpperIndex = binArrayLowerIndex.add(new BN(1));

  const [binArrayLower] = deriveBinArray(
    lbPair,
    binArrayLowerIndex,
    program.programId
  );
  const [binArrayUpper] = deriveBinArray(
    lbPair,
    binArrayUpperIndex,
    program.programId
  );

  return {
    binArrayLower,
    binArrayUpper,
  };
}

type BinLiquidityDistribution = IdlTypes<LbClmm>["binLiquidityDistribution"];
function getSpotPatternDistribution(
  delta: number,
  activeId: number
): BinLiquidityDistribution[] {
  const positiveDelta = Math.abs(delta);
  const negativeDelta = -positiveDelta;

  const binLiquidityDist = [];

  const distPerNonActiveBin = Math.floor(BASIS_POINT_MAX / (0.5 + delta));

  for (let i = negativeDelta; i <= positiveDelta; i++) {
    let deltaId = i;
    let distributionX = 0;
    let distributionY = 0;

    if (i < 0) {
      distributionY = distPerNonActiveBin;
    } else if (i == 0) {
      distributionX = BASIS_POINT_MAX - distPerNonActiveBin * delta;
      distributionY = BASIS_POINT_MAX - distPerNonActiveBin * delta;
    } else {
      distributionX = distPerNonActiveBin;
    }

    let dist: BinLiquidityDistribution = {
      binId: activeId + deltaId,
      distributionX,
      distributionY,
    };
    binLiquidityDist.push(dist);
  }

  return binLiquidityDist;
}

export async function addLiquidityRadius(
  svm: LiteSVM,
  lbPair: PublicKey,
  position: PublicKey,
  amountX: BN,
  amountY: BN,
  delta: number,
  admin: Keypair
) {
  const program = createLbClmmProgram();
  let [binArrayBitmapExtension] = deriveBinArrayBitmapExtension(
    lbPair,
    program.programId
  );
  let binArrayBitmapExtensionInfo = svm.getAccount(binArrayBitmapExtension);
  if (!binArrayBitmapExtensionInfo) {
    binArrayBitmapExtension = null;
  }

  const lbPairState = getLbPairState(svm, lbPair);

  const positionState = await fetchAndDecodeDynamicPosition(
    svm,
    program,
    position
  );
  const { binArrayLower, binArrayUpper } = await getBinArraysForModifyLiquidity(
    lbPair,
    positionState.globalData.lowerBinId,
    program
  );
  const mintAccountsInfo = [lbPairState.tokenXMint, lbPairState.tokenYMint].map(
    (mint) => svm.getAccount(mint)
  );
  const userTokenX = getAssociatedTokenAddressSync(
    lbPairState.tokenXMint,
    admin.publicKey,
    false,
    mintAccountsInfo[0].owner,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const userTokenY = getAssociatedTokenAddressSync(
    lbPairState.tokenYMint,
    admin.publicKey,
    false,
    mintAccountsInfo[1].owner,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const binLiquidityDist = getSpotPatternDistribution(
    delta,
    lbPairState.activeId
  );

  const tx = await program.methods
    .addLiquidity({
      amountX,
      amountY,
      binLiquidityDist,
    })
    .accountsPartial({
      lbPair,
      binArrayBitmapExtension,
      position,
      reserveX: lbPairState.reserveX,
      reserveY: lbPairState.reserveY,
      tokenXMint: lbPairState.tokenXMint,
      tokenYMint: lbPairState.tokenYMint,
      tokenXProgram: mintAccountsInfo[0].owner,
      tokenYProgram: mintAccountsInfo[1].owner,
      sender: admin.publicKey,
      userTokenX,
      userTokenY,
      binArrayLower,
      binArrayUpper,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      }),
    ])
    .transaction();

  const metadata = sendTransaction(svm, tx, [admin]);

  return {
    binArrayLower,
    binArrayUpper,
    binLiquidityDistribution: binLiquidityDist,
    metadata,
  };
}

export type PositionV2 = Omit<IdlAccounts<LbClmm>["positionV2"], "">;
type UserRewardInfo = IdlTypes<LbClmm>["userRewardInfo"];
type FeeInfo = IdlTypes<LbClmm>["feeInfo"];
type PositionBinData = {
  liquidityShare: BN;
  rewardInfo: UserRewardInfo;
  feeInfo: FeeInfo;
};
type DynamicPosition = {
  globalData: {
    lbPair: PublicKey;
    owner: PublicKey;
    lowerBinId: number;
    upperBinId: number;
    lastUpdatedAt: BN;
    totalClaimedFeeXAmount: BN;
    totalClaimedFeeYAmount: BN;
    totalClaimedRewards: BN[];
    operator: PublicKey;
    lockReleasePoint: BN;
    padding0: number[];
    feeOwner: PublicKey;
    binCount: BN;
    length: BN;
    reserved: number[];
  };
  positionBinData: PositionBinData[];
};
export const DEFAULT_BIN_PER_POSITION = new BN(
  CONSTANTS.find(([k, v]) => v.name == "DEFAULT_BIN_PER_POSITION")[1].value
);
async function fetchAndDecodeDynamicPosition(
  svm: LiteSVM,
  program: Program<LbClmm>,
  position: PublicKey
): Promise<DynamicPosition> {
  const positionAccount = svm.getAccount(position);

  if (!positionAccount) throw new Error("Invalid position account");

  const positionState = program.coder.accounts.decode<PositionV2>(
    "positionV2",
    Buffer.from(positionAccount.data)
  );

  const remainingBytes = positionAccount.data.subarray(8 + 8112);

  const positionWidth = Math.max(
    positionState.upperBinId - positionState.lowerBinId + 1,
    DEFAULT_BIN_PER_POSITION.toNumber()
  );

  const binCount = positionState.upperBinId - positionState.lowerBinId + 1;

  const outerBinCount =
    binCount > DEFAULT_BIN_PER_POSITION.toNumber()
      ? binCount - DEFAULT_BIN_PER_POSITION.toNumber()
      : 0;

  const positionBinDataSchema = {
    array: {
      type: {
        struct: {
          liquidityShare: "u128",
          rewardInfo: {
            struct: {
              rewardPerTokenCompletes: {
                array: {
                  type: "u128",
                  len: 2,
                },
              },
              rewardPendings: {
                array: {
                  type: "u64",
                  len: 2,
                },
              },
            },
          },
          feeInfo: {
            struct: {
              feeXPerTokenComplete: "u128",
              feeYPerTokenComplete: "u128",
              feeXPending: "u64",
              feeYPending: "u64",
            },
          },
        },
      },
      len: outerBinCount,
    },
  };

  // @ts-ignore
  // TODO: How to fix this? Somehow it decode it to bigint ...
  let extendedPositionBinData: PositionBinData[] =
    outerBinCount > 0
      ? borsh.deserialize(positionBinDataSchema, remainingBytes)
      : [];

  // Map back to BN ...
  extendedPositionBinData = extendedPositionBinData.map((b) => {
    return {
      liquidityShare: new BN(b.liquidityShare.toString()),
      rewardInfo: {
        rewardPendings: b.rewardInfo.rewardPendings.map(
          (r) => new BN(r.toString())
        ),
        rewardPerTokenCompletes: b.rewardInfo.rewardPerTokenCompletes.map(
          (r) => new BN(r.toString())
        ),
      },
      feeInfo: {
        feeXPending: new BN(b.feeInfo.feeXPending.toString()),
        feeYPending: new BN(b.feeInfo.feeYPending.toString()),
        feeXPerTokenComplete: new BN(b.feeInfo.feeXPerTokenComplete.toString()),
        feeYPerTokenComplete: new BN(b.feeInfo.feeYPerTokenComplete.toString()),
      },
    };
  });

  const innerPositionBinData: PositionBinData[] = [];

  for (let i = 0; i < DEFAULT_BIN_PER_POSITION.toNumber(); i++) {
    innerPositionBinData.push({
      liquidityShare: positionState.liquidityShares[i],
      rewardInfo: positionState.rewardInfos[i],
      feeInfo: positionState.feeInfos[i],
    });
  }

  const positionBinData = innerPositionBinData.concat(extendedPositionBinData);

  return {
    globalData: {
      lbPair: positionState.lbPair,
      owner: positionState.owner,
      lowerBinId: positionState.lowerBinId,
      upperBinId: positionState.upperBinId,
      lastUpdatedAt: positionState.lastUpdatedAt,
      totalClaimedFeeXAmount: positionState.totalClaimedFeeXAmount,
      totalClaimedFeeYAmount: positionState.totalClaimedFeeYAmount,
      totalClaimedRewards: positionState.totalClaimedRewards,
      operator: positionState.operator,
      length: new BN(positionWidth),
      binCount: new BN(binCount),
      lockReleasePoint: positionState.lockReleasePoint,
      feeOwner: positionState.feeOwner,
      padding0: [],
      reserved: [],
    },
    positionBinData,
  };
}
