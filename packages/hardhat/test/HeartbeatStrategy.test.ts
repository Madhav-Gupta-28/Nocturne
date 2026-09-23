import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import { Heartbeat, HeartbeatStrategy, NocturneVault } from "../typechain-types";

/**
 * The simplest strategy there is, and the one that produces the evidence: a
 * counter that moves with no transaction from the owner behind it.
 */
describe("HeartbeatStrategy", () => {
  const ONE_HBAR = 100_000_000n;
  const INTERVAL = 3600n;

  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const hss = await installMockScheduleService();

    const heartbeat = (await (await ethers.getContractFactory("Heartbeat")).deploy()) as Heartbeat;
    await heartbeat.waitForDeployment();

    const strategy = (await (await ethers.getContractFactory("HeartbeatStrategy")).deploy()) as HeartbeatStrategy;
    await strategy.waitForDeployment();

    const vault = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;
    await vault.waitForDeployment();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ONE_HBAR * 160n });

    const config = await strategy.encodeConfig(await heartbeat.getAddress(), INTERVAL);
    await vault.setAllowedTarget(await heartbeat.getAddress(), true);
    await vault.configure(config);

    return { vault, strategy, heartbeat, hss, owner, config };
  }

  it("rejects a configuration that could never work", async () => {
    const { strategy, heartbeat } = await loadFixture(deployFixture);

    expect(await strategy.validateConfig(await strategy.encodeConfig(ethers.ZeroAddress, INTERVAL))).to.equal(false);
    expect(await strategy.validateConfig(await strategy.encodeConfig(await heartbeat.getAddress(), 0n))).to.equal(
      false,
    );
    expect(await strategy.validateConfig(await strategy.encodeConfig(await heartbeat.getAddress(), INTERVAL))).to.equal(
      true,
    );
  });

  it("plans exactly one call, to the configured heartbeat", async () => {
    const { strategy, heartbeat, config } = await loadFixture(deployFixture);

    const actions = await strategy.plan(config);
    expect(actions.length).to.equal(1);
    expect(actions[0].target).to.equal(await heartbeat.getAddress());
    expect(actions[0].value).to.equal(0n);
    expect(actions[0].data).to.equal(heartbeat.interface.encodeFunctionData("beat"));
  });

  it("asks for the interval it was configured with", async () => {
    const { strategy, config } = await loadFixture(deployFixture);
    expect(await strategy.nextInterval(config)).to.equal(INTERVAL);
  });

  it("beats five times without the owner sending anything", async () => {
    // The whole claim, in one test. After arm() the owner sends nothing more;
    // every increment below comes from the scheduler firing the vault.
    const { vault, heartbeat, hss } = await loadFixture(deployFixture);
    await vault.arm();

    for (let i = 0; i < 5; i++) {
      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await hss.fireLatest();
    }

    expect(await heartbeat.beats()).to.equal(5n);
    expect(await vault.runCount()).to.equal(5n);
    expect(await vault.refusalCount()).to.equal(0n);
    // The beats came from the vault, not from an account.
    expect(await heartbeat.lastBeatBy()).to.equal(await vault.getAddress());
    // And it is still going.
    expect(await hss.pendingCount()).to.equal(1n);
  });

  it("explains itself using live state", async () => {
    const { vault, heartbeat, hss } = await loadFixture(deployFixture);
    await vault.arm();
    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await hss.fireLatest();

    const [state, beats, interval] = await vault.preview();
    expect(state).to.equal("beating");
    expect(beats).to.equal(await heartbeat.beats());
    expect(interval).to.equal(INTERVAL);
  });

  it("reports how long it has been silent", async () => {
    const { vault, heartbeat, hss } = await loadFixture(deployFixture);
    expect(await heartbeat.silenceFor()).to.equal(0n);

    await vault.arm();
    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await hss.fireLatest();

    await time.increase(120);
    expect(await heartbeat.silenceFor()).to.be.greaterThanOrEqual(120n);
  });
});
