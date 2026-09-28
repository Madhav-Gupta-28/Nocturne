import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import { CallSink, MockHederaScheduleService, MockStrategy, NocturneVault, ScheduledVault } from "../typechain-types";

/**
 * Nocturne next to the pattern it starts from.
 *
 * Scaffold-HBAR's built-in `payments-scheduler` template ships `ScheduledVault`:
 * a vault that runs a pluggable strategy on the Schedule Service. Nocturne keeps
 * that shape — vault, factory, a strategy returning `Action[]` — and changes what
 * it takes to trust it with money. `contracts/test/reference/ScheduledVault.sol`
 * is Hedera's contract, vendored unmodified apart from import paths, and both
 * vaults run here against the same mock Schedule Service and the same strategy.
 *
 * Each case sets both vaults up identically and asserts the one behaviour that
 * differs. Nothing is contrived for the comparison: the strategy, the sink and
 * the scheduler are the fixtures the rest of the suite already uses.
 */
describe("NocturneVault against Hedera's ScheduledVault", () => {
  const ONE_HBAR = 100_000_000n;
  const HOUR = 3600;

  async function deployFixture() {
    const [owner, stranger] = await ethers.getSigners();
    const hss = (await installMockScheduleService()) as MockHederaScheduleService;

    const strategy = (await (await ethers.getContractFactory("MockStrategy")).deploy()) as MockStrategy;
    const sink = (await (await ethers.getContractFactory("CallSink")).deploy()) as CallSink;
    await strategy.setActions([
      { target: await sink.getAddress(), value: 0n, data: sink.interface.encodeFunctionData("ping") },
    ]);

    const hedera = (await (
      await ethers.getContractFactory("ScheduledVault")
    ).deploy(await strategy.getAddress(), owner.address)) as ScheduledVault;
    const nocturne = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;

    for (const v of [hedera, nocturne]) {
      await owner.sendTransaction({ to: await v.getAddress(), value: ONE_HBAR * 200n });
    }

    return { hedera, nocturne, strategy, sink, hss, owner, stranger };
  }

  /** Configure and start each vault the way its own template does. */
  async function start(f: Awaited<ReturnType<typeof deployFixture>>, which: "hedera" | "nocturne") {
    if (which === "hedera") {
      await f.hedera.configure("0x1234", HOUR);
      await f.hedera.scheduleNextRun();
    } else {
      await f.nocturne.configure("0x1234");
      await f.nocturne.setAllowedCall(await f.sink.getAddress(), f.sink.interface.getFunction("ping")!.selector, true);
      await f.nocturne.arm();
    }
  }

  // ----------------------------------------------------------------
  // Uninvited callers
  // ----------------------------------------------------------------

  describe("a stranger calls executeScheduled three times, straight after setup", () => {
    it("ScheduledVault runs the plan each time and leaves four schedules behind", async () => {
      // No caller check and no due-time check: each call runs the plan now, then
      // books another run without releasing the one already pending. Every
      // extra schedule re-books itself when it fires, so each call is a new,
      // permanent chain paid from the vault's balance.
      const f = await loadFixture(deployFixture);
      await start(f, "hedera");
      expect(await f.hss.pendingCount()).to.equal(1n);

      for (let i = 0; i < 3; i++) await f.hedera.connect(f.stranger).executeScheduled();

      expect(await f.sink.pings()).to.equal(3n);
      expect(await f.hss.pendingCount()).to.equal(4n);
    });

    it("NocturneVault runs nothing and keeps its one schedule", async () => {
      // Not due, so each call returns before doing anything. Even a call that
      // is due releases the schedule it replaces; there is only ever one chain.
      const f = await loadFixture(deployFixture);
      await start(f, "nocturne");

      for (let i = 0; i < 3; i++) await f.nocturne.connect(f.stranger).executeScheduled();

      expect(await f.sink.pings()).to.equal(0n);
      expect(await f.hss.pendingCount()).to.equal(1n);
      expect(await f.nocturne.runCount()).to.equal(0n);
    });
  });

  // ----------------------------------------------------------------
  // What a strategy is allowed to do
  // ----------------------------------------------------------------

  describe("a strategy plans a call that sends the vault's HBAR to an outside address", () => {
    async function drainPlan(f: Awaited<ReturnType<typeof deployFixture>>) {
      await f.strategy.setActions([{ target: f.stranger.address, value: ONE_HBAR, data: "0x" }]);
    }

    it("ScheduledVault executes it", async () => {
      const f = await loadFixture(deployFixture);
      await start(f, "hedera");
      await drainPlan(f);
      const before = await ethers.provider.getBalance(await f.hedera.getAddress());

      await time.increase(HOUR);
      await f.hss.fireLatest();

      expect(await ethers.provider.getBalance(await f.hedera.getAddress())).to.equal(before - ONE_HBAR);
    });

    it("NocturneVault rejects the whole plan and moves nothing", async () => {
      // Two independent refusals: the call carries HBAR, and its target was
      // never allowed. Either one alone rejects the plan before it runs.
      const f = await loadFixture(deployFixture);
      await start(f, "nocturne");
      await drainPlan(f);
      const before = await ethers.provider.getBalance(await f.nocturne.getAddress());

      await time.increaseTo((await f.nocturne.nextRunAt()) + 1n);
      await expect(f.hss.fireLatest()).to.emit(f.nocturne, "PlanRejected");

      expect(await ethers.provider.getBalance(await f.nocturne.getAddress())).to.equal(before);
    });
  });

  // ----------------------------------------------------------------
  // Who decides when to look again
  // ----------------------------------------------------------------

  describe("the strategy wants to look again in a minute, not an hour", () => {
    /** Seconds between the latest run and the run it booked. */
    async function nextGap(hss: MockHederaScheduleService) {
      const booked = await hss.scheduleAt((await hss.scheduleCount()) - 1n);
      return booked.expirySecond - BigInt(await time.latest());
    }

    it("ScheduledVault keeps the hour it was configured with", async () => {
      // The interval is fixed at configure(), which is owner-only. The strategy
      // has no way to say that something is close.
      const f = await loadFixture(deployFixture);
      await start(f, "hedera");
      await f.strategy.setInterval(60);

      await time.increase(HOUR);
      await f.hss.fireLatest();

      expect(await nextGap(f.hss)).to.equal(BigInt(HOUR));
    });

    it("NocturneVault books the minute the strategy asked for", async () => {
      const f = await loadFixture(deployFixture);
      await start(f, "nocturne");
      await f.strategy.setInterval(60);

      await time.increaseTo((await f.nocturne.nextRunAt()) + 1n);
      await f.hss.fireLatest();

      expect(await nextGap(f.hss)).to.equal(60n);
    });
  });
});
