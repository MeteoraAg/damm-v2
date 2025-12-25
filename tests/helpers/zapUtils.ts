import * as borsh from "@coral-xyz/borsh";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { LiteSVM } from "litesvm";
import {
  JUP_V6_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  ZAP_PROGRAM_ID,
} from "./constants";
import {
  createCpAmmProgram,
  getPool,
  initializeCustomizablePool,
  InitializeCustomizablePoolParams,
  Pool,
} from "./cpAmm";
import { createLbClmmProgram, dlmmSwapIx, getLbPairState } from "./dlmm";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./feeCodec";
import { getTokenAccount } from "./token";

const authorityId = 0;
export const jupProgramAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("authority"), new BN(authorityId).toBuffer("le", 1)],
  JUPITER_V6_PROGRAM_ID
);

async function getDammV2SwapIx(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey
) {
  const program = createCpAmmProgram();

  const poolState = getPool(svm, pool);

  const [inputTokenAccount, outputTokenAccount] = outputMint.equals(
    poolState.tokenAMint
  )
    ? [
        getAssociatedTokenAddressSync(
          poolState.tokenBMint,
          operatorAddress,
          true
        ),
        getAssociatedTokenAddressSync(
          poolState.tokenAMint,
          treasuryAddress,
          true
        ),
      ]
    : [
        getAssociatedTokenAddressSync(
          poolState.tokenAMint,
          operatorAddress,
          true
        ),
        getAssociatedTokenAddressSync(
          poolState.tokenBMint,
          treasuryAddress,
          true
        ),
      ];

  const swapIx = await program.methods
    .swap({
      amountIn: protocolFeeAmount,
      minimumAmountOut: new BN(0),
    })
    .accountsPartial({
      pool,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      payer: operatorAddress,
      inputTokenAccount,
      outputTokenAccount,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
    })
    .instruction();

  return swapIx;
}

