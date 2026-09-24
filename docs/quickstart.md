# Quickstart

From nothing to a contract that calls itself on Hedera testnet. About ten
minutes, most of which is waiting for a faucet.

Everything below was run end to end before it was written down. Where a command
prints something worth checking, the expected output is shown underneath it.

---

## 01 · Scaffold it

```bash
npx create-scaffold-hbar@latest --template Madhav-Gupta-28/Nocturne
```

You get one repository with two workspaces:

| Workspace | What is in it |
| --- | --- |
| `packages/hardhat` | Six contracts, 123 offline tests, deploy and demo scripts |
| `packages/nextjs` | This site — the landing page, these docs, a vault dashboard |

Node 20.18.3 or newer. Both npm and yarn work; the examples use npm.

```bash
cd nocturne
npm install
npm run hardhat:compile
```

---

## 02 · Make a deployer account

Never paste a raw private key into `.env`. The scaffold encrypts one for you and
stores only the ciphertext.

```bash
npm run hardhat:account:generate
```

That writes `DEPLOYER_PRIVATE_KEY_ENCRYPTED` to `packages/hardhat/.env` and asks
for a password, which it will ask for again on every deploy. Already have a key?

```bash
npm run hardhat:account:import
```

Print the address and its balance at any time:

```bash
npm run hardhat:account
```

Fund it from the [Hedera portal faucet](https://portal.hedera.com/faucet). For
the whole of this page, **40 HBAR is enough** — about 8 for the deploy and the
rest for the vault to spend on itself.

---

## 03 · Deploy

```bash
npm run hardhat:deploy -- --network hederaTestnet
```

Six contracts go out: `Heartbeat`, `HeartbeatStrategy`,
`ProtectiveExitStrategy`, `DriftRebalanceStrategy`, `NocturneFactory` and
`PriceLens`. Addresses are written to `packages/nextjs/contracts/deployedContracts.ts`,
which is what the frontend reads — so the site is pointed at your deployment the
moment it finishes.

Then publish the source so HashScan shows code rather than bytecode:

```bash
npm run hardhat:verify:sourcify -- --network hederaTestnet
```

> **`npx hardhat verify` does not work on this stack.** Sourcify retired the v1
> API that the pinned `hardhat-verify` still calls, and the 404 comes back as
> HTML, so the error you actually see is `Unexpected token '<'`. The script
> above posts to Sourcify v2 directly. This is written up in full under
> [dead ends](/docs/dead-ends).

---

## 04 · Arm a vault

This is the part worth watching. One command creates a vault, funds it,
configures it and arms it — and then never touches it again.

```bash
cd packages/hardhat
FUEL_HBAR=12 INTERVAL=120 npx hardhat run scripts/armVault.ts --network hederaTestnet
```

What it does, in order:

1. `factory.createVault(strategy)` with the fuel attached
2. `vault.configure(...)` with the heartbeat address and the interval
3. `vault.setAllowedCall(heartbeat, beat.selector, true)` — the allow-list
4. `vault.arm()`

The last transaction is the last one your account ever sends. Everything after
it is the network calling the vault.

```
vault   0.0.10684549
armed   first run at 12:04:31
runway  6 runs
```

**`INTERVAL` is in seconds and the floor is 60.** `FUEL_HBAR` defaults to 24.

---

## 05 · Watch it run

```bash
npx hardhat run scripts/watchVault.ts --network hederaTestnet
```

It polls the vault and prints each execution as it lands. Nothing this script
does is a transaction — it only reads.

```
watching — nothing below is sent by this script

run 1   beats 1   next in 120s   runway 5 runs
run 2   beats 2   next in 120s   runway 4 runs
```

Or open the frontend and watch the same numbers:

```bash
npm run next:dev
```

### Checking that nobody sent it

This is the claim, so it is worth knowing how to verify rather than taking it on
trust. On HashScan, open the vault's account and look at a scheduled execution's
**transfer list** — the fee is debited from the vault.

Do **not** read the transaction id. A scheduled transaction's id carries the
account that *created* the schedule, which makes it look as though the owner
sent the call. It did not. The transfer list is the ground truth.

---

## 06 · Make it yours

The vault is finished; the strategy is the part you write. It is four functions
and the smallest one that works is 69 lines.

→ **[Write a strategy](/docs/writing-a-strategy)**

Before you deploy anything with money behind it, read
[the six silent failures](/docs/landmines). Every one of them reports SUCCESS.

---

## Command reference

| Command | What it does |
| --- | --- |
| `npm run hardhat:compile` | Compile the contracts |
| `npm run hardhat:test` | 123 offline tests, no network |
| `npm run hardhat:test:live` | Live price-guard tests against testnet |
| `npm run hardhat:deploy -- --network hederaTestnet` | Deploy all six contracts |
| `npm run hardhat:verify:sourcify -- --network hederaTestnet` | Publish source to Sourcify |
| `npm run hardhat:account` | Show the deployer address and balance |
| `npm run next:dev` | Run the frontend |
| `npm run next:build` | Production build |

Note the `--` before `--network`. npm needs it to pass the flag through to the
script rather than consuming it itself.
