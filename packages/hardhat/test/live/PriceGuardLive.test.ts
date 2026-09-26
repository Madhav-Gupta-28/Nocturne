import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AggregatorV3Interface__factory,
  IUniswapV3PoolOracle__factory,
  PriceLens__factory,
} from "../../typechain-types";

/**
 * The guard, against the real thing.
 *
 *   npm run hardhat:test:live
 *
 * Runs against Hedera testnet itself, not a fork, so the pool and feed below are
 * the actual deployments rather than mocks. That matters because the mocks agree
 * with my understanding of these contracts by construction, and the point of
 * this file is to check that understanding.
 *
 * Not a fork, deliberately: `observe()` does not answer through the forking
 * plugin — the pool's observation array does not survive the fork, and every
 * window comes back as OLD. `slot0` and the Chainlink feed both read fine
 * forked, which makes the gap easy to miss.
 *
 * **Needs no key and no HBAR.** Every call is an `eth_call` against the
 * `PriceLens` already deployed and Sourcify-verified on testnet — the same
 * `PriceGuard` code a vault runs, behind a view-only address. Nothing is sent,
 * so nothing is paid, and the result is the same for whoever runs it.
 *
 * It is also the clearest demonstration of what the guard is for. On testnet the
 * SaucerSwap WHBAR/USDC pool prices HBAR at about $2.04 while Chainlink says
 * about $0.09 — roughly 20x apart.
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
  const LENS = "0x7F017Bd04879389b2A9CEeD5941EeE75aD28cCdb"; // PriceLens, this template's deployment

  const USDC_DECIMALS = 6; // token0
  const WHBAR_DECIMALS = 8; // token1

  // Bound to the provider, not a signer: reads only, from nobody in particular.
  const lens = PriceLens__factory.connect(LENS, ethers.provider);

  /** The configuration the WHBAR exit vault was armed with, 30-minute TWAP included. */
  const sources = (over: Record<string, unknown> = {}) => ({
    pool: POOL,
    twapWindow: 1800,
    feed: HBAR_USD,
    maxFeedAge: 86_400n, // generous: HBAR/USD updates on deviation as well as heartbeat
    maxDivergenceBps: 200n,
    assetIsToken0: false,
    assetDecimals: WHBAR_DECIMALS,
    quoteDecimals: USDC_DECIMALS,
    ...over,
  });

  /** Tolerance wide enough that only a dead source can refuse. */
  const ABSURD = 10_000_000n;

  it("reads a 30-minute TWAP from the real pool", async () => {
    const r = await lens.read(sources({ maxDivergenceBps: ABSURD }));

    console.log(`      pool TWAP(30m)  $${ethers.formatEther(r.twap)}`);
    expect(r.twap).to.be.greaterThan(0n);
  });

  it("reads a price from the real Chainlink feed", async () => {
    const feed = AggregatorV3Interface__factory.connect(HBAR_USD, ethers.provider);
    const [, answer, , updatedAt] = await feed.latestRoundData();

    console.log(`      chainlink       $${ethers.formatUnits(answer, await feed.decimals())}`);
    console.log(`      description     ${await feed.description()}`);
    expect(answer).to.be.greaterThan(0n);
    expect(updatedAt).to.be.greaterThan(0n);
  });

  it("REFUSES to act, because the two sources are far apart", async () => {
    // The assertion the whole library exists for.
    const r = await lens.read(sources());

    console.log(`      pool   $${ethers.formatEther(r.twap)}`);
    console.log(`      feed   $${ethers.formatEther(r.feed)}`);
    console.log(`      apart  ${r.divergenceBps} bps  (${Number(r.divergenceBps) / 10_000}x)`);
    console.log(`      reason ${r.reason}`);

    expect(r.agreed).to.equal(false);
    expect(r.reason).to.equal("sources disagree");

    // Both sources answered; it is the distance between them that stops it.
    expect(r.twap).to.be.greaterThan(0n);
    expect(r.feed).to.be.greaterThan(0n);

    // Around 22x apart when this was written. Asserted loosely, because the
    // pool can move and the point is the order of magnitude, not the figure.
    expect(r.divergenceBps).to.be.greaterThan(50_000n);
  });

  it("would agree if the tolerance were absurd, which is the control", async () => {
    // Proves the refusal above comes from the divergence rule and not from a
    // pool that cannot answer or a feed that is down. Nobody would ever
    // configure this.
    const r = await lens.read(sources({ maxDivergenceBps: ABSURD }));

    expect(r.agreed).to.equal(true);
    expect(r.reason).to.equal("");
  });

  it("prices the pool the way the pool prices itself", async () => {
    // Our TickMath and decimal scaling, checked against the pool's own
    // sqrtPriceX96, converted here in plain bigint arithmetic that shares no
    // code with the contracts. A one-minute TWAP on a pool nobody trades sits
    // on the spot price; a bug in either path would miss by orders of magnitude.
    const pool = IUniswapV3PoolOracle__factory.connect(POOL, ethers.provider);
    const [sqrtPriceX96, tick] = await pool.slot0();

    // token1 per token0 in raw units is sqrtP^2 / 2^192. WHBAR is token1, so
    // USDC per WHBAR is the inverse, rescaled by 10^(8 - 6), in 1e18.
    const spot = (2n ** 192n * 10n ** 18n * 10n ** BigInt(WHBAR_DECIMALS - USDC_DECIMALS)) / sqrtPriceX96 ** 2n;
    const r = await lens.read(sources({ twapWindow: 60, maxDivergenceBps: ABSURD }));

    console.log(`      pool tick ${tick}  spot $${ethers.formatEther(spot)}`);
    console.log(`      ours (60s TWAP)       $${ethers.formatEther(r.twap)}`);

    const gap = r.twap > spot ? r.twap - spot : spot - r.twap;
    expect((gap * 10_000n) / spot).to.be.lessThan(100n); // within 1%
  });
});
