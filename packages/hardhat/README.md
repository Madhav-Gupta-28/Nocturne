# packages/hardhat

The contracts, their tests, and the scripts that put them on testnet. Run
everything from the repo root unless a line says otherwise.

## Layout

| Path | What is in it |
| --- | --- |
| `contracts/` | `NocturneVault`, `NocturneFactory`, `PriceLens`, `Heartbeat` |
| `contracts/strategies/` | `HeartbeatStrategy`, `ProtectiveExitStrategy`, `DriftRebalanceStrategy` |
| `contracts/lib/` | `TwapLib`, `TickMath`, `PriceGuard` — the SaucerSwap TWAP and the Chainlink cross-check |
| `contracts/test/` | Mocks (including `MockHederaScheduleService`) and the on-chain probes behind the landmine measurements |
| `deploy/` | One deploy script for all six contracts |
| `scripts/` | Arm, watch and verify vaults; account management; the gas-price probe |
| `test/` | Offline suite against the mock scheduler. `test/live/` reads real testnet prices |

## Test

```bash
npm run hardhat:test        # offline, no network, no key
npm run hardhat:test:live   # PriceGuard against the real SaucerSwap pool and Chainlink feed
```

There is no local-node deploy step. A plain Hardhat node has no Schedule Service
precompile at `0x16b`, so the offline suite runs the whole loop against
`MockHederaScheduleService` instead.

## Deploy to testnet

```bash
npm run hardhat:account:generate                       # encrypted key into .env
npm run hardhat:deploy -- --network hederaTestnet      # asks for the password
npm run hardhat:verify:sourcify -- --network hederaTestnet
```

The `--` matters. Without it, `--network` is swallowed by npm, and Hardhat
fails with HH308. `npx hardhat verify` does not work on this stack — see
[`docs/hedera-landmines.md`](../../docs/hedera-landmines.md).

## Arm a vault

From `packages/hardhat`:

```bash
FUEL_HBAR=12 INTERVAL=120 npx hardhat run scripts/armVault.ts --network hederaTestnet
npx hardhat run scripts/armExitVault.ts --network hederaTestnet
npx hardhat run scripts/armRebalanceVault.ts --network hederaTestnet
npx hardhat run scripts/watchVault.ts --network hederaTestnet
```

Each arm script prints its knobs at the top of the file.
