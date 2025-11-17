import BN from "bn.js";
import { FEE_DENOMINATOR } from "./constants";
function toNumerator(bps: BN, denominator: BN): BN {
    return bps.mul(denominator).div(new BN(10000));
}

function getMaxIndex(
    cliffFeeNumerator: BN,
    feeIncrementBps: number,
    maxFeeBps: number
): BN {
    const maxFeeNumerator = toNumerator(new BN(maxFeeBps), new BN(FEE_DENOMINATOR));
    const deltaNumerator = maxFeeNumerator.sub(cliffFeeNumerator);
    const feeIncrementNumerator = toNumerator(
        new BN(feeIncrementBps),
        new BN(FEE_DENOMINATOR)
    );
    return deltaNumerator.div(feeIncrementNumerator);
}

export function getRateLimiterFeeNumeratorFromIncludedFeeAmount(
    cliffFeeNumerator: BN,
    feeIncrementBps: number,
    maxFeeBps: number,
    referenceAmount: BN,
    inputAmount: BN
): BN {
    if (inputAmount.lte(referenceAmount)) {
        return cliffFeeNumerator;
    }

    const maxFeeNumerator = toNumerator(new BN(maxFeeBps), new BN(FEE_DENOMINATOR));
    const c = cliffFeeNumerator;
    const x0 = referenceAmount;
    const maxIndex = getMaxIndex(cliffFeeNumerator,
        feeIncrementBps,
        maxFeeBps);
    const i = toNumerator(new BN(feeIncrementBps), new BN(FEE_DENOMINATOR));

    // Calculate a and b where: inputAmount = x0 + (a * x0 + b)
    const remaining = inputAmount.sub(referenceAmount);
    const a = remaining.div(referenceAmount);
    const b = remaining.mod(referenceAmount);

    let tradingFeeNumerator: BN;

    if (a.lt(maxIndex)) {
        // fee = x0 * (c + c*a + i*a*(a+1)/2) + b * (c + i*(a+1))
        const aPlusOne = a.add(new BN(1));

        // First part: x0 * (c + c*a + i*a*(a+1)/2)
        const numerator1 = c
            .add(c.mul(a))
            .add(i.mul(a).mul(aPlusOne).div(new BN(2)));
        const firstFee = x0.mul(numerator1);

        // Second part: b * (c + i*(a+1))
        const numerator2 = c.add(i.mul(aPlusOne));
        const secondFee = b.mul(numerator2);

        tradingFeeNumerator = firstFee.add(secondFee);
    } else {
        // fee = x0 * (c + c*max_index + i*max_index*(max_index+1)/2) + (d*x0 + b) * max_fee_numerator
        const maxIndexPlusOne = maxIndex.add(new BN(1));

        // First part: x0 * (c + c*max_index + i*max_index*(max_index+1)/2)
        const numerator1 = c
            .add(c.mul(maxIndex))
            .add(i.mul(maxIndex).mul(maxIndexPlusOne).div(new BN(2)));
        const firstFee = x0.mul(numerator1);

        // Second part: (d*x0 + b) * max_fee_numerator
        const d = a.sub(maxIndex);
        const leftAmount = d.mul(x0).add(b);
        const secondFee = leftAmount.mul(maxFeeNumerator);

        tradingFeeNumerator = firstFee.add(secondFee);
    }

    // (numerator + denominator - 1) / denominator
    const tradingFee = tradingFeeNumerator
        .add(new BN(FEE_DENOMINATOR))
        .sub(new BN(1))
        .div(new BN(FEE_DENOMINATOR));

    const feeNumerator = tradingFee
        .mul(new BN(FEE_DENOMINATOR))
        .add(inputAmount)
        .sub(new BN(1))
        .div(inputAmount);

    return feeNumerator;
}