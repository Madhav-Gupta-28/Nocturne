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
      const p = await pool.getAddress();
      await pool.setRawCumulatives(0, -7);
      expect(await harness.meanTick(p, 2)).to.equal(-4);

      // The non-reverting path the guard actually uses must floor the same way.
      const [ok, price] = await harness.tryTwapPrice(p, 2, false, WHBAR_DECIMALS, USDC_DECIMALS);
      expect(ok).to.equal(true);
      expect(price).to.equal(await harness.priceFromTick(-4, false, WHBAR_DECIMALS, USDC_DECIMALS));

      // An exact negative mean is left alone: -8/2 is -4, not -5.
      await pool.setRawCumulatives(0, -8);
      expect(await harness.meanTick(p, 2)).to.equal(-4);
    });

    it("rejects a zero window, loudly on one path and quietly on the other", async () => {
      const { harness, pool } = await loadFixture(deployFixture);
      const p = await pool.getAddress();
      await expect(harness.meanTick(p, 0)).to.be.revertedWithCustomError(harness, "WindowTooShort");
      expect(await harness.tryTwapPrice(p, 0, false, WHBAR_DECIMALS, USDC_DECIMALS)).to.deep.equal([false, 0n]);
    });

    it("reports no price from a pool that is not a pool", async () => {
      // An address with no code answers every staticcall with success and no
      // data. Decoding that would revert; the guard has to see it as silence.
      const { harness, pool } = await loadFixture(deployFixture);
      const nobody = ethers.Wallet.createRandom().address;
      expect(await harness.tryTwapPrice(nobody, WINDOW, false, 8, 6)).to.deep.equal([false, 0n]);

      // And a pool that answers with fewer than two observations.
      await pool.setShort(true);
      expect(await harness.tryTwapPrice(await pool.getAddress(), WINDOW, false, 8, 6)).to.deep.equal([false, 0n]);
    });

    it("prices spot from the pool's current tick, and TWAP from its mean", async () => {
      const { harness, pool } = await loadFixture(deployFixture);
      // The mock pool holds one tick for the whole window, so the two agree.
      expect(await harness.twapPrice(await pool.getAddress(), WINDOW, false, WHBAR_DECIMALS, USDC_DECIMALS)).to.equal(
        await harness.priceFromTick(LIVE_TICK, false, WHBAR_DECIMALS, USDC_DECIMALS),
      );
      expect(await harness.spotPrice(await pool.getAddress(), false, WHBAR_DECIMALS, USDC_DECIMALS)).to.equal(
        await harness.priceFromTick(LIVE_TICK, false, WHBAR_DECIMALS, USDC_DECIMALS),
      );
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

      // More than 18 decimals scales down rather than up.
      await feed.setDecimals(20);
      await feed.setAnswer(ethers.parseUnits("2.05", 20));
      expect((await harness.read(await sources())).feed).to.equal(ethers.parseEther("2.05"));
    });

    it("refuses a feed that has never reported", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setUpdatedAt(0);
      const r = await harness.read(await sources());
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("feed unavailable");
    });

    it("reads a feed timestamped ahead of the block as fresh, not as an underflow", async () => {
      // Hedera's consensus clock and a feed's own can disagree by a second or
      // two. That must read as age zero, never revert.
      const { harness, feed, sources } = await loadFixture(deployFixture);
      await feed.setUpdatedAt((await time.latest()) + 60);
      const r = await harness.read(await sources());
      expect(r.feedAge).to.equal(0n);
      expect(r.agreed).to.equal(true);
    });

    it("refuses a pool that prices the asset at zero", async () => {
      // At the bottom of the tick range, with an 18-decimal quote and a 0-decimal
      // asset, the price rounds to nothing. Zero is not a price to compare.
      const { harness, pool, sources } = await loadFixture(deployFixture);
      await pool.setTick(-887272);
      const r = await harness.read(await sources({ assetIsToken0: true, assetDecimals: 0, quoteDecimals: 18 }));
      expect(r.twap).to.equal(0n);
      expect(r.agreed).to.equal(false);
      expect(r.reason).to.equal("pool price is zero");
    });
  });

  describe("PriceLens", () => {
    it("shows the same reading a strategy would act on, without a vault", async () => {
      const { harness, feed, sources } = await loadFixture(deployFixture);
      const lens = await (await ethers.getContractFactory("PriceLens")).deploy();

      const direct = await harness.read(await sources());
      const viaLens = await lens.read(await sources());
      expect(viaLens.agreed).to.equal(true);
      expect(viaLens.twap).to.equal(direct.twap);
      expect(viaLens.feed).to.equal(direct.feed);

      // And the refusal, with its reason, which is the point of the contract.
      await feed.setAnswer(300_000_000n);
      const refused = await lens.read(await sources());
      expect(refused.agreed).to.equal(false);
      expect(refused.reason).to.equal("sources disagree");

      // Selling takes the lower price, buying the higher.
      const lo = viaLens.twap < viaLens.feed ? viaLens.twap : viaLens.feed;
      const hi = viaLens.twap < viaLens.feed ? viaLens.feed : viaLens.twap;
      // Results come back frozen, and the encoder needs a plain copy.
      const { agreed, twap, feed: feedPrice, divergenceBps, feedAge, reason } = viaLens;
      const reading = { agreed, twap, feed: feedPrice, divergenceBps, feedAge, reason };
      expect(await lens.actionablePrice(reading, true)).to.equal(lo);
      expect(await lens.actionablePrice(reading, false)).to.equal(hi);
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

describe("PriceGuard when a source misbehaves", () => {
  /**
   * The library promises that every way a source can fail comes back as
   * `agreed == false` with a reason. Solidity's try/catch only covers the call
   * in the `try` expression, not the statements in its success block, so a
   * second call made while handling the first escapes unless it is wrapped too.
   *
   * It matters more than it looks. `plan` reverting is survivable — the vault
   * catches it — but `nextInterval` reverting falls back to MAX_INTERVAL, which
   * silently drops a vault from checking every few minutes to every 60 days.
   */
  it("reports a reason when the feed reverts on decimals()", async () => {
    const lens = await (await ethers.getContractFactory("PriceLensHarness")).deploy();
    const pool = await (
      await ethers.getContractFactory("MockV3Pool")
    ).deploy("0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002");
    const feed = await (await ethers.getContractFactory("BadDecimalsFeed")).deploy();
    await pool.setTick(0);

    const reading = await lens.read({
      pool: await pool.getAddress(),
      twapWindow: 60,
      feed: await feed.getAddress(),
      maxFeedAge: 86_400n,
      maxDivergenceBps: 200n,
      assetIsToken0: false,
      assetDecimals: 8,
      quoteDecimals: 6,
    });

    expect(reading.agreed).to.equal(false);
    expect(reading.reason).to.equal("feed unavailable");
  });
});
