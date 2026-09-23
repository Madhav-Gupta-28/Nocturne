import { expect } from "chai";
import { ethers } from "hardhat";
import { PriceLensHarness } from "../../typechain-types";

/**
 * The guard, against the real thing.
 *
 *   npm run test:live -w @sh/hardhat
 *
 * Runs against Hedera testnet itself, not a fork, so the pool and feed below are
 * the actual deployments rather than mocks. That matters because the mocks agree
 * with my understanding of these contracts by construction, and the point of
 * this file is to check that understanding.
 *
 * Not a fork, deliberately: `observe()` does not answer through the forking
 * plugin — the pool's observation array does not survive the fork, and every
 * window comes back as OLD. `slot0` and the Chainlink feed both read fine
 * forked, which makes the gap easy to miss. Needs a funded testnet account; the
 * offline suite does not.
 *
 * It is also the clearest demonstration of what the guard is for. On testnet the
 * SaucerSwap WHBAR/USDC pool prices HBAR at about $2.05 while Chainlink says
 * about $0.094 — roughly 21.7x apart.
 *
 * That gap is honest about its cause: nobody arbitrages testnet pools, so the
 * pool has drifted and stayed drifted. It is not an attack. But it is exactly
 * what a bad price looks like from inside a contract, and a strategy trading on
 * the pool price alone would sell into it without hesitating.
 */
describe("PriceGuard against live Hedera testnet", function () {
  this.timeout(180_000);

  // Verified 2026-09-22/23 on Hedera testnet.
  const POOL = "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a"; // SaucerSwap V2 WHBAR/USDC, 0.3%
  const HBAR_USD = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a"; // Chainlink HBAR/USD

  const USDC_DECIMALS = 6; // token0
  const WHBAR_DECIMALS = 8; // token1

  let harness: PriceLensHarness;

  before(async () => {
    harness = (await (await ethers.getContractFactory("PriceLensHarness")).deploy()) as PriceLensHarness;
    await harness.waitForDeployment();
  });

  const sources = (over: Record<string, unknown> = {}) => ({
    pool: POOL,
    twapWindow: 60,
    feed: HBAR_USD,
    maxFeedAge: 86_400n, // generous: HBAR/USD updates on deviation as well as heartbeat
    maxDivergenceBps: 200n,
    assetIsToken0: false,
    assetDecimals: WHBAR_DECIMALS,
    quoteDecimals: USDC_DECIMALS,
    ...over,
  });

  it("reads a TWAP from the real pool", async () => {
    // observe() answers at observationCardinality 1 for a window short enough
    // to sit inside the current observation, which is why 60 seconds works on a
    // pool nobody has grown the oracle on.
    const [ok, price] = await harness.tryTwapPrice(POOL, 60, false, WHBAR_DECIMALS, USDC_DECIMALS);

    expect(ok).to.equal(true);
    console.log(`      pool TWAP(60s)  $${ethers.formatEther(price)}`);
    expect(price).to.be.greaterThan(0n);
  });

  it("reads a price from the real Chainlink feed", async () => {
    const feed = await ethers.getContractAt("AggregatorV3Interface", HBAR_USD);
    const [, answer, , updatedAt] = await feed.latestRoundData();

    console.log(`      chainlink       $${ethers.formatUnits(answer, await feed.decimals())}`);
    console.log(`      description     ${await feed.description()}`);
    expect(answer).to.be.greaterThan(0n);
    expect(updatedAt).to.be.greaterThan(0n);
  });

  it("REFUSES to act, because the two sources are far apart", async () => {
    // The assertion the whole library exists for.
    const r = await harness.read(sources());

    console.log(`      pool   $${ethers.formatEther(r.twap)}`);
    console.log(`      feed   $${ethers.formatEther(r.feed)}`);
    console.log(`      apart  ${r.divergenceBps} bps  (${Number(r.divergenceBps) / 10_000}x)`);
    console.log(`      reason ${r.reason}`);

    expect(r.agreed).to.equal(false);
    expect(r.reason).to.equal("sources disagree");

    // Both sources answered; it is the distance between them that stops it.
    expect(r.twap).to.be.greaterThan(0n);
    expect(r.feed).to.be.greaterThan(0n);

    // Around 21.7x apart when this was written. Asserted loosely, because the
    // pool can move and the point is the order of magnitude, not the figure.
    expect(r.divergenceBps).to.be.greaterThan(50_000n);
  });

  it("would agree if the tolerance were absurd, which is the control", async () => {
    // Proves the refusal above comes from the divergence rule and not from a
    // pool that cannot answer or a feed that is down. Nobody would ever
    // configure this.
    const r = await harness.read(sources({ maxDivergenceBps: 10_000_000n }));

    expect(r.agreed).to.equal(true);
    expect(r.reason).to.equal("");
  });

  it("derives the same sqrt price the pool reports for its own tick", async () => {
    const pool = await ethers.getContractAt("IUniswapV3PoolOracle", POOL);
    const [sqrtPriceX96, tick] = await pool.slot0();

    const ours = await harness.sqrtRatioAtTick(tick);
    const next = await harness.sqrtRatioAtTick(tick + 1n);

    console.log(`      pool tick ${tick}  sqrtP ${sqrtPriceX96}`);
    console.log(`      ours      ${ours}`);

    // slot0.tick is floored, so the pool's exact sqrt price sits in [tick, tick+1).
    expect(ours).to.be.lessThanOrEqual(sqrtPriceX96);
    expect(next).to.be.greaterThan(sqrtPriceX96);
  });
});
