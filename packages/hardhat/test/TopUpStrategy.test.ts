import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import { MockGasTank, NocturneVault, TopUpStrategy } from "../typechain-types";

/**
 * The worked example in docs/writing-a-strategy.md, held to what the page says
 * about it. If the docs and this file ever disagree, this file is the one CI
 * checks.
 */
describe("TopUpStrategy (the docs example)", () => {
  const FLOOR = 100n;
  const TARGET = 500n;

  async function deployFixture() {
    const [owner, user] = await ethers.getSigners();
    const hss = await installMockScheduleService();

    const tank = (await (await ethers.getContractFactory("MockGasTank")).deploy()) as MockGasTank;
    const strategy = (await (await ethers.getContractFactory("TopUpStrategy")).deploy()) as TopUpStrategy;
    const vault = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;
    for (const c of [tank, strategy, vault]) await c.waitForDeployment();

    await owner.sendTransaction({ to: await vault.getAddress(), value: 100_000_000n * 50n });
    const config = await strategy.encodeConfig(await tank.getAddress(), user.address, FLOOR, TARGET);

    return { tank, strategy, vault, hss, user, config };
  }

  it("declines while the balance is healthy", async () => {
    const { tank, strategy, user, config } = await loadFixture(deployFixture);
    await tank.setBalance(user.address, 200n);

    expect(await strategy.plan(config)).to.have.length(0);
    expect(await strategy.nextInterval(config)).to.equal(6n * 60n * 60n);
  });

  it("tightens the interval as the balance falls", async () => {
    const { tank, strategy, user, config } = await loadFixture(deployFixture);

    await tank.setBalance(user.address, 120n);
    expect(await strategy.nextInterval(config)).to.equal(60n * 60n);

    await tank.setBalance(user.address, 40n);
    expect(await strategy.nextInterval(config)).to.equal(5n * 60n);
  });

  it("tops the tank up through a vault, with nobody sending the run", async () => {
    const { tank, vault, hss, user, config } = await loadFixture(deployFixture);
    await tank.setBalance(user.address, 40n);

    await vault.setAllowedCall(await tank.getAddress(), tank.interface.getFunction("topUp")!.selector, true);
    await vault.configure(config);
    await vault.arm();

    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await expect(hss.fireLatest()).to.emit(vault, "Executed");

    expect(await tank.balanceOf(user.address)).to.equal(TARGET);
  });
});
