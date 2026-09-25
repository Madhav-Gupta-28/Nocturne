# Add a dollar-cost-averaging strategy

## Goal

Add `DcaStrategy`, a fourth strategy for the Nocturne vault: every interval, buy
a fixed amount of an asset with USDC on SaucerSwap V2, but only when the pool
and Chainlink agree on the price. Follow `AGENTS.md` and
`docs/writing-a-strategy.md`; the vault, factory and existing strategies do not
change.

## Existing app (preserve)

- `packages/hardhat`: every existing contract, test and script, unmodified.
  `npm run hardhat:test` must still pass in full.
- `packages/nextjs`: `/`, `/how-it-works`, `/docs/*` and `/debug` keep rendering.
- Deployed addresses in `packages/nextjs/contracts/deployedContracts.ts` are not
  touched. The new strategy is not added to the deploy script.

## Feature to implement

1. `packages/hardhat/contracts/strategies/DcaStrategy.sol`, implementing
   `INocturneStrategy` with this config:

   ```solidity
   struct Config {
       address vault;
       address asset;          // what to buy
       address quote;          // what to pay with, a USD stablecoin
       address router;         // SaucerSwap V2 SwapRouter
       uint24 fee;
       uint256 amountPerBuy;   // quote units spent per run
       uint256 intervalSeconds;
       uint256 slippageBps;
       uint8 assetDecimals;
       uint8 quoteDecimals;
       PriceGuard.Sources sources;
   }
   ```

   - `plan`: if the vault holds less than `amountPerBuy` of quote, return an
     empty plan. If `PriceGuard.read(sources)` does not agree, return an empty
     plan. Otherwise approve the router for `amountPerBuy` and call
     `exactInputSingle` quote → asset, recipient the vault, with a non-zero
     `amountOutMinimum` derived from `PriceGuard.actionablePrice(r, false)`
     and `slippageBps`.
   - `nextInterval`: `intervalSeconds` normally; 5 minutes when the sources
     disagree; 60 days when the vault can no longer afford a buy (the
     empty-vault rule in AGENTS.md).
   - `validateConfig`: reject zero addresses, `asset == quote`, zero amount,
     zero interval, slippage of 0 or ≥ 10,000 bps, and empty sources.
   - `explain`: `"buying"`, `"out of funds"`, or the guard's reason.
   - `encodeConfig(Config)`, like the other strategies.
2. `packages/hardhat/test/DcaStrategy.test.ts`, offline, using
   `MockHederaScheduleService`, `MockV3Pool`, `MockAggregator`,
   `MockSwapRouter` and `MockToken`. At least: a buy through a real
   `NocturneVault` fired by the mock scheduler; a refusal when the sources
   disagree; the 60-day interval once quote runs out; config validation.
3. `README.md`: in "How big this gets", move dollar-cost averaging to
   **Ships today** and name `DcaStrategy`.

## Non-goals

- No changes to `NocturneVault`, `NocturneFactory` or `PriceGuard`.
- No frontend UI for the new strategy.
- Do not switch the package manager away from npm. Do not commit `.env` files.

## Acceptance (deterministic)

Tiers 0–2 in `.harness/validators/`: the files exist and say what this brief
says, every existing gate still passes, and the app's routes render.
