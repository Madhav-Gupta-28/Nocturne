import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import { CallSink, MockHederaScheduleService, MockStrategy, NocturneVault } from "../typechain-types";

/**
 * The vault has one job it must never fail at: keep the chain alive.
 *
 * Everything else — executing a plan, refusing one, running out of fuel — is
 * recoverable. A run that ends without booking a successor is not, because
 * nothing will ever call the vault again. So most of what follows is an attempt
 * to end the chain, and an assertion that it survived anyway.
 */
describe("NocturneVault", () => {
  const ONE_HBAR = 100_000_000n; // tinybar
  const HOUR = 3600;

  async function deployFixture() {
    const [owner, stranger] = await ethers.getSigners();

    const hss = await installMockScheduleService();

    const strategy = (await (await ethers.getContractFactory("MockStrategy")).deploy()) as MockStrategy;
    await strategy.waitForDeployment();

    const sink = (await (await ethers.getContractFactory("CallSink")).deploy()) as CallSink;
    await sink.waitForDeployment();

    const vault = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;
    await vault.waitForDeployment();

    // Fuel for 100 runs, so nothing in these tests fails for lack of it.
    await owner.sendTransaction({ to: await vault.getAddress(), value: ONE_HBAR * 160n });
    await vault.configure("0x1234");
    await vault.setAllowedTarget(await sink.getAddress(), true);

    return { vault, strategy, hss, sink, owner, stranger };
  }

  /** The plan a healthy strategy would return: one call to an allowed target. */
  async function pingAction(sink: CallSink) {
    return [{ target: await sink.getAddress(), value: 0n, data: sink.interface.encodeFunctionData("ping") }];
  }

  // ----------------------------------------------------------------
  // Arming
  // ----------------------------------------------------------------

  describe("arming", () => {
    it("books the first run and records when it is due", async () => {
      const { vault, hss } = await loadFixture(deployFixture);

      await expect(vault.arm()).to.emit(vault, "Armed");

      expect(await vault.armed()).to.equal(true);
      expect(await hss.pendingCount()).to.equal(1n);
      expect(await vault.nextSchedule()).to.not.equal(ethers.ZeroAddress);
      expect(await vault.nextRunAt()).to.be.greaterThan(await time.latest());
    });

    it("refuses to arm before it has been configured", async () => {
      const { owner, strategy } = await loadFixture(deployFixture);
      const bare = await (
        await ethers.getContractFactory("NocturneVault")
      ).deploy(await strategy.getAddress(), owner.address);
      await expect(bare.arm()).to.be.revertedWithCustomError(bare, "NotConfigured");
    });

    it("refuses a configuration the strategy rejects", async () => {
      const { vault, strategy } = await loadFixture(deployFixture);
      await strategy.setConfigValid(false);
      await expect(vault.configure("0xdead")).to.be.revertedWithCustomError(vault, "InvalidConfig");
    });

    it("releases the pending schedule when disarmed", async () => {
      const { vault, hss } = await loadFixture(deployFixture);
      await vault.arm();
      expect(await hss.pendingCount()).to.equal(1n);

      await expect(vault.disarm()).to.emit(vault, "Disarmed");
      expect(await hss.pendingCount()).to.equal(0n);
      expect(await vault.armed()).to.equal(false);
    });

    it("only the owner may arm, configure or allow a target", async () => {
      const { vault, stranger, sink } = await loadFixture(deployFixture);
      await expect(vault.connect(stranger).arm()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.connect(stranger).configure("0x00")).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount",
      );
      await expect(
        vault.connect(stranger).setAllowedTarget(await sink.getAddress(), true),
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // ----------------------------------------------------------------
  // The interval
  // ----------------------------------------------------------------

  describe("interval clamping", () => {
    it("raises an interval below the floor", async () => {
      const { vault, strategy } = await loadFixture(deployFixture);
      await strategy.setInterval(1);
      await vault.arm();

      const min = await vault.MIN_INTERVAL();
      expect(await vault.nextRunAt()).to.equal(BigInt(await time.latest()) + min);
    });

    it("lowers an interval above the ceiling, keeping clear of the 62-day limit", async () => {
      const { vault, strategy } = await loadFixture(deployFixture);
      await strategy.setInterval(365 * 24 * HOUR);
      await vault.arm();

      const max = await vault.MAX_INTERVAL();
      expect(max).to.equal(BigInt(60 * 24 * HOUR));
      expect(await vault.nextRunAt()).to.equal(BigInt(await time.latest()) + max);
    });

    it("falls back to the longest interval when the strategy cannot say", async () => {
      // A strategy having a bad day should slow the vault down, never stop it.
      const { vault, strategy } = await loadFixture(deployFixture);
      await strategy.setIntervalReverts(true);

      await vault.arm();

      expect(await vault.armed()).to.equal(true);
      expect(await vault.nextRunAt()).to.equal(BigInt(await time.latest()) + (await vault.MAX_INTERVAL()));
    });

    it("reserves gas that cannot be lowered", async () => {
      // The constant exists because 1,000,000 kills the chain silently on
      // testnet while 3,000,000 survives. There is deliberately no setter.
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.MIN_SCHEDULE_GAS()).to.equal(3_000_000n);
      expect((vault as unknown as Record<string, unknown>).setMinScheduleGas).to.equal(undefined);
    });
  });

  // ----------------------------------------------------------------
  // Keeping the chain alive — the part that matters
  // ----------------------------------------------------------------

  describe("chain survival", () => {
    it("books the successor even when the strategy reverts", async () => {
      const { vault, strategy, hss } = await loadFixture(deployFixture);
      await vault.arm();
      await strategy.setPlanReverts(true);

      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "PlanReverted");

      // One fired, one freshly booked. The chain did not end.
      expect(await hss.pendingCount()).to.equal(1n);
      expect(await vault.runCount()).to.equal(1n);
    });

    it("books the successor even when an action reverts", async () => {
      const { vault, strategy, hss, sink } = await loadFixture(deployFixture);
      await strategy.setActions(await pingAction(sink));
      await sink.setShouldRevert(true);
      await vault.arm();

      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "ActionFailed");

      expect(await hss.pendingCount()).to.equal(1n);
      expect(await sink.pings()).to.equal(0n);
    });

    it("keeps running when the booking itself is refused, and anyone can revive it", async () => {
      const { vault, hss, strategy, sink } = await loadFixture(deployFixture);
      await strategy.setActions(await pingAction(sink));
      await vault.arm();

      // The network refuses the next booking. The vault still knows when it
      // should have run, which is what makes recovery possible.
      await hss.setRefuseNextBooking(true);
      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "ScheduleFailed");

      expect(await hss.pendingCount()).to.equal(0n);
      const dueAt = await vault.nextRunAt();
      expect(dueAt).to.be.greaterThan(0n);

      // One poke from anybody and the chain picks itself back up, because that
      // run books its own successor.
      await time.increaseTo(dueAt + 1n);
      await vault.executeScheduled();
      expect(await hss.pendingCount()).to.equal(1n);
      expect(await vault.runCount()).to.equal(2n);
    });

    it("does nothing when a schedule outlives the disarm that tried to release it", async () => {
      // Releasing a slot is best effort. If the release fails the schedule is
      // still out there and will still fire, so the vault has to no-op rather
      // than execute a plan its owner has already walked away from.
      const { vault, hss, strategy, sink } = await loadFixture(deployFixture);
      await strategy.setActions(await pingAction(sink));
      await vault.arm();
      const due = await vault.nextRunAt();

      await hss.setRefuseDelete(true);
      await expect(vault.disarm()).to.emit(vault, "ScheduleReleaseFailed");
      expect(await hss.pendingCount()).to.equal(1n);

      await time.increaseTo(due + 1n);
      await expect(hss.fireLatest()).to.not.be.reverted;

      expect(await vault.runCount()).to.equal(0n);
      expect(await sink.pings()).to.equal(0n);
    });

    it("never lets executeScheduled revert, whoever calls it", async () => {
      const { vault, stranger } = await loadFixture(deployFixture);
      // Not armed, called by a stranger: a no-op, not a revert. A revert here
      // is what would end a chain if it happened on the scheduled path.
      await expect(vault.connect(stranger).executeScheduled()).to.not.be.reverted;
      expect(await vault.runCount()).to.equal(0n);
    });
  });

  // ----------------------------------------------------------------
  // Running early
  // ----------------------------------------------------------------

  describe("running early", () => {
    it("ignores a call that arrives well before the run is due", async () => {
      const { vault, stranger } = await loadFixture(deployFixture);
      await vault.arm();

      await vault.connect(stranger).executeScheduled();
      expect(await vault.runCount()).to.equal(0n);
    });

    it("accepts its own wake-up call arriving a couple of seconds early", async () => {
      // A scheduled call on Hedera observes a block.timestamp about two seconds
      // behind the second it was booked for. Without tolerance the vault would
      // reject its own wake-up and stop forever.
      const { vault, hss, strategy, sink } = await loadFixture(deployFixture);
      await strategy.setActions(await pingAction(sink));
      await vault.arm();

      await time.increaseTo((await vault.nextRunAt()) - 3n);
      await hss.fireLatest();

      expect(await vault.runCount()).to.equal(1n);
      expect(await sink.pings()).to.equal(1n);
    });

    it("bounds how early an uninvited caller can force a run", async () => {
      const { vault, stranger } = await loadFixture(deployFixture);
      await vault.arm();

      const skew = await vault.CLOCK_SKEW();
      await time.increaseTo((await vault.nextRunAt()) - skew - 5n);
      await vault.connect(stranger).executeScheduled();
      expect(await vault.runCount()).to.equal(0n);
    });
  });

  // ----------------------------------------------------------------
  // What a plan is allowed to touch
  // ----------------------------------------------------------------

  describe("plan boundaries", () => {
    it("rejects a plan whole when any target is not allowed", async () => {
      const { vault, strategy, hss, sink, stranger } = await loadFixture(deployFixture);
      await strategy.setActions([...(await pingAction(sink)), { target: stranger.address, value: 0n, data: "0x" }]);
      await vault.arm();

      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "PlanRejected").withArgs(1n, stranger.address);

      // Rejected whole: the allowed first action did not run either. A partly
      // executed plan leaves an approve standing without its swap.
      expect(await sink.pings()).to.equal(0n);
      expect(await vault.refusalCount()).to.equal(1n);
      expect(await hss.pendingCount()).to.equal(1n);
    });

    it("cannot be made to write state through plan()", async () => {
      // plan() is reached by staticcall. A strategy that mutates must fail at
      // the EVM level, not on trust.
      const { owner, sink } = await loadFixture(deployFixture);
      const writer = await (await ethers.getContractFactory("StateWritingStrategy")).deploy();
      await writer.waitForDeployment();

      const vault = await (
        await ethers.getContractFactory("NocturneVault")
      ).deploy(await writer.getAddress(), owner.address);
      await vault.waitForDeployment();
      await owner.sendTransaction({ to: await vault.getAddress(), value: ONE_HBAR * 10n });
      await vault.configure("0x01");
      await vault.setAllowedTarget(await sink.getAddress(), true);
      await vault.arm();

      await time.increaseTo((await vault.nextRunAt()) + 1n);
      const hss = (await ethers.getContractAt(
        "MockHederaScheduleService",
        "0x000000000000000000000000000000000000016b",
      )) as MockHederaScheduleService;
      await expect(hss.fireLatest()).to.emit(vault, "PlanReverted");

      expect(await writer.writes()).to.equal(0n);
    });

    it("records a refusal, with the strategy's own reason", async () => {
      const { vault, strategy, hss } = await loadFixture(deployFixture);
      await strategy.setExplanation("refused", 205n, 94n);
      await strategy.clearActions();
      await vault.arm();

      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "Refused").withArgs(1n, "refused", 205n, 94n);

      expect(await vault.refusalCount()).to.equal(1n);
      expect(await vault.runCount()).to.equal(1n);
    });

    it("still records a refusal when the strategy cannot explain itself", async () => {
      const { vault, strategy, hss } = await loadFixture(deployFixture);
      await strategy.clearActions();
      await strategy.setExplainReverts(true);
      await vault.arm();

      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "Refused").withArgs(1n, "unknown", 0n, 0n);
    });
  });

  // ----------------------------------------------------------------
  // Fuel
  // ----------------------------------------------------------------

  describe("fuel", () => {
    it("reports runway in whole runs", async () => {
      const { vault } = await loadFixture(deployFixture);
      const perRun = await vault.TINYBAR_PER_RUN();
      const balance = await ethers.provider.getBalance(await vault.getAddress());
      expect(await vault.runway()).to.equal(balance / perRun);
    });

    it("warns before the fuel runs out rather than after", async () => {
      const { vault, strategy, hss, sink, owner } = await loadFixture(deployFixture);
      await strategy.setActions(await pingAction(sink));

      // Leave just under the warning threshold.
      const perRun = await vault.TINYBAR_PER_RUN();
      const balance = await ethers.provider.getBalance(await vault.getAddress());
      const keep = perRun * 3n;
      await vault.withdrawHbar(balance - keep);

      await vault.arm();
      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await expect(hss.fireLatest()).to.emit(vault, "FuelLow");
      expect(owner).to.not.equal(undefined);
    });
  });

  // ----------------------------------------------------------------
  // Getting out
  // ----------------------------------------------------------------

  describe("withdrawals", () => {
    it("lets the owner withdraw HBAR while armed", async () => {
      // A vault the owner cannot leave is not non-custodial.
      //
      // Asserted on the vault's balance, not the owner's: the owner pays gas for
      // the withdrawal, and on this local chain the amounts are plain wei rather
      // than tinybar, so gas dwarfs the transfer and the owner's balance falls.
      const { vault } = await loadFixture(deployFixture);
      await vault.arm();

      const addr = await vault.getAddress();
      const before = await ethers.provider.getBalance(addr);
      await expect(vault.withdrawHbar(ONE_HBAR)).to.emit(vault, "HbarWithdrawn");
      expect(await ethers.provider.getBalance(addr)).to.equal(before - ONE_HBAR);
    });

    it("refuses to withdraw more HBAR than it holds", async () => {
      const { vault } = await loadFixture(deployFixture);
      const balance = await ethers.provider.getBalance(await vault.getAddress());
      await expect(vault.withdrawHbar(balance + 1n)).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("keeps strangers out of the funds", async () => {
      const { vault, stranger } = await loadFixture(deployFixture);
      await expect(vault.connect(stranger).withdrawHbar(1n)).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ----------------------------------------------------------------
  // A full unattended chain
  // ----------------------------------------------------------------

  it("runs three times on its own, with no transaction from the owner", async () => {
    const { vault, strategy, hss, sink } = await loadFixture(deployFixture);
    await strategy.setActions(await pingAction(sink));
    await strategy.setInterval(HOUR);
    await vault.arm();

    for (let i = 0; i < 3; i++) {
      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await hss.fireLatest();
    }

    expect(await vault.runCount()).to.equal(3n);
    expect(await sink.pings()).to.equal(3n);
    // Still armed, still booked, still going.
    expect(await hss.pendingCount()).to.equal(1n);
    expect(await network.provider.send("eth_chainId")).to.not.equal(undefined);
  });
});
