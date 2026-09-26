import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture, time, impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { HSS_ADDRESS, installMockScheduleService } from "./MockHederaScheduleService.test";
import { CallSink, MockStrategy, MockToken, MockTokenService, NocturneVault } from "../typechain-types";

/**
 * The edges of the vault: every input it refuses, and every way the Schedule
 * Service can answer badly.
 *
 * NocturneVault.test.ts proves the chain survives a hostile strategy. This file
 * proves the vault survives a hostile *network* — no precompile, a reverting
 * one, a malformed answer — and that each owner entry point rejects the inputs
 * it says it rejects. Nothing here is decorative: a branch no test takes is a
 * branch nobody has watched fail.
 */
describe("NocturneVault edges", () => {
  const ONE_HBAR = 100_000_000n;
  const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";

  /** Runtime code that reverts on any call. */
  const REVERTS = "0x60006000fd";
  /** Runtime code that returns a single word, 1, to any call. */
  const RETURNS_ONE_WORD = "0x600160005260206000f3";

  async function deployFixture() {
    const [owner, stranger] = await ethers.getSigners();
    const hss = await installMockScheduleService();

    const strategy = (await (await ethers.getContractFactory("MockStrategy")).deploy()) as MockStrategy;
    const sink = (await (await ethers.getContractFactory("CallSink")).deploy()) as CallSink;
    const vault = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;
    const token = (await (await ethers.getContractFactory("MockToken")).deploy("Dai", "DAI", 8)) as MockToken;

    await owner.sendTransaction({ to: await vault.getAddress(), value: ONE_HBAR * 160n });
    await vault.configure("0x1234");
    await token.mint(owner.address, 1_000n);

    return { vault, strategy, sink, token, hss, owner, stranger };
  }

  const setCode = (addr: string, code: string) => network.provider.send("hardhat_setCode", [addr, code]);

  // ----------------------------------------------------------------
  // Inputs the owner can get wrong
  // ----------------------------------------------------------------

  describe("rejected inputs", () => {
    it("will not be built or re-pointed without a strategy", async () => {
      const { vault, owner } = await loadFixture(deployFixture);
      const Vault = await ethers.getContractFactory("NocturneVault");
      await expect(Vault.deploy(ethers.ZeroAddress, owner.address)).to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(vault.setStrategy(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("will not grant a call on the zero address", async () => {
      const { vault } = await loadFixture(deployFixture);
      await expect(vault.setAllowedCall(ethers.ZeroAddress, "0x12345678", true)).to.be.revertedWithCustomError(
        vault,
        "ZeroAddress",
      );
    });

    it("rejects zero amounts and the zero token on every fund movement", async () => {
      const { vault, token } = await loadFixture(deployFixture);
      const t = await token.getAddress();

      await expect(vault.depositHbar({ value: 0 })).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.depositToken(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(vault.depositToken(t, 0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.withdrawHbar(0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.withdrawToken(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(vault.withdrawToken(t, 0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("refuses to arm twice or disarm when idle", async () => {
      const { vault } = await loadFixture(deployFixture);
      await expect(vault.disarm()).to.be.revertedWithCustomError(vault, "NotArmed");
      await vault.arm();
      await expect(vault.arm()).to.be.revertedWithCustomError(vault, "AlreadyArmed");
    });
  });

  // ----------------------------------------------------------------
  // Tokens in and out
  // ----------------------------------------------------------------

  describe("tokens", () => {
    it("takes a token in with the owner's approval and gives it back to the owner only", async () => {
      const { vault, token, owner, stranger } = await loadFixture(deployFixture);
      const v = await vault.getAddress();
      const t = await token.getAddress();

      // No approval, no deposit: the pull is a transferFrom, not a hope.
      await expect(vault.depositToken(t, 400n)).to.be.reverted;

      await token.approve(v, 400n);
      await expect(vault.depositToken(t, 400n)).to.emit(vault, "TokenDeposited").withArgs(t, 400n);
      expect(await token.balanceOf(v)).to.equal(400n);

      await expect(vault.connect(stranger).withdrawToken(t, 1n)).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount",
      );
      await expect(vault.withdrawToken(t, 400n)).to.emit(vault, "TokenWithdrawn").withArgs(t, owner.address, 400n);
      expect(await token.balanceOf(owner.address)).to.equal(1_000n);
    });

    it("reports the HTS response code when associating, and passes itself as the account", async () => {
      const { vault, token } = await loadFixture(deployFixture);
      const code = await ethers.provider.getCode(
        await (await (await ethers.getContractFactory("MockTokenService")).deploy()).getAddress(),
      );
      await setCode(HTS_ADDRESS, code);
      const hts = (await ethers.getContractAt("MockTokenService", HTS_ADDRESS)) as MockTokenService;
      const t = await token.getAddress();

      expect(await vault.associate.staticCall(t)).to.equal(22n);
      await expect(vault.associate(t)).to.emit(vault, "Associated").withArgs(t, 22n);
      expect(await hts.lastAccount()).to.equal(await vault.getAddress());

      // 167 is "not an HTS token". Reported, not thrown: a plain ERC-20 needs no
      // association, and the owner should be told rather than blocked.
      await hts.setResponse(167);
      await expect(vault.associate(t)).to.emit(vault, "Associated").withArgs(t, 167n);

      await expect(vault.associate(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("surfaces a refused HBAR transfer instead of swallowing it", async () => {
      // An owner that cannot receive HBAR — a contract with no receive — must
      // see the withdrawal fail, not see the funds vanish.
      const { strategy } = await loadFixture(deployFixture);
      const sink = await (await ethers.getContractFactory("CallSink")).deploy();
      const locked = await (
        await ethers.getContractFactory("NocturneVault")
      ).deploy(await strategy.getAddress(), await sink.getAddress());
      const [funder] = await ethers.getSigners();
      await funder.sendTransaction({ to: await locked.getAddress(), value: ONE_HBAR });

      await impersonateAccount(await sink.getAddress());
      await setBalance(await sink.getAddress(), ethers.parseEther("1"));
      const asOwner = await ethers.getSigner(await sink.getAddress());
      await expect(locked.connect(asOwner).withdrawHbar(ONE_HBAR)).to.be.revertedWithCustomError(
        locked,
        "InsufficientBalance",
      );
    });
  });

  // ----------------------------------------------------------------
  // A Schedule Service that answers badly
  // ----------------------------------------------------------------

  describe("a misbehaving Schedule Service", () => {
    it("arms without booking when there is no precompile at all", async () => {
      // A plain EVM chain: 0x16b is empty, so every call "succeeds" with no data.
      const { vault } = await loadFixture(deployFixture);
      await setCode(HSS_ADDRESS, "0x");

      await expect(vault.arm()).to.emit(vault, "ScheduleFailed");
      expect(await vault.armed()).to.equal(true);
      expect(await vault.nextSchedule()).to.equal(ethers.ZeroAddress);
      // Nothing booked, so nothing to release: disarm must still succeed.
      await expect(vault.disarm()).to.emit(vault, "Disarmed").and.not.to.emit(vault, "ScheduleReleaseFailed");
    });

    it("treats a reverting capacity check as no capacity", async () => {
      const { vault } = await loadFixture(deployFixture);
      await setCode(HSS_ADDRESS, REVERTS);
      await expect(vault.arm()).to.emit(vault, "ScheduleFailed");
      expect(await vault.nextSchedule()).to.equal(ethers.ZeroAddress);
    });

    it("treats a short answer from scheduleCall as a failed booking", async () => {
      // Capacity says yes (one word, true), but the booking returns one word
      // where two are due. Decoding it anyway would read garbage as an address.
      const { vault } = await loadFixture(deployFixture);
      await setCode(HSS_ADDRESS, RETURNS_ONE_WORD);
      await expect(vault.arm()).to.emit(vault, "ScheduleFailed");
      expect(await vault.nextSchedule()).to.equal(ethers.ZeroAddress);
    });

    it("books nothing when the network reports no capacity at that second", async () => {
      const { vault, hss } = await loadFixture(deployFixture);
      await hss.setRefuseCapacity(true);
      await expect(vault.arm())
        .to.emit(vault, "ScheduleFailed")
        .withArgs(0n, (at: bigint) => at > 0n);
      expect(await hss.pendingCount()).to.equal(0n);
    });

    it("still disarms when the release call itself reverts", async () => {
      const { vault } = await loadFixture(deployFixture);
      await vault.arm();
      const booked = await vault.nextSchedule();

      await setCode(HSS_ADDRESS, REVERTS);
      await expect(vault.disarm()).to.emit(vault, "ScheduleReleaseFailed").withArgs(booked);
      expect(await vault.armed()).to.equal(false);
      expect(await vault.nextSchedule()).to.equal(ethers.ZeroAddress);
    });
  });

  // ----------------------------------------------------------------
  // The call the network actually makes
  // ----------------------------------------------------------------

  describe("the scheduled sender", () => {
    it("does not try to release the schedule it is running inside", async () => {
      // On Hedera a scheduled call arrives with msg.sender == the vault. The
      // mock cannot forge that, so impersonate it: this is the production path.
      const { vault, hss } = await loadFixture(deployFixture);
      await vault.arm();
      await time.increaseTo((await vault.nextRunAt()) + 1n);

      const self = await vault.getAddress();
      await impersonateAccount(self);
      // Enough to pay for its own transaction here; the network pays on Hedera.
      await setBalance(self, ethers.parseEther("10"));
      const asSelf = await ethers.getSigner(self);

      const tx = vault.connect(asSelf).executeScheduled();
      await expect(tx).to.emit(vault, "ScheduleBooked").and.not.to.emit(vault, "ScheduleReleaseFailed");
      // The old booking was not deleted, and a new one was made alongside it.
      expect(await hss.pendingCount()).to.equal(2n);
      expect(await vault.runCount()).to.equal(1n);
    });
  });

  // ----------------------------------------------------------------
  // Views
  // ----------------------------------------------------------------

  describe("views", () => {
    it("reports fuel and status from one read each", async () => {
      const { vault } = await loadFixture(deployFixture);
      const held = await ethers.provider.getBalance(await vault.getAddress());
      expect(await vault.fuel()).to.equal(held);

      await vault.arm();
      const [armed, runs, refusals, nextAt, runsLeft] = await vault.status();
      expect(armed).to.equal(true);
      expect(runs).to.equal(0n);
      expect(refusals).to.equal(0n);
      expect(nextAt).to.equal(await vault.nextRunAt());
      expect(runsLeft).to.equal(await vault.runway());
    });

    it("reserves twice what a run is charged", async () => {
      const { vault } = await loadFixture(deployFixture);
      const reserve = await vault.reservePerRun();
      const charge = await vault.chargePerRun();
      expect(charge * 2n).to.equal(reserve);
    });
  });
});
