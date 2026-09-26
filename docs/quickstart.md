Ten minutes from nothing to a contract that calls itself, most of it waiting
for a faucet. Everything below was run end to end before it was written down.

---

## 01 · Scaffold it

```bash
npm create scaffold-hbar@latest -- nocturne --template Madhav-Gupta-28/Nocturne
```

The `--` is not optional. Without it the flag is consumed by npm, and you land
in the stock template picker.

> **If GitHub rate-limits the CLI, you get the wrong project.** The
> CLI reads this template's `template.json` through the GitHub API. When that
> call fails it quietly falls back to its own default — Foundry — and drops
> `packages/hardhat`. Pin the choices yourself and the call no longer
> matters:
>
> ```bash
> npm create scaffold-hbar@latest -- nocturne --template Madhav-Gupta-28/Nocturne \
>   -f nextjs-app -s hardhat --package-manager npm
> ```

You get one repository with two workspaces:

| Workspace | What is in it |
| --- | --- |
| `packages/hardhat` | The vault, factory and three strategies, 168 offline tests, deploy and demo scripts |
| `packages/nextjs` | This site — the landing page, these docs, a vault dashboard |

Node 20.18.3 or newer. The CLI installs dependencies for you.

```bash
cd nocturne
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
the whole of this page, **40 HBAR is enough**: about 10 for the deploy and the
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

1. `factory.createVault(strategy)`, with the fuel attached
2. `vault.setAllowedCall(heartbeat, beat.selector, true)`, the allow-list
3. `vault.configure(...)`, with the heartbeat address and the interval
4. `vault.arm()`

That last transaction is the last one your account ever sends. Everything after
it is the network calling the vault. The script ends by printing what the vault
believes about itself:

```
armed    true
next run 2026-09-25T12:06:31.000Z
balance  12.0000 HBAR
reserve  3.2700 HBAR per run  (accepted only above this)
charge   1.6350 HBAR per run  (what it actually costs)
runway   6 runs
```

**`INTERVAL` is in seconds and the floor is 60.** `FUEL_HBAR` defaults to 24.

---

## 05 · Watch it run

```bash
npx hardhat run scripts/watchVault.ts --network hederaTestnet
```

It finds your latest vault, polls it, and prints a line each time the network
runs it. Nothing this script does is a transaction.

```
watching — nothing below is sent by this script

12:06:33  runs=1 refusals=0 beats=1 next=12:08:33 runway=5 armed=true
12:08:34  runs=2 refusals=0 beats=2 next=12:10:34 runway=4 armed=true
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
[the six silent failures](/docs/landmines). None of them ever reaches your screen.

---

## Command reference

| Command | What it does |
| --- | --- |
| `npm run hardhat:compile` | Compile the contracts |
| `npm run hardhat:test` | 168 offline tests, no network |
| `npm run hardhat:coverage` | Coverage of every shipped contract |
| `npm run hardhat:test:live` | Live price-guard tests against testnet |
| `npm run hardhat:deploy -- --network hederaTestnet` | Deploy all six contracts |
| `npm run hardhat:verify:sourcify -- --network hederaTestnet` | Publish source to Sourcify |
| `npm run hardhat:account` | Show the deployer address and balance |
| `npm run next:dev` | Run the frontend |
| `npm run next:build` | Production build |

Note the `--` before `--network`. Without it the flag is consumed by npm,
not passed through to the script.
