import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { installMockScheduleService } from "./MockHederaScheduleService.test";
import {
  MockAggregator,
  MockSwapRouter,
  MockToken,
  MockV3Pool,
  NocturneVault,
  ProtectiveExitStrategy,
} from "../typechain-types";

/**
 * A position that leaves before things get worse, while its owner is asleep.
 *
 * Three behaviours are worth most of the attention here: it holds when it should
 * hold, it refuses when the two price sources disagree, and the interval it asks
 * for gets shorter as the floor gets nearer. The last of those is the thing
 * Hedera's own ScheduledVault cannot express.
 */
describe("ProtectiveExitStrategy", () => {
  const ONE_HBAR = 100_000_000n;
  const ASSET_DECIMALS = 8; // like WHBAR
  const QUOTE_DECIMALS = 6; // like USDC
  const FLOOR = ethers.parseEther("2.00");
  const SLIPPAGE_BPS = 100n; // 1%
  const HELD = 1_000_000_000n; // 10 asset tokens at 8dp

  // Cadence bands the strategy uses, mirrored here so the expectations read.
  const CALM = 6n * 3600n;
  const WATCHFUL = 3600n;
  const CLOSE = 300n;
  const IMMINENT = 60n;
  const EMPTY = 60n * 24n * 3600n;

  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const hss = await installMockScheduleService();

    const asset = (await (
      await ethers.getContractFactory("MockToken")
    ).deploy("Wrapped HBAR", "WHBAR", ASSET_DECIMALS)) as MockToken;
    const quote = (await (
      await ethers.getContractFactory("MockToken")
    ).deploy("USD Coin", "USDC", QUOTE_DECIMALS)) as MockToken;
    const pool = (await (
      await ethers.getContractFactory("MockV3Pool")
    ).deploy(await quote.getAddress(), await asset.getAddress())) as MockV3Pool;
    const feed = (await (await ethers.getContractFactory("MockAggregator")).deploy(0, 0)) as MockAggregator;
    const router = (await (
      await ethers.getContractFactory("MockSwapRouter")
    ).deploy(ethers.parseEther("2.50"))) as MockSwapRouter;
    const strategy = (await (
      await ethers.getContractFactory("ProtectiveExitStrategy")
    ).deploy()) as ProtectiveExitStrategy;

    for (const c of [asset, quote, pool, feed, router, strategy]) await c.waitForDeployment();

    const vault = (await (
      await ethers.getContractFactory("NocturneVault")
    ).deploy(await strategy.getAddress(), owner.address)) as NocturneVault;
    await vault.waitForDeployment();

    await owner.sendTransaction({ to: await vault.getAddress(), value: ONE_HBAR * 160n });
    await asset.mint(await vault.getAddress(), HELD);

    await vault.setAllowedCall(await asset.getAddress(), asset.interface.getFunction("approve")!.selector, true);
    await vault.setAllowedCall(
      await router.getAddress(),
      router.interface.getFunction("exactInputSingle")!.selector,
      true,
    );

    // Both sources start at $2.50, comfortably above the $2.00 floor.
    await setPrices(pool, feed, 2.5, 2.5);

    const config = async (over: Record<string, unknown> = {}) =>
      strategy.encodeConfig({
        vault: await vault.getAddress(),
        asset: await asset.getAddress(),
        quote: await quote.getAddress(),
        router: await router.getAddress(),
        fee: 3000,
        floorPrice1e18: FLOOR,
        slippageBps: SLIPPAGE_BPS,
        assetDecimals: ASSET_DECIMALS,
        quoteDecimals: QUOTE_DECIMALS,
        sources: {
          pool: await pool.getAddress(),
          twapWindow: 300,
          feed: await feed.getAddress(),
          maxFeedAge: 3600n,
          maxDivergenceBps: 200n,
          assetIsToken0: false,
          assetDecimals: ASSET_DECIMALS,
          quoteDecimals: QUOTE_DECIMALS,
        },
        ...over,
      });

    return { vault, strategy, asset, quote, pool, feed, router, hss, owner, config };
  }

  /**
   * Advance to the next run and refresh the feed before firing.
   *
   * The refresh is not cosmetic. Intervals here are hours, and `time.increaseTo`
   * jumps the clock the whole way — which leaves the Chainlink mock older than
   * `maxFeedAge`, so the vault refuses on staleness rather than on whatever the
   * test was actually trying to exercise. Caught this the hard way: a test that
   * looked like it proved "holds above the floor" was proving "refuses a stale
   * feed".
   */
  async function runDue(
    vault: NocturneVault,
    feed: MockAggregator,
    hss: Awaited<ReturnType<typeof installMockScheduleService>>,
  ) {
    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await feed.setUpdatedAt(await time.latest());
    return hss.fireLatest();
  }

  /** Point both sources at a price, in whole quote tokens per asset. */
  async function setPrices(pool: MockV3Pool, feed: MockAggregator, poolPrice: number, feedPrice: number) {
    await pool.setTick(tickFor(poolPrice));
    await feed.setAnswer(BigInt(Math.round(feedPrice * 1e8)));
    await feed.setUpdatedAt(await time.latest());
  }

  /**
   * The tick whose price is `price` quote per asset, for a pool where the asset
   * is token1 and decimals are 8/6.
   *
   * raw = token1/token0 = (1/price) * 10^assetDec / 10^quoteDec
   * tick = log(raw) / log(1.0001)
   */
  function tickFor(price: number): number {
    const raw = (1 / price) * 10 ** (ASSET_DECIMALS - QUOTE_DECIMALS);
    return Math.round(Math.log(raw) / Math.log(1.0001));
  }

  // ----------------------------------------------------------------
  // Deciding
  // ----------------------------------------------------------------

  describe("deciding", () => {
    it("holds while the price is above the floor", async () => {
      const { strategy, config } = await loadFixture(deployFixture);
      expect((await strategy.plan(await config())).length).to.equal(0);

      const [state, price, floor] = await strategy.explain(await config());
      expect(state).to.equal("holding");
      expect(price).to.be.greaterThan(floor);
    });

    it("plans an approve and a swap once the floor breaks", async () => {
      const { strategy, asset, router, vault, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 1.9, 1.9);

      const actions = await strategy.plan(await config());
      expect(actions.length).to.equal(2);

      expect(actions[0].target).to.equal(await asset.getAddress());
      expect(actions[0].data).to.equal(
        asset.interface.encodeFunctionData("approve", [await router.getAddress(), HELD]),
      );

      expect(actions[1].target).to.equal(await router.getAddress());
      const decoded = router.interface.decodeFunctionData("exactInputSingle", actions[1].data);
      expect(decoded[0].tokenIn).to.equal(await asset.getAddress());
      expect(decoded[0].recipient).to.equal(await vault.getAddress());
      expect(decoded[0].amountIn).to.equal(HELD);
    });

    it("refuses to sell when the two sources disagree", async () => {
      // The whole reason the guard exists. Price is below the floor, so a naive
      // stop-loss would fire; the sources are 20% apart, so this one does not.
      const { strategy, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 1.9, 2.4);

      expect((await strategy.plan(await config())).length).to.equal(0);

      const [state] = await strategy.explain(await config());
      expect(state).to.equal("sources disagree");
    });

    it("refuses to sell on a stale feed, even with the pool below the floor", async () => {
      const { strategy, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 1.9, 1.9);
      await feed.setUpdatedAt((await time.latest()) - 7200);

      expect((await strategy.plan(await config())).length).to.equal(0);
      expect((await strategy.explain(await config()))[0]).to.equal("feed stale");
    });

    it("does nothing when there is nothing to protect", async () => {
      const { strategy, vault, asset, owner, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 1.5, 1.5);
      await vault.withdrawToken(await asset.getAddress(), HELD);
      expect(await asset.balanceOf(owner.address)).to.equal(HELD);

      expect((await strategy.plan(await config())).length).to.equal(0);
      expect((await strategy.explain(await config()))[0]).to.equal("nothing held");
    });

    it("never plans a swap without a minimum output", async () => {
      // A scheduled swap with no floor under its output is a free option for
      // anyone watching the pool.
      const { strategy, router, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 1.9, 1.9);

      const actions = await strategy.plan(await config());
      const p = router.interface.decodeFunctionData("exactInputSingle", actions[1].data)[0];

      expect(p.amountOutMinimum).to.be.greaterThan(0n);

      // 10 assets at ~$1.90, less 1% slippage, in 6-decimal quote units.
      const expected = (10n * 1_900_000n * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      expect(p.amountOutMinimum).to.be.closeTo(expected, expected / 100n);
    });
  });

  // ----------------------------------------------------------------
  // Cadence — the part Hedera's own vault cannot express
  // ----------------------------------------------------------------

  describe("cadence", () => {
    const cases: Array<[string, number, bigint]> = [
      ["far above the floor", 2.5, CALM],
      ["within 15%", 2.2, WATCHFUL],
      ["within 5%", 2.08, CLOSE],
      ["within 1%", 2.005, IMMINENT],
      ["at or below the floor", 1.9, IMMINENT],
    ];

    for (const [label, price, expected] of cases) {
      it(`asks for ${expected}s when ${label}`, async () => {
        const { strategy, pool, feed, config } = await loadFixture(deployFixture);
        await setPrices(pool, feed, price, price);
        expect(await strategy.nextInterval(await config())).to.equal(expected);
      });
    }

    it("tightens monotonically as the floor approaches", async () => {
      const { strategy, pool, feed, config } = await loadFixture(deployFixture);
      let previous = ethers.MaxUint256;

      for (const price of [3.0, 2.5, 2.2, 2.08, 2.005, 1.99]) {
        await setPrices(pool, feed, price, price);
        const interval = await strategy.nextInterval(await config());
        expect(interval).to.be.lessThanOrEqual(previous);
        previous = interval;
      }
      expect(previous).to.equal(IMMINENT);
    });

    it("stops paying for checks once there is nothing left to protect", async () => {
      // After an exit the price is still below the floor. Without this the
      // vault would book a run every sixty seconds until its fuel ran out.
      const { strategy, vault, asset, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 1.5, 1.5);
      await vault.withdrawToken(await asset.getAddress(), HELD);

      expect(await strategy.nextInterval(await config())).to.equal(EMPTY);
      expect((await strategy.cadence(await config()))[1]).to.equal(EMPTY);
    });

    it("looks again soon when the sources disagree, rather than sleeping", async () => {
      // A divergence is information: something is moving or something is
      // broken, and neither answer is "sleep for six hours".
      const { strategy, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 3.0, 3.6);
      expect(await strategy.nextInterval(await config())).to.equal(CLOSE);
    });

    it("reports the distance behind its choice", async () => {
      const { strategy, pool, feed, config } = await loadFixture(deployFixture);
      await setPrices(pool, feed, 2.2, 2.2);

      const [distance, interval] = await strategy.cadence(await config());
      expect(interval).to.equal(WATCHFUL);
      expect(distance).to.be.closeTo(ethers.parseEther("0.10"), ethers.parseEther("0.005"));
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
      ["no floor", { floorPrice1e18: 0n }],
      ["no slippage bound", { slippageBps: 0n }],
      ["slippage of 100%", { slippageBps: 10_000n }],
      ["no vault", { vault: ethers.ZeroAddress }],
      ["no router", { router: ethers.ZeroAddress }],
    ];

    for (const [label, over] of bad) {
      it(`rejects ${label}`, async () => {
        const { strategy, config } = await loadFixture(deployFixture);
        expect(await strategy.validateConfig(await config(over))).to.equal(false);
      });
    }

    it("rejects selling a token for itself", async () => {
      const { strategy, asset, config } = await loadFixture(deployFixture);
      expect(await strategy.validateConfig(await config({ quote: await asset.getAddress() }))).to.equal(false);
    });
  });

  // ----------------------------------------------------------------
  // End to end
  // ----------------------------------------------------------------

  it("sells the position without the owner sending anything", async () => {
    // Arm, walk away, drop the price, and let the scheduler do the rest.
    const { vault, asset, quote, pool, feed, router, hss, config } = await loadFixture(deployFixture);

    await vault.configure(await config());
    await vault.arm();

    // First run: still above the floor, so it holds and asks again later.
    //
    // Asserted on the REASON, not just the count. A refusal count of one is
    // satisfied by "holding", by "feed stale", and by "sources disagree"
    // equally — which is how an earlier version of this test passed while
    // actually exercising a stale feed rather than a healthy hold.
    await expect(runDue(vault, feed, hss))
      .to.emit(vault, "Refused")
      .withArgs(1n, "holding", anyValue, anyValue);
    expect(await vault.runCount()).to.equal(1n);
    expect(await router.swaps()).to.equal(0n);

    // The price falls through the floor.
    await setPrices(pool, feed, 1.9, 1.9);
    await router.setPrice(ethers.parseEther("1.9"));

    // Nothing is reconfigured; the next scheduled run simply sees a new price.
    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await feed.setUpdatedAt(await time.latest());
    await expect(hss.fireLatest()).to.emit(vault, "Executed");

    expect(await router.swaps()).to.equal(1n);
    expect(await asset.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await quote.balanceOf(await vault.getAddress())).to.be.greaterThan(0n);

    // The successor was booked before the swap, while there was still a
    // position, so one more check follows. It finds nothing held and parks
    // the vault instead of checking every minute below a floor it has left.
    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await feed.setUpdatedAt(await time.latest());
    await expect(hss.fireLatest()).to.emit(vault, "Refused").withArgs(3n, "nothing held", 0n, 0n);

    expect(await hss.pendingCount()).to.equal(1n);
    expect((await vault.nextRunAt()) - BigInt(await time.latest())).to.be.closeTo(EMPTY, 10n);
  });

  it("refuses forever when maxFeedAge is shorter than the feed's own heartbeat", async () => {
    // The trap this suite walked into. A feed that legitimately updates slowly
    // — Chainlink pairs update on deviation as well as heartbeat, and USDC/USD
    // on Hedera testnet was 18.8 hours old when this was written — paired with
    // a tight maxFeedAge means every single check refuses, forever, and the
    // position is never protected at all.
    //
    // The vault keeps running and keeps saying why, which is the best it can
    // do. Recognising it is the operator's job, so the reason has to be exact.
    const { vault, pool, feed, hss, strategy, config } = await loadFixture(deployFixture);

    const cfg = await config({
      sources: {
        pool: await pool.getAddress(),
        twapWindow: 300,
        feed: await feed.getAddress(),
        maxFeedAge: 60n, // tighter than this feed will ever be
        maxDivergenceBps: 200n,
        assetIsToken0: false,
        assetDecimals: ASSET_DECIMALS,
        quoteDecimals: QUOTE_DECIMALS,
      },
    });
    await vault.configure(cfg);
    await vault.arm();

    await setPrices(pool, feed, 1.5, 1.5); // well below the floor
    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await expect(hss.fireLatest()).to.emit(vault, "Refused").withArgs(1n, "feed stale", anyValue, anyValue);

    expect(await vault.refusalCount()).to.equal(1n);
    expect((await strategy.explain(cfg))[0]).to.equal("feed stale");
    // Still alive and still trying, which is the only sane behaviour here.
    expect(await hss.pendingCount()).to.equal(1n);
  });

  it("does not sell when the swap would return too little", async () => {
    // The router pays 5% below the quoted price; the plan allows 1%. The swap
    // reverts, the vault records it, and the position is untouched.
    const { vault, asset, pool, feed, router, hss, config } = await loadFixture(deployFixture);
    await vault.configure(await config());
    await vault.arm();

    await router.setPrice(ethers.parseEther("1.9"));
    await router.setSlippageBps(500);

    await time.increaseTo((await vault.nextRunAt()) + 1n);
    await setPrices(pool, feed, 1.9, 1.9);
    await expect(hss.fireLatest()).to.emit(vault, "ActionFailed");

    expect(await router.swaps()).to.equal(0n);
    expect(await asset.balanceOf(await vault.getAddress())).to.equal(HELD);

    // A stopped plan is a partly executed plan. The approve landed before the
    // swap reverted, so the vault is left holding an allowance the size of the
    // position. Pinned because it is a real property of the design rather than
    // an accident: the allowance can only ever point at the configured router,
    // and the next run's approve overwrites it. See `_execute`.
    expect(await asset.allowance(await vault.getAddress(), await router.getAddress())).to.equal(HELD);

    // Chain intact: it will try again.
    expect(await hss.pendingCount()).to.equal(1n);
  });
});
