import { expect } from "chai";
import { createCpAmmProgram } from "./helpers";
import BN from "bn.js";
import fs from "fs";

import { CpAmm } from "../target/types/cp_amm";
import { IdlAccounts } from "@coral-xyz/anchor";
import { decodePodAlignedFeeTimeScheduler } from "./helpers/feeCodec";
type ConfigAccount = IdlAccounts<CpAmm>["config"];
type PoolAccount = IdlAccounts<CpAmm>["pool"];

describe("Account Layout backward compatible", () => {
  it("Config account", async () => {
    const program = createCpAmmProgram();

    const accountData = fs.readFileSync(
      "./programs/cp-amm/src/tests/fixtures/config_account.bin"
    );
    // https://solscan.io/account/TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq#anchorData
    const periodFrequency = 60;
    const cliffFeeNumerator = new BN(500_000_000);
    const numberOfPeriod = 120;
    const reductionFactor = 417;

    const configState: ConfigAccount = program.coder.accounts.decode(
      "config",
      Buffer.from(accountData)
    );

    const feeTimeScheduler = decodePodAlignedFeeTimeScheduler(
      Buffer.from(configState.poolFees.baseFee.data)
    );

    const onChainPeriodFrequency = feeTimeScheduler.periodFrequency.toNumber();
    expect(onChainPeriodFrequency).eq(periodFrequency);

    const onChainCliffFeeNumerator =
      feeTimeScheduler.cliffFeeNumerator.toString();
    expect(onChainCliffFeeNumerator).eq(cliffFeeNumerator.toString());

    const onChainNumberOfPeriod = feeTimeScheduler.numberOfPeriod;
    expect(onChainNumberOfPeriod).eq(numberOfPeriod);

    const onChainReductionFactor = feeTimeScheduler.reductionFactor.toNumber();
    expect(onChainReductionFactor).eq(reductionFactor);
  });

  it("Pool account", async () => {
    const program = createCpAmmProgram();
    const accountData = fs.readFileSync(
      "./programs/cp-amm/src/tests/fixtures/pool_account.bin"
    );
    // https://solscan.io/account/E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7#anchorData
    const cliffFeeNumerator = new BN(500_000_000);
    const periodFrequency = 60;
    const numberOfPeriod = 120;
    const reductionFactor = 265;

    const poolState: PoolAccount = program.coder.accounts.decode(
      "pool",
      Buffer.from(accountData)
    );

    const feeTimeScheduler = decodePodAlignedFeeTimeScheduler(
      Buffer.from(poolState.poolFees.baseFee.baseFeeInfo.data)
    );

    const onChainPeriodFrequency = feeTimeScheduler.periodFrequency.toNumber();
    expect(onChainPeriodFrequency).eq(periodFrequency);

    const onChainCliffFeeNumerator =
      feeTimeScheduler.cliffFeeNumerator.toString();
    expect(onChainCliffFeeNumerator).eq(cliffFeeNumerator.toString());

    const onChainNumberOfPeriod = feeTimeScheduler.numberOfPeriod;
    expect(onChainNumberOfPeriod).eq(numberOfPeriod);

    const onChainReductionFactor = feeTimeScheduler.reductionFactor.toNumber();
    expect(onChainReductionFactor).eq(reductionFactor);
  });
});
