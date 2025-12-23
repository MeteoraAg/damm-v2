import { BN } from "@coral-xyz/anchor";
import { program } from "@coral-xyz/anchor/dist/cjs/native/system";
import * as borsh from "@coral-xyz/borsh";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import Decimal from "decimal.js";
import { LiteSVM } from "litesvm";
import {
  addLiquidity,
  AddLiquidityParams,
  createConfigIx,
  CreateConfigParams,
  createCpAmmProgram,
  createOperator,
  createPosition,
  createToken,
  DECIMALS,
  deriveOperatorAddress,
  encodePermissions,
  generateKpAndFund,
  getPool,
  getTokenAccount,
  initializePool,
  InitializePoolParams,
  JUP_V6_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  MAX_SQRT_PRICE,
  MIN_LP_AMOUNT,
  MIN_SQRT_PRICE,
  mintSplTokenTo,
  OperatorPermission,
  Pool,
  randomID,
  startSvm,
  swapExactIn,
  SwapParams,
  TREASURY,
  ZAP_PROGRAM_ID,
  zapProtocolFee,
} from "./helpers";
import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";

const authorityId = 0;
const jupProgramAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("authority"), new BN(authorityId).toBuffer("le", 1)],
  JUPITER_V6_PROGRAM_ID
);

describe("Zap protocol fees", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let user: Keypair;
  let creator: Keypair;
  let whitelistedAccount: Keypair;
  let config: PublicKey;
  let liquidity: BN;
  let sqrtPrice: BN;
  let pool: PublicKey;
  let position: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;

  beforeEach(async () => {
    svm = startSvm();

    user = generateKpAndFund(svm);
    admin = generateKpAndFund(svm);
    creator = generateKpAndFund(svm);
    whitelistedAccount = generateKpAndFund(svm);

    tokenAMint = createToken(svm, admin.publicKey);
    tokenBMint = createToken(svm, admin.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, user.publicKey);

    mintSplTokenTo(svm, tokenAMint, admin, creator.publicKey);

    mintSplTokenTo(svm, tokenBMint, admin, creator.publicKey);

    const cliffFeeNumerator = new BN(2_500_000);
    const numberOfPeriod = new BN(0);
    const periodFrequency = new BN(0);
    const reductionFactor = new BN(0);

    const data = encodeFeeTimeSchedulerParams(
      BigInt(cliffFeeNumerator.toString()),
      numberOfPeriod.toNumber(),
      BigInt(periodFrequency.toString()),
      BigInt(reductionFactor.toString()),
      BaseFeeMode.FeeTimeSchedulerLinear
    );

    // create config
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          data: Array.from(data),
        },
        padding: [],
        dynamicFee: null,
      },
      sqrtMinPrice: new BN(MIN_SQRT_PRICE),
      sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
      vaultConfigKey: PublicKey.default,
      poolCreatorAuthority: PublicKey.default,
      activationType: 0,
      collectFeeMode: 0,
    };

    let permission = encodePermissions([OperatorPermission.CreateConfigKey]);

    await createOperator(svm, {
      admin,
      whitelistAddress: whitelistedAccount.publicKey,
      permission,
    });

    config = await createConfigIx(
      svm,
      whitelistedAccount,
      new BN(randomID()),
      createConfigParams
    );

    liquidity = new BN(MIN_LP_AMOUNT);
    sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity,
      sqrtPrice,
      activationPoint: null,
    };

    const result = await initializePool(svm, initPoolParams);
    pool = result.pool;
    position = await createPosition(svm, user, user.publicKey, pool);

    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(svm, addLiquidityParams);

    const swapParams: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams);

    const swapParams2: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenBMint,
      outputTokenMint: tokenAMint,
      amountIn: new BN(10000),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(svm, swapParams2);
  });

  describe("ZapOut protocol fees via DAMM V2)", () => {
    const price = new Decimal(1);

    const sqrtPrice = price.sqrt();
    const sqrtPriceX64 = new BN(
      sqrtPrice.mul(new Decimal(2).pow(64)).floor().toString()
    );

    it("Zap protocol fee tokenA to token SOL", async () => {
      const isClaimTokenX = true;
      const zapOutputMint = NATIVE_MINT;

      const initPoolParams: InitializePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        config,
        tokenAMint,
        tokenBMint,
        liquidity,
        sqrtPrice: MIN_SQRT_PRICE.muln(2),
        activationPoint: null,
      };

      const result = await initializePool(svm, initPoolParams);
      const dammV2PoolAddress = result.pool;

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutDammV2Instruction
      );
    });

    it("Zap protocol fee tokenB to token SOL", async () => {
      const isClaimTokenX = false;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        feeBps: new BN(100),
        amountX: new BN(100).mul(new BN(10 ** DECIMALS)),
        amountY: new BN(100).mul(new BN(10 ** DECIMALS)),
        sqrtPriceX64,
        tokenXMint: tokenBMint,
        payer: admin,
        tokenYMint: NATIVE_MINT,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutDammV2Instruction
      );
    });
  });

  describe("Zapout protocol fees via JUP v6 route)", () => {
    const price = new Decimal(1);

    const sqrtPrice = price.sqrt();
    const sqrtPriceX64 = new BN(
      sqrtPrice.mul(new Decimal(2).pow(64)).floor().toString()
    );

    it("Zap protocol fee X to token SOL", async () => {
      const isClaimTokenX = true;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        feeBps: new BN(100),
        amountX: new BN(100).mul(new BN(10 ** btcDecimal)),
        amountY: new BN(100).mul(new BN(10 ** 9)),
        sqrtPriceX64,
        tokenXMint: BTC,
        payer: keypair,
        tokenYMint: NATIVE_MINT,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2RouteInstruction
      );
    });

    it("Zap protocol fee Y to token SOL", async () => {
      const isClaimTokenX = false;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        feeBps: new BN(100),
        amountX: new BN(100).mul(new BN(10 ** usdcDecimal)),
        amountY: new BN(100).mul(new BN(10 ** 9)),
        sqrtPriceX64,
        tokenXMint: USDC,
        payer: keypair,
        tokenYMint: NATIVE_MINT,
      });

      await zapOutAndAssert(
        svm,
        pool,
        isClaimTokenX,
        whitelistedAccount,
        TREASURY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2RouteInstruction
      );
    });
  });

  describe("ZapOut protocol fees via JUP v6 shared route)", () => {
    const price = new Decimal(1);

    const sqrtPrice = price.sqrt();
    const sqrtPriceX64 = new BN(
      sqrtPrice.mul(new Decimal(2).pow(64)).floor().toString()
    );

    it("Zap protocol fee X to token SOL", async () => {
      const isClaimTokenX = true;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        feeBps: new BN(100),
        amountX: new BN(100).mul(new BN(10 ** btcDecimal)),
        amountY: new BN(100).mul(new BN(10 ** 9)),
        sqrtPriceX64,
        tokenXMint: BTC,
        payer: keypair,
        tokenYMint: NATIVE_MINT,
      });

      await zapOutAndAssert(
        svm,
        program,
        lbPair,
        isClaimTokenX,
        whitelistedOperator,
        ADMIN_PUBKEY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2SharedRouteInstruction
      );
    });

    it("Zap protocol fee Y to token SOL", async () => {
      const isClaimTokenX = false;
      const zapOutputMint = NATIVE_MINT;

      const dammV2PoolAddress = await createCustomizableDammV2Pool({
        svm,
        feeBps: new BN(100),
        amountX: new BN(100).mul(new BN(10 ** usdcDecimal)),
        amountY: new BN(100).mul(new BN(10 ** 9)),
        sqrtPriceX64,
        tokenXMint: USDC,
        payer: keypair,
        tokenYMint: NATIVE_MINT,
      });

      await zapOutAndAssert(
        svm,
        program,
        lbPair,
        isClaimTokenX,
        whitelistedOperator,
        ADMIN_PUBKEY,
        dammV2PoolAddress,
        zapOutputMint,
        buildZapOutJupV6UsingDammV2SharedRouteInstruction
      );
    });
  });
});

