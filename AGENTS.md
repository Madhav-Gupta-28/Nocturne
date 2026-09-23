# Agent instructions

Briefing for coding agents working in this repo (Cursor, Claude Code, Codex).
Claude Code loads it through `CLAUDE.md`.

Nocturne is a Scaffold-HBAR template for contracts that schedule their own future
executions through the Hedera Schedule Service. Next.js App Router frontend,
Hardhat for contracts. There is no Foundry package.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing anything in
`packages/hardhat/contracts/`. It marks every chain fact as measured or assumed
and gives the command to re-measure it.

---

## Things that will bite you here

These are specific to this chain and this mechanism, and none of them fail in a
way that looks like a failure. All five are documented with reproductions in
[`docs/hedera-landmines.md`](docs/hedera-landmines.md).

**Never lower `MIN_SCHEDULE_GAS`.** Booking a schedule costs ~1.4M gas on its
own, and a self-rescheduling entry point measured 1,501,968. Give it less and it
runs once, reports **SUCCESS**, and never runs again. The constant has no setter
on purpose.

**`executeScheduled` must never revert.** A revert takes the successor down with
it and the chain stops for good. Everything inside it that can fail is wrapped,
and the successor is booked *before* any work is planned. If you add a code path
there, keep that ordering.

**Never clone the vault.** `NocturneFactory` deploys a real contract every time.
EIP-1167 proxies get a `delegatable_contract_id` admin key on the delegatecall
frame, and the scheduled call then fails at execution with
`INVALID_PAYER_SIGNATURE`
([hiero-consensus-node#27263](https://github.com/hiero-ledger/hiero-consensus-node/issues/27263)).
It would look cheaper and silently not work.

**One schedule per transaction.** Booking two in one call fails outright with
`NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`.

**Gas reserve is not gas cost.** A transaction is accepted only if the payer
holds `gasLimit × gasPrice`, then is charged for gas burned — under half as much.
So:

- Size deposits and gas limits against the reserve. `reservePerRun()` and
  `chargePerRun()` both exist and both read `tx.gasprice`.
- Do not raise a `gasLimit` "for safety". 4M on a call that burns 1.5M locks ~4.6
  HBAR in the sender's wallet and can leave an owner unable to arm a vault they
  just funded.

**Units.** Inside the EVM, HBAR is **tinybar** (8 decimals) and so is
`tx.gasprice`; over JSON-RPC both are **weibar** (18 decimals), exactly 1e10
larger. `block.basefee` is `0` on Hedera — never use it.

**Scheduled calls see `block.timestamp` ~2 seconds early.** That is what
`CLOCK_SKEW` absorbs. A deadline check that passes every unit test can still fail
in production.

---

## Contracts

| Path | Role |
| --- | --- |
| `NocturneVault.sol` | The engine. Read `executeScheduled` and `_bookNext` first. |
| `NocturneFactory.sol` | One vault per owner, real deploys. |
| `interfaces/INocturneStrategy.sol` | `plan`, `nextInterval`, `validateConfig`, `explain`. |
| `strategies/HeartbeatStrategy.sol` | Reference implementation — start here. |
| `strategies/ProtectiveExitStrategy.sol` | A floor: one-way, terminal. |
| `strategies/DriftRebalanceStrategy.sol` | A target: two-way, repeating. |
| `lib/PriceGuard.sol` | Two-source agreement with a reason string. |
| `lib/TwapLib.sol`, `lib/TickMath.sol` | Uniswap V3 TWAP; constants derived independently so the repo stays MIT. |
| `contracts/test/` | Mocks and probes. Not deployed by `deploy/`. |

**Adding a strategy should be one new file.** If it needs a change in
`NocturneVault`, the interface is probably wrong — say so rather than special-
casing the vault.

A strategy holds no funds and keeps no per-user state, so one deployment serves
every vault. Config is `abi.encode`d by the caller and validated on `configure`,
which is the last point a bad config fails loudly instead of at 3am.

---

## Commands

```bash
npm install                 # root; the repo's .npmrc is required, see README

# Contracts
npm run hardhat:test        # 115 offline tests
npm run hardhat:test:live   # 5 against live testnet contracts
npm run hardhat:compile
npm run hardhat:deploy -- --network hederaTestnet

# Frontend
npm run next:dev            # http://localhost:3000
npm run next:build
npm run lint
npm run format
```

A deployer account is needed for anything on testnet:

```bash
npm run hardhat:account:import     # or :generate, then fund at the faucet
npm run hardhat:account            # shows the address and balance
```

`__RUNTIME_DEPLOYER_PRIVATE_KEY` overrides the encrypted key for one command.
Never write a private key into a file in this repo.

Arm a vault and then leave it alone:

```bash
cd packages/hardhat
FUEL_HBAR=12 INTERVAL=120 npx hardhat run scripts/armVault.ts --network hederaTestnet
npx hardhat run scripts/watchVault.ts --network hederaTestnet
```

---

## Frontend

Hooks are in `packages/nextjs/hooks/scaffold-hbar`. Use the names that exist:
`useScaffoldReadContract`, `useScaffoldWriteContract`,
`useScaffoldWatchContractEvent`, `useScaffoldEventHistory`,
`useDeployedContractInfo`, `useScaffoldContract`, `useTransactor`,
`useTargetNetwork`, `useHederaAccountId`.

```tsx
const { data: beats } = useScaffoldReadContract({
  contractName: "Heartbeat",
  functionName: "beats",
});
```

**Vaults are the exception.** They are created by the factory, so they have no
entry in `deployedContracts.ts` and the scaffold hooks cannot find them by name.
Use `packages/nextjs/hooks/useNocturneVault.ts`, which takes an address and reads
the ABI from `contracts/runtimeContracts.ts` — regenerated on every deploy by
`packages/hardhat/scripts/generateRuntimeAbis.ts`, so it cannot drift.

Writes to a vault skip simulation deliberately: simulating `arm` runs against the
relay's view of the Schedule Service at `0x16b`, a system contract it does not
model, and reports failure for a call that succeeds on chain.

Components: `HederaAddress`, `BlockieAvatar`,
`RainbowKitCustomConnectButton`. Prefer DaisyUI classes over raw Tailwind where a
DaisyUI component exists.

### After deploy

`deployedContracts.ts` (addresses + ABIs) and `runtimeContracts.ts` (ABIs only,
for factory-created contracts) are both regenerated. Third-party contracts go in
`externalContracts.ts`.

### Networks

- Hardhat: `packages/hardhat/hardhat.config.ts` — `hederaTestnet` (296),
  `hederaMainnet` (295)
- Next.js: `packages/nextjs/scaffold.config.ts` — target networks, polling, RPC
  overrides, WalletConnect

---

## Style

| Style | Use |
| --- | --- |
| `UpperCamelCase` | types, components, contracts |
| `lowerCamelCase` | variables, functions |
| `CONSTANT_CASE` | constants |
| `snake_case` | Hardhat deploy files |

Next.js imports use the `~~` alias. App Router pages live under
`packages/nextjs/app/`; add `"use client"` when a page uses hooks.

Prefer `type` over `interface`. No `T` prefix on types. Let TypeScript infer when
it can.

**Comments carry the measurement.** Most of the non-obvious constants in this
repo exist because something was measured on a live network, and the comment is
where that evidence lives. When you change such a constant, change the evidence
with it or say plainly that it is now an assumption.
