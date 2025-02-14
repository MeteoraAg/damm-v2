import { BN } from "@coral-xyz/anchor";

export function shlDiv(x: BN, y: BN, offset: number) {
    return x.shln(offset).div(y);
}

