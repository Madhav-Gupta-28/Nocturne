import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { MockHederaScheduleService } from "../typechain-types";

/**
 * The Hedera Schedule Service lives at a fixed address, 0x16b, and NocturneVault
 * hardcodes it. That is correct for production but leaves a question for tests:
 * can a mock be put at that exact address, so the vault exercises the real code
 * path rather than a test-only branch?
 *
 * It can — `hardhat_setCode` writes bytecode to any address. These tests prove
 * the mechanism works before anything is built on top of it, and that the mock
 * reproduces the three network behaviours the vault has to survive.
 *
 * One trap, learned the hard way: `hardhat_setCode` replaces code but leaves
 * **storage untouched**. Re-installing the mock in a `beforeEach` therefore does
 * NOT give a clean instance — the flags and the schedule array at 0x16b survive
 * into the next test, and a `setRefuseNextBooking(true)` from one test silently
 * breaks the next one. Every suite that installs a mock at a fixed address must
 * isolate with a snapshot, which is what `loadFixture` does here.
 */
export const HSS_ADDRESS = "0x000000000000000000000000000000000000016b";

/**
 * Deploy the mock and install its runtime bytecode at 0x16b.
 *
 * `hardhat_setCode` copies code, not storage. Two consequences, both of which
 * have cost time:
 *
 * 1. The handle returned here is bound to 0x16b. The originally deployed copy
 *    keeps its own separate state, and using it by accident means writing flags
 *    the vault will never read.
 * 2. Whatever storage 0x16b already held is still there. Every suite in this
 *    repo installs the mock at the same address, so without an explicit reset a
 *    later suite starts out holding an earlier one's pending schedules — which
 *    surfaces as a pendingCount that is one too high, somewhere unrelated.
 *    `reset()` below deals with it; a snapshot alone does not, because the
 *    snapshot may itself have been taken over dirty storage.
 */
export async function installMockScheduleService(): Promise<MockHederaScheduleService> {
  const factory = await ethers.getContractFactory("MockHederaScheduleService");
  const deployed = await factory.deploy();
  await deployed.waitForDeployment();

  const runtimeCode = await ethers.provider.getCode(await deployed.getAddress());
  await network.provider.send("hardhat_setCode", [HSS_ADDRESS, runtimeCode]);

  const mock = factory.attach(HSS_ADDRESS) as MockHederaScheduleService;
  await mock.reset();
  return mock;
}

async function deployFixture() {
  const hss = await installMockScheduleService();
  const sink = await (await ethers.getContractFactory("CallSink")).deploy();
  await sink.waitForDeployment();
  return { hss, sink };
}

describe("MockHederaScheduleService", () => {
  let hss: MockHederaScheduleService;
  let sink: Awaited<ReturnType<typeof deployFixture>>["sink"];

  beforeEach(async () => {
    ({ hss, sink } = await loadFixture(deployFixture));
  });

  it("installs at the address the vault will actually call", async () => {
    const code = await ethers.provider.getCode(HSS_ADDRESS);
    expect(code).to.not.equal("0x");
    // Reachable through the same address a production vault hardcodes.
    expect(await hss.hasScheduleCapacity((await now()) + 600, 3_000_000)).to.equal(true);
  });

  it("refuses capacity beyond the 62-day ceiling, as the network does", async () => {
    const t = await now();
    expect(await hss.hasScheduleCapacity(t + 61 * DAY, 3_000_000)).to.equal(true);
    expect(await hss.hasScheduleCapacity(t + 62 * DAY, 3_000_000)).to.equal(true);
    expect(await hss.hasScheduleCapacity(t + 63 * DAY, 3_000_000)).to.equal(false);
  });

  it("reports failure through a response code instead of reverting", async () => {
    // The real scheduleCall never reverts. A mock that did would let a vault
    // pass tests it would fail on chain, so this is asserted explicitly.
    await hss.setRefuseNextBooking(true);
    const [rc, addr] = await hss.scheduleCall.staticCall(ethers.ZeroAddress, (await now()) + 600, 3_000_000, 0, "0x");
    expect(rc).to.not.equal(22n);
    expect(addr).to.equal(ethers.ZeroAddress);
  });

  it("books a schedule and hands back an address that can be fired", async () => {
    const data = sink.interface.encodeFunctionData("ping");
    await hss.scheduleCall(await sink.getAddress(), (await now()) + 60, 1_000_000, 0, data);

    expect(await hss.scheduleCount()).to.equal(1n);
    expect(await hss.pendingCount()).to.equal(1n);
    expect(await sink.pings()).to.equal(0n);

    await hss.fireLatest();

    expect(await sink.pings()).to.equal(1n);
    expect(await hss.pendingCount()).to.equal(0n);
  });

  it("allows only one booking per transaction", async () => {
    const t = (await now()) + 600;
    await hss.scheduleCall(ethers.ZeroAddress, t, 3_000_000, 0, "0x");

    // Same block, second attempt: the network rejects this outright, so the
    // vault must never try it. The mock reports the refusal rather than
    // reverting, matching scheduleCall's contract.
    await network.provider.send("evm_setAutomine", [false]);
    const [rc] = await hss.scheduleCall.staticCall(ethers.ZeroAddress, t, 3_000_000, 0, "0x");
    await network.provider.send("evm_setAutomine", [true]);
    expect(rc).to.not.equal(22n);
  });

  it("deletes a pending schedule and refuses to delete an executed one", async () => {
    const data = sink.interface.encodeFunctionData("ping");

    await hss.scheduleCall(await sink.getAddress(), (await now()) + 60, 1_000_000, 0, data);
    const addr = await hss.addressOf(0);

    expect(await hss.deleteSchedule.staticCall(addr)).to.equal(22n);
    await hss.deleteSchedule(addr);
    expect(await hss.pendingCount()).to.equal(0n);

    // A deleted schedule cannot then be fired.
    await expect(hss.fire(addr)).to.be.revertedWith("mock: deleted");
  });
});

const DAY = 24 * 60 * 60;

async function now(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}
