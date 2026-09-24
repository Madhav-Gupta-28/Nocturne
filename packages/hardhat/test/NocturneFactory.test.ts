import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import { CallSink, MockStrategy, NocturneFactory, NocturneVault } from "../typechain-types";

/**
 * The factory is small, and most of it is bookkeeping. One test here is not
 * bookkeeping: the one asserting a vault is a real deployment rather than a
 * proxy.
 *
 * A clone would be the obvious saving — 45 bytes instead of several thousand —
 * and it would quietly break every vault it created. Schedules booked from a
 * DELEGATECALL frame get an admin key the payer-signature check does not handle,
 * so they fire on time and fail INVALID_PAYER_SIGNATURE with no contract result.
 * A cloned vault would look armed, funded and scheduled, and never execute once.
 *
 * So that test is a tripwire for a future optimisation, not a property anyone
 * would otherwise think to assert.
 */
describe("NocturneFactory", () => {
  const ONE_HBAR = 100_000_000n;

  /** EIP-1167: runtime code is 45 bytes and begins with this. */
  const MINIMAL_PROXY_PREFIX = "0x363d3d373d3d3d363d73";

  async function deployFixture() {
    const [owner, other] = await ethers.getSigners();

    const hss = await installMockScheduleService();

    const strategy = (await (await ethers.getContractFactory("MockStrategy")).deploy()) as MockStrategy;
    await strategy.waitForDeployment();

    const sink = (await (await ethers.getContractFactory("CallSink")).deploy()) as CallSink;
    await sink.waitForDeployment();

    const factory = (await (await ethers.getContractFactory("NocturneFactory")).deploy()) as NocturneFactory;
    await factory.waitForDeployment();

    return { factory, strategy, hss, sink, owner, other };
  }

  async function createVault(factory: NocturneFactory, strategy: MockStrategy, value = 0n): Promise<NocturneVault> {
    const tx = await factory.createVault(await strategy.getAddress(), { value });
    await tx.wait();
    const addr = await factory.latestVaultOf((await ethers.getSigners())[0].address);
    return (await ethers.getContractAt("NocturneVault", addr)) as NocturneVault;
  }

  describe("creating a vault", () => {
    it("hands ownership to the caller, not to the factory", async () => {
      const { factory, strategy, owner } = await loadFixture(deployFixture);
      const vault = await createVault(factory, strategy);

      expect(await vault.owner()).to.equal(owner.address);
      expect(await vault.strategy()).to.equal(await strategy.getAddress());
    });

    it("emits the vault, its owner and its strategy", async () => {
      const { factory, strategy, owner } = await loadFixture(deployFixture);

      // Read the address out of the receipt: the vault does not exist before
      // the transaction, so it cannot be predicted by calling the factory.
      const receipt = await (await factory.createVault(await strategy.getAddress(), { value: ONE_HBAR })).wait();
      const log = receipt!.logs
        .map(l => {
          try {
            return factory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find(l => l?.name === "VaultCreated");

      expect(log).to.not.equal(undefined);
      expect(log!.args.owner).to.equal(owner.address);
      expect(log!.args.strategy).to.equal(await strategy.getAddress());
      expect(log!.args.funded).to.equal(ONE_HBAR);
      expect(log!.args.vault).to.equal(await factory.latestVaultOf(owner.address));
    });

    it("forwards funding so the vault can pay for its own associations", async () => {
      const { factory, strategy } = await loadFixture(deployFixture);
      const vault = await createVault(factory, strategy, ONE_HBAR * 10n);

      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(ONE_HBAR * 10n);
    });

    it("records the deposit on the vault's own event log", async () => {
      // Forwarded with a call rather than passed to the constructor, so the
      // vault's receive() sees it and it shows up like any other deposit.
      const { factory, strategy } = await loadFixture(deployFixture);
      const vault = await createVault(factory, strategy, ONE_HBAR);

      const events = await vault.queryFilter(vault.filters.HbarDeposited(), 0);
      expect(events.length).to.equal(1);
      expect(events[0].args.tinybar).to.equal(ONE_HBAR);
    });

    it("refuses a zero strategy", async () => {
      const { factory } = await loadFixture(deployFixture);
      await expect(factory.createVault(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  describe("real deployments, never clones", () => {
    it("does not produce a minimal proxy", async () => {
      // If this ever fails, someone has swapped `new NocturneVault` for a clone
      // and every vault this factory makes is now silently dead. See the comment
      // at the top of this file before changing it.
      const { factory, strategy } = await loadFixture(deployFixture);
      const vault = await createVault(factory, strategy);

      const code = await ethers.provider.getCode(await vault.getAddress());
      expect(code.startsWith(MINIMAL_PROXY_PREFIX)).to.equal(false);
      // A minimal proxy is 45 bytes; a real vault is thousands.
      expect((code.length - 2) / 2).to.be.greaterThan(1000);
    });

    it("gives each vault its own storage", async () => {
      // The point of not cloning is independent state, so assert it rather than
      // assume it: two vaults, one armed, and the other must not be.
      const { factory, strategy, owner } = await loadFixture(deployFixture);

      await factory.createVault(await strategy.getAddress(), { value: ONE_HBAR * 10n });
      const first = (await ethers.getContractAt(
        "NocturneVault",
        await factory.vaultOf(owner.address, 0),
      )) as NocturneVault;

      await factory.createVault(await strategy.getAddress(), { value: ONE_HBAR * 10n });
      const second = (await ethers.getContractAt(
        "NocturneVault",
        await factory.vaultOf(owner.address, 1),
      )) as NocturneVault;

      expect(await first.getAddress()).to.not.equal(await second.getAddress());

      await first.configure("0x01");
      await first.arm();

      expect(await first.armed()).to.equal(true);
      expect(await second.armed()).to.equal(false);
    });
  });

  describe("bookkeeping", () => {
    it("keeps each owner's vaults separate", async () => {
      const { factory, strategy, owner, other } = await loadFixture(deployFixture);

      await factory.createVault(await strategy.getAddress());
      await factory.createVault(await strategy.getAddress());
      await factory.connect(other).createVault(await strategy.getAddress());

      expect(await factory.vaultCount(owner.address)).to.equal(2n);
      expect(await factory.vaultCount(other.address)).to.equal(1n);
      expect(await factory.totalVaults()).to.equal(3n);

      const mine = await factory.vaultsOf(owner.address);
      expect(mine.length).to.equal(2);
      expect(mine[1]).to.equal(await factory.latestVaultOf(owner.address));
    });

    it("reports the zero address for an owner with no vaults", async () => {
      const { factory, other } = await loadFixture(deployFixture);
      expect(await factory.latestVaultOf(other.address)).to.equal(ethers.ZeroAddress);
      expect(await factory.vaultCount(other.address)).to.equal(0n);
    });

    it("pages the global list without running off the end", async () => {
      const { factory, strategy } = await loadFixture(deployFixture);
      for (let i = 0; i < 3; i++) await factory.createVault(await strategy.getAddress());

      expect((await factory.allVaults(0, 2)).length).to.equal(2);
      // A limit past the end truncates rather than reverting.
      expect((await factory.allVaults(2, 50)).length).to.equal(1);
      // An offset past the end is empty, not an error.
      expect((await factory.allVaults(99, 10)).length).to.equal(0);
    });
  });

  it("produces a vault that actually runs unattended", async () => {
    // The factory is only useful if what it makes works, so this walks one
    // vault from creation to a third self-scheduled execution.
    const { factory, strategy, hss, sink, owner } = await loadFixture(deployFixture);

    await factory.createVault(await strategy.getAddress(), { value: ONE_HBAR * 160n });
    const vault = (await ethers.getContractAt(
      "NocturneVault",
      await factory.latestVaultOf(owner.address),
    )) as NocturneVault;

    await strategy.setActions([
      { target: await sink.getAddress(), value: 0n, data: sink.interface.encodeFunctionData("ping") },
    ]);
    await vault.setAllowedCall(await sink.getAddress(), sink.interface.getFunction("ping")!.selector, true);
    await vault.configure("0x01");
    await vault.arm();

    for (let i = 0; i < 3; i++) {
      await time.increaseTo((await vault.nextRunAt()) + 1n);
      await hss.fireLatest();
    }

    expect(await vault.runCount()).to.equal(3n);
    expect(await sink.pings()).to.equal(3n);
  });
});

describe("NocturneFactory pagination", () => {
  it("pages an owner's vaults and clamps past the end", async () => {
    const [owner] = await ethers.getSigners();
    const strategy = await (await ethers.getContractFactory("MockStrategy")).deploy();
    const factory = await (await ethers.getContractFactory("NocturneFactory")).deploy();
    const s = await strategy.getAddress();

    for (let i = 0; i < 3; i++) await (await factory.createVault(s)).wait();

    const all = await factory["vaultsOf(address)"](owner.address);
    expect(all.length).to.equal(3);

    expect((await factory["vaultsOf(address,uint256,uint256)"](owner.address, 0, 2)).length).to.equal(2);
    expect((await factory["vaultsOf(address,uint256,uint256)"](owner.address, 2, 99)).length).to.equal(1);
    expect((await factory["vaultsOf(address,uint256,uint256)"](owner.address, 99, 10)).length).to.equal(0);
  });
});
