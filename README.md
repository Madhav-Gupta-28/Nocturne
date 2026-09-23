# Nocturne

**Close the tab. Come back. It already happened.**

A Scaffold-HBAR template for contracts that run themselves. A vault books its own
next execution through the Hedera Schedule Service, decides how long to wait from
what it can see, and refuses to trade when its two price sources disagree.

No keeper. No bot. No cron job on somebody's laptop. The thing that fires at 4am
is the network.

```bash
npx create-scaffold-hbar@latest --template Madhav-Gupta-28/Nocturne
```

---

## What you can check in two minutes

Nocturne's central claim is the one a screenshot cannot make, so here is how to
falsify it instead.

A vault ran unattended on testnet and beat a counter every two minutes. Read the
counter:

```bash
cast call 0x8b63C92F7d906862922D060C7Ffc294d8a43ec0b "beats()(uint256)" \
  --rpc-url https://testnet.hashio.io/api
```

Then read who paid for those beats:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=0.0.10684549&limit=5&order=desc" \
  | jq '.transactions[] | {result, scheduled, transfers: [.transfers[] | select(.amount < 0)]}'
```

**Read the transfer list, not the transaction id.** A scheduled transaction's id
carries the account that *created* the schedule, which makes the owner look like
the sender of every call. They are not. The fee comes out of the vault's own
account, and the owner appears exactly once in the whole history — the
transaction that armed it.

| | |
| --- | --- |
| Heartbeat | [`0x8b63C92F…3ec0b`](https://hashscan.io/testnet/contract/0x8b63C92F7d906862922D060C7Ffc294d8a43ec0b) |
| Factory | [`0x8BCF0110…A104`](https://hashscan.io/testnet/contract/0x8BCF01104d2748F29b36efF9538C5064b6FcA104) |
| First demo vault | `0.0.10684549` — 13 unattended runs, then died (see below) |

---

## Why it is not a cron job

**It books its own successor, before it does any work.** Each execution schedules
the next one first and only then plans. A strategy that reverts costs one run
instead of the whole chain — and because `executeScheduled` has no access
control, anyone can restart a chain that stopped.

**The strategy chooses the cadence, not the vault.** `nextInterval()` is the
whole contribution. A position far from trouble is checked every six hours; one
near its floor every sixty seconds. At ~1.6 HBAR a run that is the difference
between 6 and 460 HBAR a day, and only the strategy knows which is currently
right.

> Hedera's own `ScheduledVault` example takes a fixed interval, and its strategy
> interface returns actions only. Their documented use case — *"as positions
> approach liquidation thresholds, contracts schedule increasingly frequent
> monitoring"* — cannot be expressed in it. `nextInterval` is that sentence in
> code.

**It can refuse.** Before it trades, a pool TWAP and a Chainlink feed have to
agree within a tolerance you set. When they do not, it sells nothing, records
*why*, and looks again sooner. On **11 July 2026** a single manipulated price
took **$9.05M** out of Bonzo Lend and roughly 40% of Hedera's TVL with it; an
automated seller that believes one feed is not a safety tool, it is a liquidation
bot working for whoever moved the price.

---

## What's in it

| Contract | What it is |
| --- | --- |
| `NocturneVault` | The engine. Holds funds, books schedules, executes plans, never reverts inside a scheduled call. |
| `NocturneFactory` | One vault per owner. Real deploys — **never clones**, see below. |
| `INocturneStrategy` | Four functions: `plan`, `nextInterval`, `validateConfig`, `explain`. |
| `HeartbeatStrategy` | The reference implementation, and the liveness proof. |
| `ProtectiveExitStrategy` | A floor. One-way, terminal, urgent. |
| `DriftRebalanceStrategy` | A target. Two-way, repeating, and declines trades that cost more than they correct. |
| `lib/PriceGuard` | Two-source agreement, with a reason string when they disagree. |
| `lib/TwapLib`, `lib/TickMath` | Uniswap V3 TWAP reading, constants derived independently (MIT, not copied from GPL v3-core). |

Two strategies of genuinely different shape on one engine is the evidence that
the abstraction holds. A third should be a file, not a rewrite.

---

## Five ways HSS automation fails silently

All measured on testnet, none of them in Hedera's documentation, each with the
command that produced it in [`docs/hedera-landmines.md`](docs/hedera-landmines.md).

1. **A self-rescheduling entry point needs ~1.5M gas.** Give it 1M and it runs
   once, reports **SUCCESS**, and never runs again. Nothing reverts.
2. **Scheduled calls see `block.timestamp` ~2 seconds early.** A deadline check
   that passes every unit test fails in production.
3. **Exactly one schedule per transaction.** Booking two rejects the whole thing.
4. **Expiry is refused beyond 62 days.**
5. **A payer must cover the whole gas allowance, not the gas it burns.** This one
   killed the first demo vault with 2.76 HBAR still in it: thirteen runs charged
   1.63 HBAR each, and the fourteenth was refused because the reserve is
   3,000,000 gas × 109 tinybar = **3.27 HBAR**.

Landmine 5 is why `runway()` is not a single division:

```
runs = 0                                 if balance < reserve
runs = (balance - reserve) / charge + 1  otherwise
```

Both figures come from `tx.gasprice`, which inside the EVM is quoted in **tinybar
per gas** — the same unit as `address(this).balance`, so no 1e10 conversion
applies — and which the relay fills in even during `eth_call`. `block.basefee` is
`0` on Hedera and must not be used.

### And one that is not about scheduling

**EIP-1167 clones break HSS entirely.** A delegatecall frame gets a
`delegatable_contract_id` admin key, and the scheduled call then fails at
execution with `INVALID_PAYER_SIGNATURE`
([hiero-consensus-node#27263](https://github.com/hiero-ledger/hiero-consensus-node/issues/27263)).
`NocturneFactory` therefore deploys a real vault every time and pays the gas for
it. A template that clones would look cheaper and silently not work.

---

## Quick start

Requires **Node ≥ 20.18.3** (tested on 22).

```bash
npm install
cp packages/hardhat/.env.example packages/hardhat/.env
npm run hardhat:account:import   # or :generate, then fund at the faucet
```

Deploy and arm a vault that beats every two minutes:

```bash
npm run hardhat:deploy -- --network hederaTestnet
cd packages/hardhat
FUEL_HBAR=12 INTERVAL=120 npx hardhat run scripts/armVault.ts --network hederaTestnet
```

Then send nothing else:

```bash
npx hardhat run scripts/watchVault.ts --network hederaTestnet
```

**Budget against the reserve, not the cost.** A run needs 3.27 HBAR in the vault
to be accepted and is then charged about 1.63, so 12 HBAR is six runs, not seven.
Leave the owner ~3 HBAR too — arming reserves its own gas, and an owner who put
everything into the vault cannot arm it.

The frontend:

```bash
npm run next:dev
```

Create a vault, arm it, watch the countdown, then close the tab.

---

## Tests

```bash
npm run hardhat:test          # 115 offline
npm run hardhat:test:live     # 5 against live testnet contracts
```

The live ones are the interesting ones: they read the real SaucerSwap pool and
the real Chainlink feed, and one of them asserts that `PriceGuard` **refuses** to
act because those two sources genuinely disagree right now.

---

## Reading order

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the whole design, with every chain fact
   marked as measured or assumed, and the commands to re-measure them.
2. [`docs/hedera-landmines.md`](docs/hedera-landmines.md) — the five failures,
   reproducible.
3. `contracts/interfaces/INocturneStrategy.sol` — four functions.
4. `contracts/strategies/HeartbeatStrategy.sol` — the simplest implementation.
5. `contracts/NocturneVault.sol` — `executeScheduled` is the heart of it.

---

## Built on Scaffold-HBAR

Next.js App Router, wagmi + RainbowKit, Hardhat, Hashio RPC and Mirror Node
config for testnet and mainnet, plus the stock **Debug Contracts** page and local
block explorer.

Two fixes this template carries over the stock scaffold, both verified against a
pristine one first:

- **`.npmrc` at the repo root.** The scaffold ships `legacy-peer-deps` only in
  `packages/hardhat/.npmrc`, where npm ignores it during a root workspace
  install, so `npm install` dies on an ERESOLVE between hardhat 2.22.19 and
  hardhat-verify's `^2.26.0`.
- **`@x402/*` aliased out in `next.config.ts`.** `npm run build` otherwise fails
  on five unresolvable modules.

Links: [Scaffold HBAR docs](https://docs.hedera.com/solutions/tools/scaffold-hbar/index)
· [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar)
· [Hedera faucet](https://portal.hedera.com/faucet)
· [HashScan](https://hashscan.io/)

MIT.