export async function buildZapOutJupV6UsingDammV2SharedRouteInstruction(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey
) {
  const poolAccount = svm.getAccount(pool);
  const dammV2Program = createCpAmmProgram();

  if (poolAccount.owner.toBase58() != dammV2Program.programId.toBase58()) {
    throw new Error("Unsupported pool for JupV6 zap out");
  }

  const poolState: Pool = dammV2Program.coder.accounts.decode(
    "pool",
    Buffer.from(poolAccount.data)
  );

  const inputMint = outputMint.equals(poolState.tokenAMint)
    ? poolState.tokenBMint
    : poolState.tokenAMint;

  const swapIx = await getDammV2SwapIx(
    svm,
    pool,
    protocolFeeAmount,
    outputMint,
    jupProgramAuthority[0],
    jupProgramAuthority[0]
  );

  // Because shared route pass in program authority as signer, therefore we need to override the signer
  swapIx.keys.map((key) => {
    if (key.isSigner) {
      key.isSigner = false;
    }
  });

  const userTokenInAddress = getAssociatedTokenAddressSync(
    inputMint,
    operatorAddress
  );

  const userTokenInAccount = getTokenAccount(svm, userTokenInAddress);

  const preUserTokenBalance = userTokenInAccount
    ? userTokenInAccount.amount
    : BigInt(0);

  const SHARED_ACCOUNT_ROUTE_DISC = [193, 32, 155, 51, 65, 214, 156, 129];
  // The enum is too long, so we define only the parts we need
  // TODO: Find a better way to encode this ...
  const DAMM_V2_SWAP = 77;

  const routePlanStepSchema = borsh.struct([
    borsh.u8("enumValue"),
    borsh.u8("percent"),
    borsh.u8("inputIndex"),
    borsh.u8("outputIndex"),
  ]);

  const routeIxSchema = borsh.struct([
    borsh.u64("discriminator"),
    borsh.u8("id"),
    borsh.vec(routePlanStepSchema, "routePlan"),
    borsh.u64("inAmount"),
    borsh.u64("quotedOutAmount"),
    borsh.u16("slippageBps"),
    borsh.u8("platformFeeBps"),
  ]);

  const buffer = Buffer.alloc(1000);

  routeIxSchema.encode(
    {
      discriminator: new BN(SHARED_ACCOUNT_ROUTE_DISC, "le"),
      id: authorityId,
      routePlan: [
        {
          enumValue: DAMM_V2_SWAP,
          percent: 100,
          inputIndex: 0,
          outputIndex: 1,
        },
      ],
      inAmount: protocolFeeAmount,
      quotedOutAmount: new BN(0),
      slippageBps: 0,
      platformFeeBps: 0,
    },
    buffer
  );

  const routeIxData = buffer.subarray(0, routeIxSchema.getSpan(buffer));

  const zapOutRawParameters = buildZapOutParameter({
    preUserTokenBalance: new BN(preUserTokenBalance.toString()),
    maxSwapAmount: protocolFeeAmount,
    payloadData: routeIxData,
    offsetAmountIn: routeIxData.length - 19,
  });

  const zapOutAccounts: AccountMeta[] = [
    {
      pubkey: userTokenInAddress,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];

  const jupV6RouteAccounts: AccountMeta[] = [
    {
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: jupProgramAuthority[0],
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: operatorAddress,
      isSigner: true,
      isWritable: false,
    },
    {
      pubkey: getAssociatedTokenAddressSync(inputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(
        inputMint,
        jupProgramAuthority[0],
        true
      ),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(
        outputMint,
        jupProgramAuthority[0],
        true
      ),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, treasuryAddress, true),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: inputMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: outputMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: TOKEN_2022_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUP_V6_EVENT_AUTHORITY,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: dammV2Program.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  jupV6RouteAccounts.push(...swapIx.keys);
  zapOutAccounts.push(...jupV6RouteAccounts);

  const zapOutIx: TransactionInstruction = {
    programId: ZAP_PROGRAM_ID,
    keys: zapOutAccounts,
    data: zapOutRawParameters,
  };

  return zapOutIx;
}

export async function buildZapOutJupV6UsingDammV2RouteInstruction(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey
) {
  const poolAccount = svm.getAccount(pool);
  const dammV2Program = createCpAmmProgram();

  if (poolAccount.owner.toBase58() != dammV2Program.programId.toBase58()) {
    throw new Error("Unsupported pool for JupV6 zap out");
  }

  const poolState: Pool = dammV2Program.coder.accounts.decode(
    "pool",
    Buffer.from(poolAccount.data)
  );

  const inputMint = outputMint.equals(poolState.tokenAMint)
    ? poolState.tokenBMint
    : poolState.tokenAMint;

  const swapIx = await getDammV2SwapIx(
    svm,
    pool,
    protocolFeeAmount,
    outputMint,
    operatorAddress,
    treasuryAddress
  );
  const inputTokenAccount = swapIx.keys[2].pubkey;

  const userTokenInAccount = getTokenAccount(svm, inputTokenAccount);
  const preUserTokenBalance = userTokenInAccount
    ? userTokenInAccount.amount
    : BigInt(0);

  const ROUTE_DISC = [229, 23, 203, 151, 122, 227, 173, 42];
  // The enum is too long, so we define only the parts we need
  // TODO: Find a better way to encode this ...
  const DAMM_V2_SWAP = 77;

  const routePlanStepSchema = borsh.struct([
    borsh.u8("enumValue"),
    borsh.u8("percent"),
    borsh.u8("inputIndex"),
    borsh.u8("outputIndex"),
  ]);

  const routeIxSchema = borsh.struct([
    borsh.u64("discriminator"),
    borsh.vec(routePlanStepSchema, "routePlan"),
    borsh.u64("inAmount"),
    borsh.u64("quotedOutAmount"),
    borsh.u16("slippageBps"),
    borsh.u8("platformFeeBps"),
  ]);

  const buffer = Buffer.alloc(1000);

  routeIxSchema.encode(
    {
      discriminator: new BN(ROUTE_DISC, "le"),
      routePlan: [
        {
          enumValue: DAMM_V2_SWAP,
          percent: 100,
          inputIndex: 0,
          outputIndex: 1,
        },
      ],
      inAmount: protocolFeeAmount,
      quotedOutAmount: new BN(0),
      slippageBps: 0,
      platformFeeBps: 0,
    },
    buffer
  );

  const routeIxData = buffer.subarray(0, routeIxSchema.getSpan(buffer));

  const zapOutRawParameters = buildZapOutParameter({
    preUserTokenBalance: new BN(preUserTokenBalance.toString()),
    maxSwapAmount: protocolFeeAmount,
    payloadData: routeIxData,
    offsetAmountIn: routeIxData.length - 19,
  });

  const zapOutAccounts: AccountMeta[] = [
    {
      pubkey: inputTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];

  const jupV6RouteAccounts: AccountMeta[] = [
    {
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: operatorAddress,
      isSigner: true,
      isWritable: false,
    },
    {
      pubkey: getAssociatedTokenAddressSync(inputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, treasuryAddress, true),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: outputMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUP_V6_EVENT_AUTHORITY,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: dammV2Program.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  jupV6RouteAccounts.push(...swapIx.keys);
  zapOutAccounts.push(...jupV6RouteAccounts);

  const zapOutIx: TransactionInstruction = {
    programId: ZAP_PROGRAM_ID,
    keys: zapOutAccounts,
    data: zapOutRawParameters,
  };

  return zapOutIx;
}

export async function buildZapOutDammV2Instruction(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey
) {
  const program = createCpAmmProgram();

  const swapIx = await getDammV2SwapIx(
    svm,
    pool,
    protocolFeeAmount,
    outputMint,
    operatorAddress,
    treasuryAddress
  );

  const inputTokenAccount = swapIx.keys[2].pubkey;

  const userTokenInAccount = getTokenAccount(svm, inputTokenAccount);
  const preUserTokenBalance = userTokenInAccount
    ? userTokenInAccount.amount
    : BigInt(0);

  const zapOutRawParameters = buildZapOutParameter({
    preUserTokenBalance: new BN(preUserTokenBalance.toString()),
    maxSwapAmount: protocolFeeAmount,
    payloadData: swapIx.data,
    offsetAmountIn: 8,
  });

  const zapOutAccounts: AccountMeta[] = [
    {
      pubkey: inputTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: program.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  zapOutAccounts.push(...swapIx.keys);

  const zapOutIx: TransactionInstruction = {
    programId: ZAP_PROGRAM_ID,
    keys: zapOutAccounts,
    data: zapOutRawParameters,
  };

  return zapOutIx;
}

interface ZapOutParameter {
  preUserTokenBalance: BN;
  maxSwapAmount: BN;
  offsetAmountIn: number;
  payloadData: Buffer;
}

function buildZapOutParameter(params: ZapOutParameter) {
  const { preUserTokenBalance, maxSwapAmount, offsetAmountIn, payloadData } =
    params;

  const zapOutDisc = [155, 108, 185, 112, 104, 210, 161, 64];
  const zapOutDiscBN = new BN(zapOutDisc, "le");

  const zapOutParameterSchema = borsh.struct([
    borsh.u64("discriminator"),
    borsh.u8("percentage"),
    borsh.u16("offsetAmountIn"),
    borsh.u64("preUserTokenBalance"),
    borsh.u64("maxSwapAmount"),
    borsh.vecU8("payloadData"),
  ]);

  const buffer = Buffer.alloc(1000);

  zapOutParameterSchema.encode(
    {
      discriminator: zapOutDiscBN,
      percentage: 100,
      offsetAmountIn,
      preUserTokenBalance,
      maxSwapAmount,
      payloadData,
    },
    buffer
  );

  return buffer.subarray(0, zapOutParameterSchema.getSpan(buffer));
}

export function getLiquidityDeltaFromAmountA(
  amountA: BN,
  lowerSqrtPrice: BN, // current sqrt price
  upperSqrtPrice: BN // max sqrt price
): BN {
  const product = amountA.mul(lowerSqrtPrice).mul(upperSqrtPrice); // Q128.128
  const denominator = upperSqrtPrice.sub(lowerSqrtPrice); // Q64.64

  return product.div(denominator);
}

function getLiquidityDeltaFromAmountB(
  amountB: BN,
  lowerSqrtPrice: BN, // min sqrt price
  upperSqrtPrice: BN // current sqrt price,
): BN {
  const denominator = upperSqrtPrice.sub(lowerSqrtPrice);
  const product = amountB.shln(128);
  return product.div(denominator);
}

export async function createCustomizableDammV2Pool(params: {
  svm: LiteSVM;
  amountA: BN;
  amountB: BN;
  sqrtPriceX64: BN;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  payer: Keypair;
}) {
  const { svm, amountA, amountB, sqrtPriceX64, tokenAMint, tokenBMint, payer } =
    params;

  const MIN_SQRT_PRICE = new BN("4295048016");
  const MAX_SQRT_PRICE = new BN("79226673521066979257578248091");

  const liquidityA = getLiquidityDeltaFromAmountA(
    amountA,
    MIN_SQRT_PRICE,
    sqrtPriceX64
  );
  const liquidityB = getLiquidityDeltaFromAmountB(
    amountB,
    sqrtPriceX64,
    MAX_SQRT_PRICE
  );
  const liquidity = BN.min(liquidityA, liquidityB);

  const cliffFeeNumerator = new BN(10_000_000);
  const numberOfPeriods = 0;
  const periodFrequency = new BN(0);
  const reductionFactor = new BN(0);
  const data = encodeFeeTimeSchedulerParams(
    BigInt(cliffFeeNumerator.toString()),
    numberOfPeriods,
    BigInt(periodFrequency.toString()),
    BigInt(reductionFactor.toString()),
    BaseFeeMode.FeeTimeSchedulerLinear
  );
  const createPoolParams: InitializeCustomizablePoolParams = {
    payer: payer,
    creator: payer.publicKey,
    tokenAMint,
    tokenBMint,
    liquidity: liquidity,
    sqrtPrice: sqrtPriceX64,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    hasAlphaVault: false,
    activationPoint: null,
    poolFees: {
      baseFee: {
        data: Array.from(data),
      },
      padding: [],
      dynamicFee: null,
    },
    activationType: 0, // slot
    collectFeeMode: 1, // onlyB
  };
  const { pool } = await initializeCustomizablePool(svm, createPoolParams);

  return pool;
}

export async function buildZapOutDlmmInstruction(
  svm: LiteSVM,
  lbPair: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey
) {
  const program = createLbClmmProgram();
  const lbPairState = getLbPairState(svm, lbPair);

  const swapForY = outputMint.equals(lbPairState.tokenYMint);

  const swapFn = await dlmmSwapIx({
    svm,
    lbPair,
    swapForY,
    userAddress: operatorAddress,
    destinationAddress: treasuryAddress,
    amount: protocolFeeAmount,
  });

  const swapIx = await swapFn.instruction();

  const userTokenIn = swapForY
    ? getAssociatedTokenAddressSync(lbPairState.tokenXMint, operatorAddress)
    : getAssociatedTokenAddressSync(lbPairState.tokenYMint, operatorAddress);

  const userTokenInAccount = getTokenAccount(svm, userTokenIn);
  const preUserTokenBalance = userTokenInAccount
    ? userTokenInAccount.amount
    : BigInt(0);

  const zapOutRawParameters = buildZapOutParameter({
    preUserTokenBalance: new BN(preUserTokenBalance.toString()),
    maxSwapAmount: protocolFeeAmount,
    payloadData: swapIx.data,
    offsetAmountIn: 8,
  });

  const zapOutAccounts: AccountMeta[] = [
    {
      pubkey: userTokenIn,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: program.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  zapOutAccounts.push(...swapIx.keys);

  const zapOutIx: TransactionInstruction = {
    programId: ZAP_PROGRAM_ID,
    keys: zapOutAccounts,
    data: zapOutRawParameters,
  };

  return zapOutIx;
}
