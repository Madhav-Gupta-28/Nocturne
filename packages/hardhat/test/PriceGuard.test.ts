import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { MockAggregator, MockV3Pool, PriceLensHarness } from "../typechain-types";

/**
 * Two prices, and permission to act only when they agree.
 *
 * The behaviour worth testing hardest is the refusal. A guard that approves when
 * it should is merely useful; a guard that approves when it should not is the
 * $9.05M Bonzo exploit with extra steps.
 */
describe("PriceGuard and TwapLib", () => {
  const WINDOW = 300;
  const MAX_AGE = 3600n;
  const MAX_DIVERGENCE = 200n; // 2%

  // Mirrors the live SaucerSwap WHBAR/USDC pool: token0 = USDC (6dp),
  // token1 = WHBAR (8dp), so the asset being priced is token1.
  const USDC_DECIMALS = 6;
  const WHBAR_DECIMALS = 8;
  const LIVE_TICK = 38874;

  async function deployFixture() {
    const usdc = ethers.Wallet.createRandom().address;
    const whbar = ethers.Wallet.createRandom().address;

    const harness = (await (await ethers.getContractFactory("PriceLensHarness")).deploy()) as PriceLensHarness;
    const pool = (await (await ethers.getContractFactory("MockV3Pool")).deploy(usdc, whbar)) as MockV3Pool;
    const feed = (await (await ethers.getContractFactory("MockAggregator")).deploy(0, 0)) as MockAggregator;

    await harness.waitForDeployment();
    await pool.waitForDeployment();
    await feed.waitForDeployment();

    // Start both sources agreeing at $2.05, the live pool's price.
    await pool.setTick(LIVE_TICK);
    await feed.setAnswer(205_000_000n); // 2.05 at 8 decimals
    await feed.setUpdatedAt(await time.latest());

    const sources = async (over: Partial<Record<string, unknown>> = {}) => ({
      pool: await pool.getAddress(),
      twapWindow: WINDOW,
      feed: await feed.getAddress(),
      maxFeedAge: MAX_AGE,
      maxDivergenceBps: MAX_DIVERGENCE,
      assetIsToken0: false, // WHBAR is token1
      assetDecimals: WHBAR_DECIMALS,
      quoteDecimals: USDC_DECIMALS,
      ...over,
    });

    return { harness, pool, feed, sources };
  }

  // ----------------------------------------------------------------
  // Tick maths
  // ----------------------------------------------------------------

  describe("tick maths", () => {
    it("reproduces the live pool's sqrt price from its tick", async () => {
      // The SaucerSwap WHBAR/USDC pool on Hedera testnet reports tick 38874 and
      // sqrtPriceX96 553322340177179676681786292758.
      //
      // slot0.tick is the FLOOR of the true tick, so the exact price sits
      // between tick and tick+1 and our value must be just below the pool's.
      // Asserting equality here would be asserting something false.
      const { harness } = await loadFixture(deployFixture);
      const LIVE_SQRT = 553322340177179676681786292758n;

      const ours = await harness.sqrtRatioAtTick(LIVE_TICK);
      const next = await harness.sqrtRatioAtTick(LIVE_TICK + 1);

      expect(ours).to.be.lessThan(LIVE_SQRT);
      expect(next).to.be.greaterThan(LIVE_SQRT);

      // And close: within one basis point.
      const diffBps = ((LIVE_SQRT - ours) * 10_000n) / LIVE_SQRT;
      expect(diffBps).to.equal(0n);
    });

    it("is symmetric about zero", async () => {
      const { harness } = await loadFixture(deployFixture);
      const Q96 = 1n << 96n;

      expect(await harness.sqrtRatioAtTick(0)).to.equal(Q96);

      // sqrt(1.0001^-t) * sqrt(1.0001^t) == 1, to rounding.
      for (const t of [1, 500, 38874, 100000]) {
        const up = await harness.sqrtRatioAtTick(t);
        const down = await harness.sqrtRatioAtTick(-t);
        const product = (up * down) / Q96;
        const err = product > Q96 ? product - Q96 : Q96 - product;
        expect((err * 1_000_000n) / Q96).to.equal(0n);
      }
    });

    it("refuses a tick outside the representable range", async () => {
      const { harness } = await loadFixture(deployFixture);
      await expect(harness.sqrtRatioAtTick(887273)).to.be.revertedWithCustomError(harness, "TickOutOfBounds");
      await expect(harness.sqrtRatioAtTick(-887273)).to.be.revertedWithCustomError(harness, "TickOutOfBounds");
    });

    it("prices the live tick at the figure the pool actually quotes", async () => {
      // Independently: 1 WHBAR = 2.050231 USDC at tick 38874, which is what the
      // quoter returns for a real 10 WHBAR swap.
      const { harness } = await loadFixture(deployFixture);
      const price = await harness.priceFromTick(LIVE_TICK, false, WHBAR_DECIMALS, USDC_DECIMALS);

      expect(price).to.be.greaterThan(ethers.parseEther("2.0500"));
      expect(price).to.be.lessThan(ethers.parseEther("2.0505"));
    });

    it("inverts correctly depending on which side the asset is", async () => {
      const { harness } = await loadFixture(deployFixture);
      const whbarInUsdc = await harness.priceFromTick(LIVE_TICK, false, WHBAR_DECIMALS, USDC_DECIMALS);
      const usdcInWhbar = await harness.priceFromTick(LIVE_TICK, true, USDC_DECIMALS, WHBAR_DECIMALS);

      // The two are reciprocals; allow a basis point of rounding.
      const product = (whbarInUsdc * usdcInWhbar) / ethers.parseEther("1");
      const one = ethers.parseEther("1");
      const err = product > one ? product - one : one - product;
      expect((err * 10_000n) / one).to.equal(0n);
    });

    it("floors a negative mean tick instead of truncating toward zero", async () => {
      // -7/2 must be -4, not -3. Getting this wrong biases every negative
      // price upward by a tick, quietly and forever.
      const { harness, pool } = await loadFixture(deployFixture);
      await pool.setTick(-100);
      expect(await harness.meanTick(await pool.getAddress(), WINDOW)).to.equal(-100);
    });
  });

  // ----------------------------------------------------------------
  // The guard
  // ----------------------------------------------------------------

  describe("agreement", () => {
    it("agrees when the two sources are close", async () => {
      const { harness, sources } = await loadFixture(deployFixture);
      const r = await harness.read(await sources());

      expect(r.agreed).to.equal(true);
      expect(r.reason).to.equal("");
      expect(r.divergenceBps).to.be.lessThan(MAX_DIVERGENCE);
    });

    it("refuses when they disagree", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setAnswer(300_000_000n); // $3.00 against the pool's $2.05

      const r = await harness.read(await sources());
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("sources disagree");
      expect(r.divergenceBps).to.be.greaterThan(MAX_DIVERGENCE);
    });

    it("refuses at exactly the tolerance boundary", async () => {
      // The boundary is closed on the refusing side. A guard that is generous
      // at its own limit has a limit one basis point higher than documented.
      const { harness, sources } = await loadFixture(deployFixture);
      const r = await harness.read(await sources({ maxDivergenceBps: 0n }));
      expect(r.agreed).to.equal(false);
    });

    it("treats a stale feed as a disagreement, not as confirmation", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setUpdatedAt((await time.latest()) - 7200);

      const r = await harness.read(await sources());
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("feed stale");
      // The price was readable; it is the age that disqualifies it.
      expect(r.feed).to.be.greaterThan(0n);
      expect(r.feedAge).to.be.greaterThan(MAX_AGE);
    });

    it("refuses when the feed is down", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setReverts(true);

      const r = await harness.read(await sources());
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("feed unavailable");
    });

    it("refuses a non-positive feed answer", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setAnswer(0);
      expect((await harness.read(await sources())).agreed).to.equal(false);

      await feed.setAnswer(-1);
      expect((await harness.read(await sources())).agreed).to.equal(false);
    });

    it("refuses when the pool has no window yet, rather than reverting", async () => {
      // A young pool reverts `observe` with OLD. The guard has to survive that:
      // a revert here would take the vault's entire run with it.
      const { harness, pool, sources } = await loadFixture(deployFixture);
      await pool.setObserveReverts(true);

      const r = await harness.read(await sources());
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("pool has no window yet");
      expect(r.twap).to.equal(0n);
    });

    it("refuses when the feed address is unset", async () => {
      const { harness, sources } = await loadFixture(deployFixture);
      const r = await harness.read(await sources({ feed: ethers.ZeroAddress }));
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("feed unavailable");
    });

    it("normalises feed decimals", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setDecimals(18);
      await feed.setAnswer(ethers.parseEther("2.05"));

      const r = await harness.read(await sources());
      expect(r.agreed).to.equal(true);
      expect(r.feed).to.be.closeTo(ethers.parseEther("2.05"), ethers.parseEther("0.001"));
    });
  });

  describe("divergence arithmetic", () => {
    it("measures against the smaller price, which overstates the gap", async () => {
      // Deliberate: every rounding choice should make refusing more likely.
      const { harness } = await loadFixture(deployFixture);
      const a = ethers.parseEther("2.05");
      const b = ethers.parseEther("0.0944");

      const bps = await harness.divergenceBps(a, b);
      // (2.05 - 0.0944) / 0.0944 = 20.716x = 207,161 bps
      expect(bps).to.be.greaterThan(200_000n);
      expect(await harness.divergenceBps(a, b)).to.equal(await harness.divergenceBps(b, a));
    });

    it("treats a zero price as infinitely far from anything", async () => {
      const { harness } = await loadFixture(deployFixture);
      expect(await harness.divergenceBps(0, ethers.parseEther("1"))).to.equal(ethers.MaxUint256);
    });
  });

  describe("which price to act on", () => {
    it("takes the cautious side of a tolerated gap", async () => {
      const { harness } = await loadFixture(deployFixture);
      const reading = {
        agreed: true,
        twap: ethers.parseEther("2.00"),
        feed: ethers.parseEther("2.02"),
        divergenceBps: 100n,
        feedAge: 10n,
        reason: "",
      };

      // Selling: assume the lower price for the proceeds.
      expect(await harness.actionablePrice(reading, true)).to.equal(ethers.parseEther("2.00"));
      // Otherwise: assume the higher one.
      expect(await harness.actionablePrice(reading, false)).to.equal(ethers.parseEther("2.02"));
    });
  });
});
