import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import {
  DriftRebalanceStrategy,
  MockAggregator,
  MockSwapRouter,
  MockToken,
  MockV3Pool,
  NocturneVault,
} from "../typechain-types";

/**
 * The second strategy exists to prove the first one did not shape the interface
 * around itself.
 *
 * The exit is a threshold: one-way, terminal, urgent. This is a target:
 * two-way, repeating, economic. If both fit `plan` and `nextInterval` with no
 * special case anywhere in the vault, the abstraction holds.
 */
describe("DriftRebalanceStrategy", () => {
  const ONE_HBAR = 100_000_000n;
  const DEC_A = 8; // like WHBAR
  const DEC_B = 6; // like USDC

  const TARGET_A = 5000; // half the value in A
  const BAND = 500; // leave alone within 5 points either side
  const SLIPPAGE = 100n;
  const MIN_TRADE = ethers.parseEther("10"); // $10 of B

  const CALM = 12n * 3600n;
  const WATCHFUL = 2n * 3600n;
  const CLOSE = 900n;
  const DIVERGED = 300n;

  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const hss = await installMockScheduleService();

    const tokenA = (await (
      await ethers.getContractFactory("MockToken")
    ).deploy("Wrapped HBAR", "WHBAR", DEC_A)) as MockToken;
    const tokenB = (await (
      await ethers.getContractFactory("MockToken")
    ).deploy("USD Coin", "USDC", DEC_B)) as MockToken;
    const pool = (await (
      await ethers.getContractFactory("MockV3Pool")
    ).deploy(await tokenB.getAddress(), await tokenA.getAddress())) as MockV3Pool;
    const feed = (await (await ethers.getContractFactory("MockAggregator")).deploy(0, 0)) as MockAggregator;
    const router = (await (
      await ethers.getContractFactory("MockSwapRouter")
    ).deploy(ethers.parseEther("2"))) as MockSwapRouter;
    const strategy = (await (
      await ethers.getContractFactory("DriftRebalanceStrategy")
    ).deploy()) as DriftRebalanceStrategy;

    for (const c of [tokenA, tokenB, pool, feed, router, strategy]) await c.waitForDeployment();

    const vault = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;
    await vault.waitForDeployment();
    await owner.sendTransaction({ to: await vault.getAddress(), value: ONE_HBAR * 160n });

    await vault.setAllowedTarget(await tokenA.getAddress(), true);
    await vault.setAllowedTarget(await tokenB.getAddress(), true);
    await vault.setAllowedTarget(await router.getAddress(), true);

    await setPrice(pool, feed, 2);

    const config = async (over: Record<string, unknown> = {}) =>
      strategy.encodeConfig({
        vault: await vault.getAddress(),
        assetA: await tokenA.getAddress(),
        assetB: await tokenB.getAddress(),
        router: await router.getAddress(),
        fee: 3000,
        targetBpsA: TARGET_A,
        bandBps: BAND,
        minTradeValue1e18: MIN_TRADE,
        slippageBps: SLIPPAGE,
        decimalsA: DEC_A,
        decimalsB: DEC_B,
        sources: {
          pool: await pool.getAddress(),
          twapWindow: 300,
          feed: await feed.getAddress(),
          maxFeedAge: 86_400n,
          maxDivergenceBps: 200n,
          assetIsToken0: false,
          assetDecimals: DEC_A,
          quoteDecimals: DEC_B,
        },
        ...over,
      });

    /** Fund the vault with whole tokens of each side. */
    const fund = async (a: number, b: number) => {
      const v = await vault.getAddress();
      if (a > 0) await tokenA.mint(v, BigInt(Math.round(a * 10 ** DEC_A)));
      if (b > 0) await tokenB.mint(v, BigInt(Math.round(b * 10 ** DEC_B)));
    };

    return { vault, strategy, tokenA, tokenB, pool, feed, router, hss, owner, config, fund };
  }

  async function setPrice(pool: MockV3Pool, feed: MockAggregator, price: number) {
    const raw = (1 / price) * 10 ** (DEC_A - DEC_B);
    await pool.setTick(Math.round(Math.log(raw) / Math.log(1.0001)));
    await feed.setAnswer(BigInt(Math.round(price * 1e8)));
    await feed.setUpdatedAt(await time.latest());
  }

  // ----------------------------------------------------------------
  // Reading the position
  // ----------------------------------------------------------------

  describe("reading the position", () => {
    it("values both sides and reports the split", async () => {
      // 50 A at $2 = $100, plus $100 of B: exactly on target.
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(50, 100);

      const p = await strategy.inspect(await config());
      expect(p.priced).to.equal(true);
      expect(p.totalValue).to.equal(ethers.parseEther("200"));
      expect(p.currentBpsA).to.equal(5000n);
      expect(p.driftBps).to.equal(0n);
    });

    it("notices when A is heavy", async () => {
      // 100 A at $2 = $200 against $100 of B, so A is two thirds.
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(100, 100);

      const p = await strategy.inspect(await config());
      expect(p.currentBpsA).to.equal(6666n);
      expect(p.overweightA).to.equal(true);
      expect(p.driftBps).to.equal(1666n);
      // Restoring half of $300 means moving $50 out of A.
      expect(p.tradeValue).to.equal(ethers.parseEther("50"));
    });

    it("notices when A is light", async () => {
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(25, 150);

      const p = await strategy.inspect(await config());
      expect(p.overweightA).to.equal(false);
      expect(p.currentBpsA).to.equal(2500n);
      expect(p.tradeValue).to.equal(ethers.parseEther("50"));
    });
  });

  // ----------------------------------------------------------------
  // Deciding
  // ----------------------------------------------------------------

  describe("deciding", () => {
    it("leaves a balanced portfolio alone", async () => {
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(50, 100);

      expect((await strategy.plan(await config())).length).to.equal(0);
      expect((await strategy.explain(await config()))[0]).to.equal("balanced");
    });

    it("leaves drift inside the band alone", async () => {
      // 52 A at $2 = $104 against $100: 50.98%, inside the 5-point band.
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(52, 100);

      const p = await strategy.inspect(await config());
      expect(p.driftBps).to.be.lessThan(BigInt(BAND));
      expect((await strategy.plan(await config())).length).to.equal(0);
    });

    it("sells A when A is heavy", async () => {
      const { strategy, tokenA, router, config, fund } = await loadFixture(deployFixture);
      await fund(100, 100);

      const actions = await strategy.plan(await config());
      expect(actions.length).to.equal(2);
      expect(actions[0].target).to.equal(await tokenA.getAddress());

      const p = router.interface.decodeFunctionData("exactInputSingle", actions[1].data)[0];
      expect(p.tokenIn).to.equal(await tokenA.getAddress());
      // $50 of A at $2 is 25 whole A.
      expect(p.amountIn).to.equal(BigInt(25 * 10 ** DEC_A));
      expect(p.amountOutMinimum).to.be.greaterThan(0n);
    });

    it("buys A when A is light", async () => {
      // The direction the exit strategy has no concept of, which is the point.
      const { strategy, tokenA, tokenB, router, config, fund } = await loadFixture(deployFixture);
      await fund(25, 150);

      const actions = await strategy.plan(await config());
      const p = router.interface.decodeFunctionData("exactInputSingle", actions[1].data)[0];

      expect(p.tokenIn).to.equal(await tokenB.getAddress());
      expect(p.tokenOut).to.equal(await tokenA.getAddress());
      expect(p.amountIn).to.equal(BigInt(50 * 10 ** DEC_B));
    });

    it("declines a correction too small to pay for itself", async () => {
      // 28 A at $2 = $56 against $44 of B: 56% in A, so 600 bps of drift —
      // outside the 500 bps band. But restoring the target only moves $6,
      // against a $10 floor. Acting here makes the holder poorer while looking
      // busy.
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(28, 44);

      const p = await strategy.inspect(await config());
      expect(p.driftBps).to.be.greaterThan(BigInt(BAND));
      expect(p.tradeValue).to.be.lessThan(MIN_TRADE);

      expect((await strategy.plan(await config())).length).to.equal(0);
      expect((await strategy.explain(await config()))[0]).to.equal("drift too small to pay for itself");
    });

    it("refuses when the sources disagree, whichever way the drift points", async () => {
      const { strategy, pool, feed, config, fund } = await loadFixture(deployFixture);
      await fund(100, 100);
      await pool.setTick(Math.round(Math.log((1 / 3) * 10 ** (DEC_A - DEC_B)) / Math.log(1.0001)));

      expect((await strategy.plan(await config())).length).to.equal(0);
      expect((await strategy.explain(await config()))[0]).to.equal("sources disagree");
      expect(feed).to.not.equal(undefined);
    });

    it("does nothing with an empty vault", async () => {
      const { strategy, config } = await loadFixture(deployFixture);
      expect((await strategy.plan(await config())).length).to.equal(0);
      expect((await strategy.explain(await config()))[0]).to.equal("nothing held");
    });
  });

  // ----------------------------------------------------------------
  // Cadence
  // ----------------------------------------------------------------

  describe("cadence", () => {
    it("is calm when the drift is nowhere near the band", async () => {
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(50, 100);
      expect(await strategy.nextInterval(await config())).to.equal(CALM);
    });

    it("watches more closely as the drift approaches the band", async () => {
      // 52 A at $2 = $104 against $96 of B: 52% in A, so 200 bps of drift,
      // which is 40% of the way to the edge of the 500 bps band.
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(52, 96);
      expect(await strategy.nextInterval(await config())).to.equal(WATCHFUL);
    });

    it("checks often once the drift is outside the band", async () => {
      const { strategy, config, fund } = await loadFixture(deployFixture);
      await fund(100, 100);
      expect(await strategy.nextInterval(await config())).to.equal(CLOSE);
    });

    it("looks again soon when the sources disagree", async () => {
      const { strategy, pool, config, fund } = await loadFixture(deployFixture);
      await fund(50, 100);
      await pool.setTick(Math.round(Math.log((1 / 3) * 10 ** (DEC_A - DEC_B)) / Math.log(1.0001)));
      expect(await strategy.nextInterval(await config())).to.equal(DIVERGED);
    });
  });

  // ----------------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------------

  describe("configuration", () => {
    it("accepts a sound configuration", async () => {
      const { strategy, config } = await loadFixture(deployFixture);
      expect(await strategy.validateConfig(await config())).to.equal(true);
    });

    const bad: Array<[string, Record<string, unknown>]> = [
      ["a target of nothing", { targetBpsA: 0 }],
      ["a target of everything", { targetBpsA: 10_000 }],
      ["no band", { bandBps: 0 }],
      ["no minimum trade", { minTradeValue1e18: 0n }],
      ["no slippage bound", { slippageBps: 0n }],
    ];

    for (const [label, over] of bad) {
      it(`rejects ${label}`, async () => {
        const { strategy, config } = await loadFixture(deployFixture);
        expect(await strategy.validateConfig(await config(over))).to.equal(false);
      });
    }
  });

  // ----------------------------------------------------------------
  // End to end, on the same engine
  // ----------------------------------------------------------------

  it("rebalances itself on the same vault the exit strategy uses", async () => {
    const { vault, tokenA, router, feed, hss, config, fund } = await loadFixture(deployFixture);
    await fund(100, 100);

    await vault.configure(await config());
    await vault.arm();

    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await feed.setUpdatedAt(await time.latest());
    await expect(hss.fireLatest()).to.emit(vault, "Executed");

    expect(await router.swaps()).to.equal(1n);
    // 25 of the 100 A were sold.
    expect(await tokenA.balanceOf(await vault.getAddress())).to.equal(BigInt(75 * 10 ** DEC_A));
    expect(await hss.pendingCount()).to.equal(1n);
  });

  it("records a refusal with its reason when balanced", async () => {
    const { vault, feed, hss, config, fund } = await loadFixture(deployFixture);
    await fund(50, 100);

    await vault.configure(await config());
    await vault.arm();

    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await feed.setUpdatedAt(await time.latest());
    await expect(hss.fireLatest()).to.emit(vault, "Refused").withArgs(1n, "balanced", anyValue, anyValue);
  });
});
