import { ethers } from "hardhat";

/**
 * Testnet addresses and the one awkward step every demo script shares: getting
 * the owner holding the token it is about to hand a vault.
 *
 * Verified on testnet — see ARCHITECTURE.md §3.5 and §3.6. USDC is token0 on
 * both pools below, so every asset here is token1.
 */
export const WHBAR = "0x0000000000000000000000000000000000003aD2"; // HTS, 8 dp
export const WHBAR_WRAPPER = "0x0000000000000000000000000000000000003aD1"; // deposit()
export const USDC = "0x0000000000000000000000000000000000001549"; // HTS, 6 dp
export const DAI = "0x0000000000000000000000000000000000001599"; // HTS, 8 dp
export const ROUTER = "0x0000000000000000000000000000000000159398"; // SaucerSwap V2 SwapRouter
export const HTS = "0x0000000000000000000000000000000000000167";

export const USDC_DECIMALS = 6;

/**
 * The network gas price, to send as a legacy `gasPrice`.
 *
 * By default ethers sends EIP-1559 fees with `maxFeePerGas` at about twice the
 * network price, and the relay will not submit unless the sender holds
 * `maxFeePerGas x gasLimit`. For `createVault` (4M gas) that is ~8.7 HBAR of
 * headroom instead of ~4.6. The charge is the same either way.
 */
export async function networkGasPrice(): Promise<bigint> {
  return (await ethers.provider.getFeeData()).gasPrice ?? 0n;
}

export type Pair = {
  label: string;
  asset: string;
  assetDecimals: number;
  pool: string;
  fee: number;
  feed: string;
  /**
   * Longer than the feed's heartbeat, or the vault refuses "feed stale" for a
   * stretch of every cycle. DAI/USD updates every 24h and was measured landing
   * up to 36s late, so 24h exactly would not do.
   */
  maxFeedAge: bigint;
};

export const PAIRS = {
  whbar: {
    label: "WHBAR",
    asset: WHBAR,
    assetDecimals: 8,
    pool: "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a", // USDC/WHBAR 0.30%, ~22x off Chainlink
    fee: 3000,
    feed: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a", // Chainlink HBAR/USD
    maxFeedAge: 86_400n, // HBAR/USD also updates on deviation
  },
  dai: {
    label: "DAI",
    asset: DAI,
    assetDecimals: 8,
    pool: "0xb431866114b634f611774ec0d094bf11cb91c7e4", // USDC/DAI 0.05%, on its peg
    fee: 500,
    feed: "0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389", // Chainlink DAI/USD
    maxFeedAge: 90_000n,
  },
} satisfies Record<string, Pair>;

/** Associate `tokens` with the signer, ignoring "already associated". */
export async function associateOwner(tokens: string[]) {
  const [owner] = await ethers.getSigners();
  const hts = await ethers.getContractAt("IHederaTokenService", HTS);
  for (const token of tokens) {
    try {
      await (await hts.associateToken(owner.address, token, { gasLimit: 800_000 })).wait();
    } catch {
      // New accounts auto-associate on arrival, so this is belt and braces: it
      // covers an account created with limited slots, and reverts harmlessly
      // once the token is already associated.
    }
  }
}

/**
 * Make sure the signer holds at least `amount` of the pair's asset.
 *
 * WHBAR is wrapped from HBAR. DAI has no faucet, so it is bought: `hbar` HBAR
 * is wrapped, sold for USDC on the WHBAR/USDC pool, and the USDC sold for DAI.
 * The first leg rides the testnet pool's inflated WHBAR price, which makes a
 * stablecoin cheap to come by.
 */
export async function acquire(p: Pair, amount: bigint, hbar: string) {
  const [owner] = await ethers.getSigners();
  await associateOwner(p.asset === WHBAR ? [WHBAR] : [WHBAR, USDC, p.asset]);

  const asset = await ethers.getContractAt("IERC20", p.asset);
  if ((await asset.balanceOf(owner.address)) >= amount) return;

  const wrapper = new ethers.Contract(WHBAR_WRAPPER, ["function deposit() payable"], owner);
  // Weibar over JSON-RPC; the relay divides by 1e10 on the way in.
  await (await wrapper.deposit({ value: ethers.parseEther(hbar), gasLimit: 800_000 })).wait();
  if (p.asset === WHBAR) return;

  const router = await ethers.getContractAt("ISwapRouter", ROUTER);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 300);
  const swap = async (tokenIn: string, tokenOut: string, fee: number, amountIn: bigint, minOut: bigint) => {
    const token = await ethers.getContractAt("IERC20", tokenIn);
    await (await token.approve(ROUTER, amountIn, { gasLimit: 800_000 })).wait();
    await (
      await router.exactInputSingle(
        {
          tokenIn,
          tokenOut,
          fee,
          recipient: owner.address,
          deadline: deadline(),
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
        { gasLimit: 2_000_000 },
      )
    ).wait();
  };

  await swap(WHBAR, USDC, 3000, ethers.parseUnits(hbar, 8), 1n);

  const usdc = await ethers.getContractAt("IERC20", USDC);
  const usdcIn = await usdc.balanceOf(owner.address);
  // DAI sits within a fraction of a percent of USDC; demand at least 98%.
  const minOut = (usdcIn * 98n * 10n ** BigInt(p.assetDecimals - USDC_DECIMALS)) / 100n;
  await swap(USDC, p.asset, p.fee, usdcIn, minOut);

  if ((await asset.balanceOf(owner.address)) < amount) throw new Error(`still short of ${p.label}`);
}
