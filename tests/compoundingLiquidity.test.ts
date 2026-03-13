import { generateKpAndFund, randomID } from "./helpers/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
    addLiquidity,
    AddLiquidityParams,
    createConfigIx,
    CreateConfigParams,
    createPosition,
    initializePool,
    InitializePoolParams,
    MIN_SQRT_PRICE,
    swapExactIn,
    SwapParams,
    createToken,
    mintSplTokenTo,
    encodePermissions,
    OperatorPermission,
    createOperator,
    startSvm,
    U128_MAX,
    removeAllLiquidity,
    LIQUIDITY_MAX,
} from "./helpers";
import BN from "bn.js";

import { BaseFeeMode, encodeFeeTimeSchedulerParams } from "./helpers/feeCodec";
import { LiteSVM } from "litesvm";

describe("Compounding liquidity", () => {
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
    let inputTokenMint: PublicKey;
    let outputTokenMint: PublicKey;

    beforeEach(async () => {
        svm = startSvm();

        user = generateKpAndFund(svm);
        admin = generateKpAndFund(svm);
        creator = generateKpAndFund(svm);
        whitelistedAccount = generateKpAndFund(svm);

        inputTokenMint = createToken(svm, admin.publicKey);
        outputTokenMint = createToken(svm, admin.publicKey);

        mintSplTokenTo(svm, inputTokenMint, admin, user.publicKey);

        mintSplTokenTo(svm, outputTokenMint, admin, user.publicKey);

        mintSplTokenTo(svm, inputTokenMint, admin, creator.publicKey);

        mintSplTokenTo(svm, outputTokenMint, admin, creator.publicKey);

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

        // create compounding config
        const createConfigParams: CreateConfigParams = {
            poolFees: {
                baseFee: {
                    data: Array.from(data),
                },
                compoundingFeeBps: 5000,
                padding: 0,
                dynamicFee: null,
            },
            sqrtMinPrice: new BN(0),
            sqrtMaxPrice: U128_MAX,
            vaultConfigKey: PublicKey.default,
            poolCreatorAuthority: PublicKey.default,
            activationType: 0,
            collectFeeMode: 2,
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

        liquidity = new BN(LIQUIDITY_MAX);
        sqrtPrice = new BN(MIN_SQRT_PRICE.muln(2));


    });

    it("Full flow", async () => {
        const initPoolParams: InitializePoolParams = {
            payer: creator,
            creator: creator.publicKey,
            config,
            tokenAMint: inputTokenMint,
            tokenBMint: outputTokenMint,
            liquidity,
            sqrtPrice,
            activationPoint: null,
        };

        // create pool
        const result = await initializePool(svm, initPoolParams);
        pool = result.pool;
        position = await createPosition(svm, user, user.publicKey, pool);

        // add more liquidity
        const addLiquidityParams: AddLiquidityParams = {
            owner: user,
            pool,
            position,
            liquidityDelta: new BN(MIN_SQRT_PRICE.muln(30)),
            tokenAAmountThreshold: new BN(200),
            tokenBAmountThreshold: new BN(200),
        };
        await addLiquidity(svm, addLiquidityParams);

        // swap exact in
        const swapParams: SwapParams = {
            payer: user,
            pool,
            inputTokenMint,
            outputTokenMint,
            amountIn: new BN(10),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };

        await swapExactIn(svm, swapParams);

        // remove liquidity
        const removeAllLiquidityParams = {
            owner: user,
            pool,
            position,
            tokenAAmountThreshold: new BN(0),
            tokenBAmountThreshold: new BN(0),
        };
        await removeAllLiquidity(svm, removeAllLiquidityParams);

    });
});
