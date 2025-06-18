import { expect } from "chai";
import { convertToByteArray } from "./bankrun-utils/common";
import { createCpAmmProgram } from "./bankrun-utils";
import BN from "bn.js";
import fs from "fs"

describe("Account Layout backward compatible", () => {
  it("Config account", async () => {
    const program = createCpAmmProgram();

    const accountData = fs.readFileSync("./programs/cp-amm/src/tests/fixtures/config_account.bin");
    // https://solscan.io/account/TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq#anchorData
    const periodFrequency = 60;
    const configState = program.coder.accounts.decode(
      "config",
      Buffer.from(accountData)
    );
    const secondFactorByNewLayout = configState.poolFees.baseFee.secondFactor;
    // validate convert from le bytes array to number
    const valueFromBytesArray = new BN(
      Buffer.from(secondFactorByNewLayout).reverse() // reverse() because BN constructor use Big-Endian bytes.
    ).toNumber();
    expect(valueFromBytesArray).eq(periodFrequency);

    const periodFrequencyInbyte = convertToByteArray(new BN(periodFrequency));
    expect(secondFactorByNewLayout.length).eq(periodFrequencyInbyte.length);

    for (let i = 0; i < secondFactorByNewLayout.length; i++) {
      expect(periodFrequencyInbyte[i]).eq(secondFactorByNewLayout[i]);
    }
  });

  it("Pool account", async () => {
    const program = createCpAmmProgram();

    const accountData = fs.readFileSync("./programs/cp-amm/src/tests/fixtures/pool_account.bin");
    // https://solscan.io/account/E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7#anchorData
    const periodFrequency = 60;
    const poolState = program.coder.accounts.decode(
      "pool",
      Buffer.from(accountData)
    );
    const secondFactorByNewLayout = poolState.poolFees.baseFee.secondFactor;
    // validate convert from le bytes array to number
    const valueFromBytesArray = new BN(
      Buffer.from(secondFactorByNewLayout).reverse() // reverse because BN constructor use Big-Endian bytes.
    ).toNumber();
    expect(valueFromBytesArray).eq(periodFrequency);

    const periodFrequencyInbyte = convertToByteArray(new BN(periodFrequency));
    expect(secondFactorByNewLayout.length).eq(periodFrequencyInbyte.length);

    for (let i = 0; i < secondFactorByNewLayout.length; i++) {
      expect(periodFrequencyInbyte[i]).eq(secondFactorByNewLayout[i]);
    }
  });
});
