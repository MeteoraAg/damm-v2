import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { ProgramTestContext } from "solana-bankrun";
import {
    CreateConfigParams,
    FEE_DENOMINATOR,
    InitializePoolParams,
    MAX_SQRT_PRICE,
    MIN_LP_AMOUNT,
    MIN_SQRT_PRICE,
    OperatorPermission,
    createConfigIx,
    createOperator,
    createToken,
    encodePermissions,
    getFeeShedulerParams,
    getPool,
    initializePool,
    mintSplTokenTo,
    swapExactIn,
} from "./bankrun-utils";
import { generateKpAndFund, randomID, startTest } from "./bankrun-utils/common";
import {
    BaseFeeMode,
    encodeFeeMarketCapSchedulerParams,
    encodeFeeRateLimiterParams,
    encodeFeeTimeSchedulerParams,
} from "./bankrun-utils/feeCodec";
import { getRateLimiterFeeNumeratorFromIncludedFeeAmount } from "./bankrun-utils/rateLimiterUtils";

const sqrtPrice = new BN("4880549731789001291");
const numberOfPeriod = 100;
const priceStepBps = 10;
const reductionFactor = new BN(10);
const schedulerExpirationDuration = new BN(3600);

describe("Test max fee 99%", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let operator: Keypair;
    let partner: Keypair;
    let user: Keypair;
    let poolCreator: Keypair;
    let tokenA: PublicKey;
    let tokenB: PublicKey;
    let whitelistedAccount: Keypair;
    let createConfigParams: CreateConfigParams;

    beforeEach(async () => {
        const root = Keypair.generate();
        context = await startTest(root);
        admin = context.payer;
        operator = await generateKpAndFund(context.banksClient, context.payer);
        partner = await generateKpAndFund(context.banksClient, context.payer);
        user = await generateKpAndFund(context.banksClient, context.payer);
        poolCreator = await generateKpAndFund(context.banksClient, context.payer);
        whitelistedAccount = await generateKpAndFund(
            context.banksClient,
            context.payer
        );
        tokenA = await createToken(
            context.banksClient,
            context.payer,
            context.payer.publicKey
        );
        tokenB = await createToken(
            context.banksClient,
            context.payer,
            context.payer.publicKey
        );

        await mintSplTokenTo(
            context.banksClient,
            context.payer,
            tokenA,
            context.payer,
            user.publicKey
        );

        await mintSplTokenTo(
            context.banksClient,
            context.payer,
            tokenB,
            context.payer,
            user.publicKey
        );

        await mintSplTokenTo(
            context.banksClient,
            context.payer,
            tokenA,
            context.payer,
            poolCreator.publicKey
        );

        await mintSplTokenTo(
            context.banksClient,
            context.payer,
            tokenB,
            context.payer,
            poolCreator.publicKey
        );

        let permission = encodePermissions([
            OperatorPermission.CreateConfigKey,
            OperatorPermission.RemoveConfigKey,
        ]);

        await createOperator(context.banksClient, {
            admin,
            whitelistAddress: whitelistedAccount.publicKey,
            permission,
        });

        createConfigParams = {
            poolFees: {
                baseFee: {
                    data: Array.from([]),
                },
                padding: [],
                dynamicFee: null,
            },
            sqrtMinPrice: new BN(MIN_SQRT_PRICE),
            sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
            vaultConfigKey: PublicKey.default,
            poolCreatorAuthority: PublicKey.default,
            activationType: 0,
            collectFeeMode: 1, // onlyB
        };
    });
    it("Max fee 99%", async () => {
        const cliffFeeNumerator = new BN(990_000_000); // 99%
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

        createConfigParams.poolFees.baseFee.data = Array.from(data);

        let config = await createConfigIx(
            context.banksClient,
            whitelistedAccount,
            new BN(randomID()),
            createConfigParams
        );
        const liquidity = new BN(MIN_LP_AMOUNT);

        const initPoolParams: InitializePoolParams = {
            payer: poolCreator,
            creator: poolCreator.publicKey,
            config,
            tokenAMint: tokenA,
            tokenBMint: tokenB,
            liquidity,
            sqrtPrice: MIN_SQRT_PRICE,
            activationPoint: null,
        };
        const { pool } = await initializePool(context.banksClient, initPoolParams);
        let poolState = await getPool(context.banksClient, pool);
        expect(poolState.version.toString()).eq("1");

        // Market cap increase
        const amountIn = new BN(LAMPORTS_PER_SOL);
        await swapExactIn(context.banksClient, {
            payer: poolCreator,
            pool,
            inputTokenMint: tokenB,
            outputTokenMint: tokenA,
            amountIn,
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        });

        poolState = await getPool(context.banksClient, pool);

        let totalTradingFee = poolState.metrics.totalLpBFee.add(
            poolState.metrics.totalProtocolBFee
        );

        const actualFee = amountIn.muln(99).divn(100)

        expect(actualFee.toString()).eq(totalTradingFee.toString())
    });

    it("Fee time linear fee scheduler with max fee 99%", async () => {
        const cliffFeeNumerator = new BN(990_000_000);
        const numberOfPeriod = new BN(180);
        const periodFrequency = new BN(1);
        const reductionFactor = new BN(1_000_000);

        const data = encodeFeeTimeSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod.toNumber(),
            BigInt(periodFrequency.toString()),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeTimeSchedulerLinear
        );

        createConfigParams.poolFees.baseFee.data = Array.from(data);

        let config = await createConfigIx(
            context.banksClient,
            whitelistedAccount,
            new BN(randomID()),
            createConfigParams
        );
        const liquidity = new BN(MIN_LP_AMOUNT);

        const initPoolParams: InitializePoolParams = {
            payer: poolCreator,
            creator: poolCreator.publicKey,
            config,
            tokenAMint: tokenA,
            tokenBMint: tokenB,
            liquidity,
            sqrtPrice: MIN_SQRT_PRICE,
            activationPoint: null,
        };
        const { pool } = await initializePool(context.banksClient, initPoolParams);
        let poolState = await getPool(context.banksClient, pool);
        expect(poolState.version.toString()).eq("1");

        // Market cap increase
        const amountIn = new BN(LAMPORTS_PER_SOL);
        await swapExactIn(context.banksClient, {
            payer: poolCreator,
            pool,
            inputTokenMint: tokenB,
            outputTokenMint: tokenA,
            amountIn,
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        });

        poolState = await getPool(context.banksClient, pool);

        let totalTradingFee = poolState.metrics.totalLpBFee.add(
            poolState.metrics.totalProtocolBFee
        );

        const actualFee = amountIn.muln(99).divn(100)

        expect(actualFee.toString()).eq(totalTradingFee.toString())
    });

    it("Fee time exponential fee scheduler with max fee 99%", async () => {

        const feeSchedulerParams = getFeeShedulerParams(new BN(990_000_000), new BN(2_500_000), BaseFeeMode.FeeTimeSchedulerExponential, 10, 1000)

        const data = encodeFeeTimeSchedulerParams(
            BigInt(feeSchedulerParams.cliffFeeNumerator.toString()),
            feeSchedulerParams.numberOfPeriod,
            BigInt(feeSchedulerParams.periodFrequency.toString()),
            BigInt(feeSchedulerParams.reductionFactor.toString()),
            BaseFeeMode.FeeTimeSchedulerExponential
        );

        createConfigParams.poolFees.baseFee.data = Array.from(data)


        let config = await createConfigIx(
            context.banksClient,
            whitelistedAccount,
            new BN(randomID()),
            createConfigParams
        );
        const liquidity = new BN(MIN_LP_AMOUNT);

        const initPoolParams: InitializePoolParams = {
            payer: poolCreator,
            creator: poolCreator.publicKey,
            config,
            tokenAMint: tokenA,
            tokenBMint: tokenB,
            liquidity,
            sqrtPrice: MIN_SQRT_PRICE,
            activationPoint: null,
        };
        const { pool } = await initializePool(context.banksClient, initPoolParams);
        let poolState = await getPool(context.banksClient, pool);
        expect(poolState.version.toString()).eq("1");

        // Market cap increase
        const amountIn = new BN(LAMPORTS_PER_SOL);
        await swapExactIn(context.banksClient, {
            payer: poolCreator,
            pool,
            inputTokenMint: tokenB,
            outputTokenMint: tokenA,
            amountIn,
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        });

        poolState = await getPool(context.banksClient, pool);

        let totalTradingFee = poolState.metrics.totalLpBFee.add(
            poolState.metrics.totalProtocolBFee
        );

        const actualFee = amountIn.muln(99).divn(100)

        expect(actualFee.toString()).eq(totalTradingFee.toString())
    });

    it("Market cap linear fee scheduler with max fee 99%", async () => {
        const cliffFeeNumerator = new BN(990_000_000); // 10%

        const data = encodeFeeMarketCapSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod,
            priceStepBps,
            schedulerExpirationDuration.toNumber(),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeMarketCapSchedulerLinear
        );

        createConfigParams.poolFees.baseFee.data = Array.from(data)

        let config = await createConfigIx(
            context.banksClient,
            whitelistedAccount,
            new BN(randomID()),
            createConfigParams
        );
        const liquidity = new BN(MIN_LP_AMOUNT);

        const initPoolParams: InitializePoolParams = {
            payer: poolCreator,
            creator: poolCreator.publicKey,
            config,
            tokenAMint: tokenA,
            tokenBMint: tokenB,
            liquidity,
            sqrtPrice,
            activationPoint: null,
        };
        const { pool } = await initializePool(context.banksClient, initPoolParams);
        let poolState = await getPool(context.banksClient, pool);

        expect(poolState.version.toString()).eq("1");

        // Market cap increase
        const amountIn = new BN(LAMPORTS_PER_SOL);
        await swapExactIn(context.banksClient, {
            payer: poolCreator,
            pool,
            inputTokenMint: tokenB,
            outputTokenMint: tokenA,
            amountIn: new BN(LAMPORTS_PER_SOL),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        });

        poolState = await getPool(context.banksClient, pool);

        let totalTradingFee = poolState.metrics.totalLpBFee.add(
            poolState.metrics.totalProtocolBFee
        );

        const actualFee = amountIn.muln(99).divn(100)

        expect(actualFee.toString()).eq(totalTradingFee.toString())
    });

    it("Market cap exponential fee scheduler with max fee 99%", async () => {
        const cliffFeeNumerator = new BN(990_000_000); // 10%

        const data = encodeFeeMarketCapSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod,
            priceStepBps,
            schedulerExpirationDuration.toNumber(),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeMarketCapSchedulerExponential
        );

        createConfigParams.poolFees.baseFee.data = Array.from(data)

        let config = await createConfigIx(
            context.banksClient,
            whitelistedAccount,
            new BN(randomID()),
            createConfigParams
        );
        const liquidity = new BN(MIN_LP_AMOUNT);

        const initPoolParams: InitializePoolParams = {
            payer: poolCreator,
            creator: poolCreator.publicKey,
            config,
            tokenAMint: tokenA,
            tokenBMint: tokenB,
            liquidity,
            sqrtPrice,
            activationPoint: null,
        };
        const { pool } = await initializePool(context.banksClient, initPoolParams);
        let poolState = await getPool(context.banksClient, pool);

        // Market cap increase
        const amountIn = new BN(LAMPORTS_PER_SOL);
        await swapExactIn(context.banksClient, {
            payer: poolCreator,
            pool,
            inputTokenMint: tokenB,
            outputTokenMint: tokenA,
            amountIn: new BN(LAMPORTS_PER_SOL),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        });

        poolState = await getPool(context.banksClient, pool);

        let totalTradingFee = poolState.metrics.totalLpBFee.add(
            poolState.metrics.totalProtocolBFee
        );

        const actualFee = amountIn.muln(99).divn(100)

        expect(actualFee.toString()).eq(totalTradingFee.toString())
    });

    it("Rate limiter with max fee 99%", async () => {
        const referenceAmount = new BN(LAMPORTS_PER_SOL); // 0.1 SOL
        const maxRateLimiterDuration = new BN(10);
        const maxFeeBps = 9900;

        const cliffFeeNumerator = new BN(100_000_000); // 10%
        const feeIncrementBps = 5000;

        const data = encodeFeeRateLimiterParams(
            BigInt(cliffFeeNumerator.toString()),
            feeIncrementBps,
            maxRateLimiterDuration.toNumber(),
            maxFeeBps,
            BigInt(referenceAmount.toString())
        );

        createConfigParams.poolFees.baseFee.data = Array.from(data)

        let config = await createConfigIx(
            context.banksClient,
            whitelistedAccount,
            new BN(randomID()),
            createConfigParams
        );
        const liquidity = new BN(MIN_LP_AMOUNT);
        const sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));

        const initPoolParams: InitializePoolParams = {
            payer: poolCreator,
            creator: poolCreator.publicKey,
            config,
            tokenAMint: tokenA,
            tokenBMint: tokenB,
            liquidity,
            sqrtPrice,
            activationPoint: null,
        };
        const { pool } = await initializePool(context.banksClient, initPoolParams);
        let poolState = await getPool(context.banksClient, pool);

        // swap with 3 SOL
        const amountIn = referenceAmount.muln(3);
        await swapExactIn(context.banksClient, {
            payer: poolCreator,
            pool,
            inputTokenMint: tokenB,
            outputTokenMint: tokenA,
            amountIn,
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        });

        poolState = await getPool(context.banksClient, pool);

        let totalTradingFee = poolState.metrics.totalLpBFee.add(
            poolState.metrics.totalProtocolBFee
        );
        // first 1 SOL: 10%
        // next amount: 60%
        // next amount: 99%
        const feeNumerator = getRateLimiterFeeNumeratorFromIncludedFeeAmount(
            cliffFeeNumerator,
            feeIncrementBps,
            maxFeeBps,
            referenceAmount,
            amountIn
        )

        const actualFee = referenceAmount.muln(3)
            .mul(feeNumerator)
            .add(new BN(FEE_DENOMINATOR))
            .sub(new BN(1))
            .div(new BN(FEE_DENOMINATOR));


        expect(totalTradingFee.toString()).eq(
            actualFee.toString()
        );
    });

});