async function zapOutAndAssert(
  svm: LiteSVM,
  pool: PublicKey,
  isClaimTokenA: boolean,
  operatorKeypair: Keypair,
  treasuryAddress: PublicKey,
  zapPoolAddress: PublicKey,
  zapOutputMint: PublicKey,
  zapOutIxFn: (
    svm: LiteSVM,
    pool: PublicKey,
    protocolFeeAmount: BN,
    outputMint: PublicKey,
    operatorAddress: PublicKey,
    treasuryAddress: PublicKey
  ) => Promise<TransactionInstruction>
) {
  const poolState = getPool(svm, pool);
  const operatorAddress = operatorKeypair.publicKey;

  const treasuryZapTokenAddress = getAssociatedTokenAddressSync(
    zapOutputMint,
    treasuryAddress
  );

  const operatorTokenXAddress = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    operatorAddress
  );

  const operatorTokenYAddress = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    operatorAddress
  );

  // TODO: fix this
  const claimAmount = isClaimTokenA
    ? poolState.metrics.totalProtocolAFee
    : poolState.metrics.totalProtocolBFee;

  const receiverToken = isClaimTokenA
    ? operatorTokenXAddress
    : operatorTokenYAddress;

  const tokenVault = isClaimTokenA
    ? poolState.tokenAVault
    : poolState.tokenBVault;

  const tokenMint = isClaimTokenA ? poolState.tokenAMint : poolState.tokenBMint;

  const zapOutIx = await zapOutIxFn(
    svm,
    zapPoolAddress,
    claimAmount,
    zapOutputMint,
    operatorAddress,
    treasuryAddress
  );

  const beforeTreasuryTokenAccount = getTokenAccount(
    svm,
    treasuryZapTokenAddress
  );

  await zapProtocolFee({
    svm,
    pool,
    tokenVault,
    tokenMint,
    receiverToken,
    operator: deriveOperatorAddress(operatorAddress),
    signer: operatorKeypair,
    tokenProgram: TOKEN_PROGRAM_ID,
    maxAmount: claimAmount,
    postInstruction: zapOutIx,
  });

  const afterTreasuryTokenAccount = getTokenAccount(
    svm,
    treasuryZapTokenAddress
  );

  const beforeAmount = beforeTreasuryTokenAccount
    ? new BN(beforeTreasuryTokenAccount.amount.toString())
    : new BN(0);

  const afterAmount = afterTreasuryTokenAccount
    ? new BN(afterTreasuryTokenAccount.amount.toString())
    : new BN(0);

  console.log(
    `Treasury token account before: ${beforeAmount.toString()}, after: ${afterAmount.toString()}`
  );

  expect(afterAmount.gt(beforeAmount)).to.be.true;
}

async function getDammV2SwapIx(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey
) {
  const program = createCpAmmProgram();
  const poolAccount = svm.getAccount(pool);

  const poolState: Pool = program.coder.accounts.decode(
    "pool",
    Buffer.from(poolAccount.data)
  );

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

async function buildZapOutJupV6UsingDammV2SharedRouteInstruction(
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
      pubkey: getAssociatedTokenAddressSync(outputMint, treasuryAddress),
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

async function buildZapOutJupV6UsingDammV2RouteInstruction(
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
      pubkey: getAssociatedTokenAddressSync(outputMint, treasuryAddress),
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

async function buildZapOutDammV2Instruction(
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
