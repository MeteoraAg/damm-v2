import { AccountInfoBytes, BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  convertToByteArray,
  generateKpAndFund,
  startTest,
} from "./bankrun-utils/common";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  addLiquidity,
  AddLiquidityParams,
  claimPositionFee,
  createConfigIx,
  CreateConfigParams,
  initializePool,
  InitializePoolParams,
  MIN_LP_AMOUNT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  swapExactIn,
  SwapParams,
  createToken,
  mintSplTokenTo,
  createWhitelistProtocolFeeReceiver,
  approveWhitelistProtocolFeeReceiver,
} from "./bankrun-utils";
import BN from "bn.js";
import fs from "fs";

describe.skip("Whitelist protocol fee receiver", () => {
  let context: ProgramTestContext;
  
  let user: Keypair;
  let creator: Keypair;
  let protocolFeeReceiver: Keypair;
  let config: PublicKey;
  let pool: PublicKey;
  let position: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  const configId = Math.floor(Math.random() * 1000);

  const res = fs.readFileSync(
  process.cwd() +
    "/keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf8"
);

 const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(res)));

  before(async () => {
    const root = Keypair.generate();
    context = await startTest(root);

    user = await generateKpAndFund(context.banksClient, context.payer);
    creator = await generateKpAndFund(context.banksClient, context.payer);
    protocolFeeReceiver = await generateKpAndFund(context.banksClient, context.payer);

    tokenAMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );
    tokenBMint = await createToken(
      context.banksClient,
      context.payer,
      context.payer.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenBMint,
      context.payer,
      user.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenAMint,
      context.payer,
      creator.publicKey
    );

    await mintSplTokenTo(
      context.banksClient,
      context.payer,
      tokenBMint,
      context.payer,
      creator.publicKey
    );

    // create config
    const createConfigParams: CreateConfigParams = {
      poolFees: {
        baseFee: {
          cliffFeeNumerator: new BN(10_000_000),
          firstFactor: 0,
          secondFactor: convertToByteArray(new BN(0)),
          thirdFactor: new BN(0),
          baseFeeMode: 0,
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

    config = await createConfigIx(
      context.banksClient,
      admin,
      new BN(configId),
      createConfigParams
    );

    const initPoolParams: InitializePoolParams = {
      payer: creator,
      creator: creator.publicKey,
      config,
      tokenAMint,
      tokenBMint,
      liquidity: new BN(MIN_LP_AMOUNT),
      sqrtPrice: new BN(MIN_SQRT_PRICE.muln(2)),
      activationPoint: null,
    };

    const result = await initializePool(context.banksClient, initPoolParams);
    pool = result.pool;
  });

  it("Whitelist protocol fee receiver", async()=>{
    await createWhitelistProtocolFeeReceiver(context.banksClient, {
        admin,
        protocolFeeReceiver: protocolFeeReceiver.publicKey
    })
  })

  it("Approve whitelist protocol fee receiver", async ()=>{
    await approveWhitelistProtocolFeeReceiver(context.banksClient, {
        admin,
        protocolFeeReceiver: protocolFeeReceiver.publicKey
    })

  })

  it.skip("User claim position fee", async () => {
    const addLiquidityParams: AddLiquidityParams = {
      owner: user,
      pool,
      position,
      liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
      tokenAAmountThreshold: new BN(200),
      tokenBAmountThreshold: new BN(200),
    };
    await addLiquidity(context.banksClient, addLiquidityParams);

    const swapParams: SwapParams = {
      payer: user,
      pool,
      inputTokenMint: tokenAMint,
      outputTokenMint: tokenBMint,
      amountIn: new BN(10),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    };

    await swapExactIn(context.banksClient, swapParams);

    // claim position fee
    const claimParams = {
      owner: user,
      pool,
      position,
    };
    await claimPositionFee(context.banksClient, claimParams);
  });
});
