import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
    expectThrowsAsync,
    generateKpAndFund,
    getCpAmmProgramErrorCodeHexString,
    startTest,
    warpSlotBy
} from "./bankrun-utils/common";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
    InitializeCustomizablePoolParams,
    initializeCustomizablePool,
    MIN_LP_AMOUNT,
    MAX_SQRT_PRICE,
    MIN_SQRT_PRICE,
    mintSplTokenTo,
    createToken,
    updatePoolFeesParameters,
    getDynamicFeeParams,
    getFeeShedulerParams,
    encodePermissions,
    createOperator,
    OperatorPermission,
    DynamicFee,
    getDefaultDynamicFee,
    getPool,
    createCpAmmProgram,
    swapExactIn,
    SwapParams,
} from "./bankrun-utils";
import BN from "bn.js";
import { BaseFeeMode, decodeFeeMarketCapSchedulerParams, decodeFeeRateLimiterParams, decodeFeeTimeSchedulerParams, encodeFeeMarketCapSchedulerParams, encodeFeeRateLimiterParams, encodeFeeTimeSchedulerParams } from "./bankrun-utils/feeCodec";
import { expect } from "chai";

describe("Admin update pool fees parameters", () => {
    let context: ProgramTestContext;
    let creator: Keypair;
    let admin: Keypair;
    let whitelistedOperator: Keypair;
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let program: any

    beforeEach(async () => {
        const root = Keypair.generate();
        context = await startTest(root);
        creator = await generateKpAndFund(context.banksClient, context.payer);
        admin = await generateKpAndFund(context.banksClient, context.payer);
        whitelistedOperator = await generateKpAndFund(context.banksClient, context.payer);
        program = createCpAmmProgram();

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
            creator.publicKey
        );

        await mintSplTokenTo(
            context.banksClient,
            context.payer,
            tokenBMint,
            context.payer,
            creator.publicKey
        );

        let permission = encodePermissions([OperatorPermission.UpdatePoolFees])

        await createOperator(context.banksClient, {
            admin,
            whitelistAddress: whitelistedOperator.publicKey,
            permission
        })
    });

    it("disable dynamic fee ", async () => {
        const cliffFeeNumerator = new BN(2_500_000);
        const numberOfPeriod = new BN(0);
        const periodFrequency = new BN(0);
        const reductionFactor = new BN(0);

        const poolFeesData = encodeFeeTimeSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod.toNumber(),
            BigInt(periodFrequency.toString()),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeTimeSchedulerLinear
        );
        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, poolFeesData, getDynamicFeeParams(new BN(2_500_000)))
        // do swap
        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator: null, dynamicFee: getDefaultDynamicFee() })

        await swapExactIn(context.banksClient, swapParams);

        const poolState = await getPool(context.banksClient, poolAddress);

        const dynamicFeeStruct = poolState.poolFees.dynamicFee;
        expect(dynamicFeeStruct.initialized).eq(0)
        expect(dynamicFeeStruct.maxVolatilityAccumulator).eq(0)
        expect(dynamicFeeStruct.variableFeeControl).eq(0)
        expect(dynamicFeeStruct.binStep).eq(0)
        expect(dynamicFeeStruct.filterPeriod).eq(0)
        expect(dynamicFeeStruct.decayPeriod).eq(0)
        expect(dynamicFeeStruct.reductionFactor).eq(0)
        expect(dynamicFeeStruct.lastUpdateTimestamp.toNumber()).eq(0)
        expect(dynamicFeeStruct.binStepU128.toNumber()).eq(0)
        expect(dynamicFeeStruct.sqrtPriceReference.toNumber()).eq(0)
        expect(dynamicFeeStruct.volatilityAccumulator.toNumber()).eq(0)
        expect(dynamicFeeStruct.volatilityReference.toNumber()).eq(0)

    });

    it("enable dynamic fee ", async () => {

        const cliffFeeNumerator = new BN(2_500_000);
        const numberOfPeriod = new BN(0);
        const periodFrequency = new BN(0);
        const reductionFactor = new BN(0);

        const poolFeesData = encodeFeeTimeSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod.toNumber(),
            BigInt(periodFrequency.toString()),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeTimeSchedulerLinear
        );
        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, poolFeesData, null);

        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        const dynamicFee = getDynamicFeeParams(new BN(2_500_000));
        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator: null, dynamicFee })

        await swapExactIn(context.banksClient, swapParams);

        let poolState = await getPool(context.banksClient, poolAddress);

        const dynamicFeeStruct = poolState.poolFees.dynamicFee;
        expect(dynamicFeeStruct.initialized).eq(1)
        expect(dynamicFeeStruct.maxVolatilityAccumulator).eq(dynamicFee.maxVolatilityAccumulator)
        expect(dynamicFeeStruct.variableFeeControl).eq(dynamicFee.variableFeeControl)
        expect(dynamicFeeStruct.binStep).eq(dynamicFee.binStep)
        expect(dynamicFeeStruct.filterPeriod).eq(dynamicFee.filterPeriod)
        expect(dynamicFeeStruct.decayPeriod).eq(dynamicFee.decayPeriod)
        expect(dynamicFeeStruct.reductionFactor).eq(dynamicFee.reductionFactor)
        expect(dynamicFeeStruct.binStepU128.toString()).eq(dynamicFee.binStepU128.toString())
    });

    it("update new dynamic fee parameters", async () => {

        const cliffFeeNumerator = new BN(2_500_000);
        const numberOfPeriod = new BN(0);
        const periodFrequency = new BN(0);
        const reductionFactor = new BN(0);

        const poolFeesData = encodeFeeTimeSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod.toNumber(),
            BigInt(periodFrequency.toString()),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeTimeSchedulerLinear
        );
        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, poolFeesData, getDynamicFeeParams(new BN(2_500_000)))
        const newDynamicFeeParams = getDynamicFeeParams(new BN(5_000_000))
        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator: null, dynamicFee: newDynamicFeeParams })



        const poolState = await getPool(context.banksClient, poolAddress);

        const dynamicFeeStruct = poolState.poolFees.dynamicFee;
        expect(dynamicFeeStruct.initialized).eq(1)
        expect(dynamicFeeStruct.maxVolatilityAccumulator).eq(newDynamicFeeParams.maxVolatilityAccumulator)
        expect(dynamicFeeStruct.variableFeeControl).eq(newDynamicFeeParams.variableFeeControl)
        expect(dynamicFeeStruct.binStep).eq(newDynamicFeeParams.binStep)
        expect(dynamicFeeStruct.filterPeriod).eq(newDynamicFeeParams.filterPeriod)
        expect(dynamicFeeStruct.decayPeriod).eq(newDynamicFeeParams.decayPeriod)
        expect(dynamicFeeStruct.reductionFactor).eq(newDynamicFeeParams.reductionFactor)
        expect(dynamicFeeStruct.binStepU128.toString()).eq(newDynamicFeeParams.binStepU128.toString())
        expect(dynamicFeeStruct.lastUpdateTimestamp.toNumber()).eq(0)
        expect(dynamicFeeStruct.sqrtPriceReference.toNumber()).eq(0)
        expect(dynamicFeeStruct.volatilityAccumulator.toNumber()).eq(0)
        expect(dynamicFeeStruct.volatilityReference.toNumber()).eq(0)

        // can swap after update 
        await swapExactIn(context.banksClient, swapParams);

    });

    it("update pool fees for pool with linear fee scheduler", async () => {
        const feeTimeSchedulerParams = getFeeShedulerParams(new BN(10_000_000), new BN(2_500_000), BaseFeeMode.FeeTimeSchedulerLinear, 10, 1000)
        const poolFeesData = encodeFeeTimeSchedulerParams(
            BigInt(feeTimeSchedulerParams.cliffFeeNumerator.toString()),
            feeTimeSchedulerParams.numberOfPeriod,
            BigInt(feeTimeSchedulerParams.periodFrequency.toString()),
            BigInt(feeTimeSchedulerParams.reductionFactor.toString()),
            feeTimeSchedulerParams.baseFeeMode
        );
        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, poolFeesData, null)

        // update new cliff fee numerator
        const cliffFeeNumerator = new BN(8_000_000)

        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        const errorCode = getCpAmmProgramErrorCodeHexString(
            "CannotUpdateBaseFee"
        );
        await expectThrowsAsync(async () => {
            await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })
        }, errorCode);

        await warpSlotBy(context, new BN(10000))

        let poolState = await getPool(context.banksClient, poolAddress)

        const beforeBaseFee = decodeFeeTimeSchedulerParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })

        await swapExactIn(context.banksClient, swapParams);
        poolState = await getPool(context.banksClient, poolAddress)

        const postBaseFee = decodeFeeTimeSchedulerParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        expect(postBaseFee.cliffFeeNumerator.toString()).eq(cliffFeeNumerator.toString())
        expect(postBaseFee.numberOfPeriod).eq(beforeBaseFee.numberOfPeriod)
        expect(postBaseFee.periodFrequency.toString()).eq(beforeBaseFee.periodFrequency.toString())
        expect(postBaseFee.reductionFactor.toString()).eq(beforeBaseFee.reductionFactor.toString())

    });

    it("update pool fees for pool with exponential fee scheduler", async () => {

        const feeSchedulerParams = getFeeShedulerParams(new BN(10_000_000), new BN(2_500_000), BaseFeeMode.FeeTimeSchedulerExponential, 10, 1000)

        const poolFeesData = encodeFeeTimeSchedulerParams(
            BigInt(feeSchedulerParams.cliffFeeNumerator.toString()),
            feeSchedulerParams.numberOfPeriod,
            BigInt(feeSchedulerParams.periodFrequency.toString()),
            BigInt(feeSchedulerParams.reductionFactor.toString()),
            BaseFeeMode.FeeTimeSchedulerExponential
        );

        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, poolFeesData, null)

        // update new cliff fee numerator
        const cliffFeeNumerator = new BN(5_000_000)
        const errorCode = getCpAmmProgramErrorCodeHexString(
            "CannotUpdateBaseFee"
        );
        await expectThrowsAsync(async () => {
            await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })
        }, errorCode);

        await warpSlotBy(context, new BN(10000))

        let poolState = await getPool(context.banksClient, poolAddress)

        const beforeBaseFee = decodeFeeTimeSchedulerParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })

        await swapExactIn(context.banksClient, swapParams);

        poolState = await getPool(context.banksClient, poolAddress)

        const postBaseFee = decodeFeeTimeSchedulerParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        expect(postBaseFee.cliffFeeNumerator.toString()).eq(cliffFeeNumerator.toString())
        expect(postBaseFee.numberOfPeriod).eq(beforeBaseFee.numberOfPeriod)
        expect(postBaseFee.periodFrequency.toString()).eq(beforeBaseFee.periodFrequency.toString())
        expect(postBaseFee.reductionFactor.toString()).eq(beforeBaseFee.reductionFactor.toString())

    });

    it("update pool fees for pool with rate limiter", async () => {
        let referenceAmount = new BN(LAMPORTS_PER_SOL); // 1 SOL
        let maxRateLimiterDuration = new BN(10);
        let maxFeeBps = new BN(5000);

        const baseFeeData = encodeFeeRateLimiterParams(
            BigInt(10_000_000),
            10, // feeIncrementBps,
            maxRateLimiterDuration.toNumber(),
            maxFeeBps.toNumber(),
            BigInt(referenceAmount.toString())
        );

        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, baseFeeData, null)

        // update new cliff fee numerator
        const cliffFeeNumerator = new BN(5_000_000)


        const errorCode = getCpAmmProgramErrorCodeHexString(
            "CannotUpdateBaseFee"
        );
        await expectThrowsAsync(async () => {
            await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })
        }, errorCode);

        await warpSlotBy(context, maxRateLimiterDuration.addn(1))

        let poolState = await getPool(context.banksClient, poolAddress)

        const beforeBaseFee = decodeFeeRateLimiterParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })

        await swapExactIn(context.banksClient, swapParams);

        poolState = await getPool(context.banksClient, poolAddress)

        const postBaseFee = decodeFeeRateLimiterParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        expect(postBaseFee.cliffFeeNumerator.toString()).eq(cliffFeeNumerator.toString())
        expect(postBaseFee.feeIncrementBps).eq(beforeBaseFee.feeIncrementBps)
        expect(postBaseFee.maxFeeBps).eq(beforeBaseFee.maxFeeBps)
        expect(postBaseFee.maxLimiterDuration).eq(beforeBaseFee.maxLimiterDuration)
        expect(postBaseFee.referenceAmount.toString()).eq(beforeBaseFee.referenceAmount.toString())
    });

    it("update pool fees for pool with fee market cap scheduler linear", async () => {
        let cliffFeeNumerator = new BN(100_000_000); // 10%
        const numberOfPeriod = 100;
        const priceStepBps = 10;
        const reductionFactor = new BN(10);
        const schedulerExpirationDuration = new BN(3600);
        const baseFeeData = encodeFeeMarketCapSchedulerParams(
            BigInt(cliffFeeNumerator.toString()),
            numberOfPeriod,
            priceStepBps,
            schedulerExpirationDuration.toNumber(),
            BigInt(reductionFactor.toString()),
            BaseFeeMode.FeeMarketCapSchedulerLinear
        );

        const poolAddress = await createPool(context.banksClient, creator, tokenAMint, tokenBMint, baseFeeData, null)

        // update new cliff fee numerator
        cliffFeeNumerator = new BN(5_000_000)
        const dynamicFeeParams = getDynamicFeeParams(cliffFeeNumerator)


        const errorCode = getCpAmmProgramErrorCodeHexString(
            "CannotUpdateBaseFee"
        );
        await expectThrowsAsync(async () => {
            await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: dynamicFeeParams })
        }, errorCode);

        await warpSlotBy(context, schedulerExpirationDuration.addn(1))

        let poolState = await getPool(context.banksClient, poolAddress)

        const beforeBaseFee = decodeFeeMarketCapSchedulerParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        const swapParams: SwapParams = {
            payer: creator,
            pool: poolAddress,
            inputTokenMint: tokenAMint,
            outputTokenMint: tokenBMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swapExactIn(context.banksClient, swapParams);

        await updatePoolFeesParameters(context.banksClient, { whitelistedOperator, pool: poolAddress, cliffFeeNumerator, dynamicFee: null })

        await swapExactIn(context.banksClient, swapParams);

        poolState = await getPool(context.banksClient, poolAddress)

        const postBaseFee = decodeFeeMarketCapSchedulerParams(Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data))

        expect(postBaseFee.cliffFeeNumerator.toString()).eq(cliffFeeNumerator.toString())
        expect(postBaseFee.numberOfPeriod).eq(beforeBaseFee.numberOfPeriod)
        expect(postBaseFee.priceStepBps).eq(beforeBaseFee.priceStepBps)
        expect(postBaseFee.schedulerExpirationDuration).eq(beforeBaseFee.schedulerExpirationDuration)
        expect(postBaseFee.reductionFactor.toString()).eq(beforeBaseFee.reductionFactor.toString())
    });
});

async function createPool(banksClient: BanksClient, creator: Keypair, tokenAMint: PublicKey, tokenBMint: PublicKey, baseFeeData: Buffer, dynamicFee: DynamicFee | null) {
    const params: InitializeCustomizablePoolParams = {
        payer: creator,
        creator: creator.publicKey,
        tokenAMint,
        tokenBMint,
        liquidity: MIN_LP_AMOUNT,
        sqrtPrice: MIN_SQRT_PRICE.muln(2),
        sqrtMinPrice: MIN_SQRT_PRICE,
        sqrtMaxPrice: MAX_SQRT_PRICE,
        hasAlphaVault: false,
        activationPoint: null,
        poolFees: {
            baseFee: {
                data: Array.from(baseFeeData)
            },
            padding: [],
            dynamicFee
        },
        activationType: 0,
        collectFeeMode: 1,
    };

    const { pool } = await initializeCustomizablePool(banksClient, params);

    return pool;
}
