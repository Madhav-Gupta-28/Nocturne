# Fuel and runway

A vault pays for its own executions out of its own balance. How much to put in
it is the one piece of arithmetic that has to be right, because getting it wrong
does not throw — the vault simply stops, with money still in it, and nothing
tells you.

Every figure on this page was measured on Hedera testnet. None of them are
estimates.

---

## 01 · The gap

There are two numbers, and they are not the same number.

| | HBAR | Where it comes from |
| --- | --- | --- |
| **Reserved per run** | `3.27 HBAR` | 3,000,000 gas × 109 tinybar |
| **Actually charged** | `1.63 HBAR` | 1,495,298 gas burned (measured) |

<!-- figure: fuel -->

The network takes the payer's ability to cover the **whole gas allowance** as a
precondition before it will run a scheduled call — then charges only for the gas
actually burned. A vault therefore has to *hold* 3.27 to be allowed to spend
1.63.

Fund a vault against the cost and it dies holding roughly twice a run's worth of
HBAR.

> This is not hypothetical. The first long-running demo vault on this project
> stopped holding **2.7628 HBAR** after thirteen runs charged **1.6299 HBAR**
> each. It had well over a run's worth of cost left and the fourteenth failed
> anyway: `INSUFFICIENT_PAYER_BALANCE`, because the reserve was 3M × 109 tinybar
> = 3.27 HBAR. Account `0.0.10684549`, still on testnet.

---

## 02 · The arithmetic

```solidity
function reservePerRun() public view returns (uint256) {
    return MIN_SCHEDULE_GAS * _gasPrice();   // 3,000,000 × tinybar/gas
}

function chargePerRun() public view returns (uint256) {
    return GAS_PER_RUN * _gasPrice();        // 1,500,000 × tinybar/gas
}
```

Runway is not one division, because the two numbers do different jobs. The
reserve is a **threshold crossed once**; the charge is what **erodes the
balance** toward it.

```
runway = (balance − reserve) / charge + 1
```

The `+ 1` is the run that happens while the balance is still above the reserve
but below reserve + charge. Drop it and the vault reports zero while it can
still run.

Read it live on any vault:

```typescript
const [armed, runs, refusals, nextAt, runsRemaining] = await vault.status();
```

---

## 03 · How much to put in

Multiply the runs you want by the charge, then add the reserve so the last one
is still allowed to happen. This carries one run of margin, since the exact
minimum is `3.27 + (runs − 1) × 1.63`.

```
fuel = runs × 1.63 + 3.27   HBAR
```

| Runs | Fuel |
| --- | --- |
| 5 | 12 HBAR |
| 10 | 20 HBAR |
| 24 (hourly, for a day) | 43 HBAR |
| 100 | 167 HBAR |

At a two-hour cadence, **a vault running for a month needs about 590 HBAR**.
That is the real cost of unattended automation on Hedera today, and it is worth
knowing before you design a cadence rather than after.

This is exactly why `nextInterval` belongs on the strategy — see
[write a strategy](/docs/writing-a-strategy). A fixed hourly cadence costs about
39 HBAR a day whether or not anything is happening.

---

## 04 · Why `tx.gasprice`

The price comes from `tx.gasprice`, and it needs no conversion:

```solidity
function _gasPrice() private view returns (uint256) {
    return tx.gasprice == 0 ? FALLBACK_GAS_PRICE : tx.gasprice;
}
```

Inside the Hedera EVM, `tx.gasprice` is quoted in **tinybar per gas** — the same
8-decimal unit as `address(this).balance`. No 1e10 factor. Hedera's relay also
substitutes the network price during `eth_call`, so a frontend reading
`reservePerRun()` gets a live figure rather than a stale constant.

The fallback of 109 tinybar covers chains that leave `tx.gasprice` at zero,
which would otherwise divide by zero in `runway()`.

> **`block.basefee` is 0 on Hedera.** It is not a usable source for this.

---

## 05 · Tinybar, weibar, and a silent overspend

This catches everyone once.

| Where | Unit | Decimals |
| --- | --- | --- |
| Inside the EVM — `address(this).balance`, `msg.value`, `tx.gasprice` | tinybar | 8 |
| Over JSON-RPC — what ethers and your wallet report | weibar | 18 |

They differ by exactly **1e10**. So:

```typescript
// Sending fuel: weibar goes in, the relay divides by 1e10.
await factory.createVault(strategy, { value: ethers.parseEther("12") });

// Reading it back: tinybar comes out.
const tinybar = await vault.fuel();        // 1_200_000_000n
const hbar = Number(tinybar) / 1e8;        // 12
```

A strategy's `Action.value` is **tinybar**, not wei. Confusing them is a silent
overspend by ten orders of magnitude — which is why the vault refuses any action
with a non-zero `value` at all.

---

## 06 · Topping up

Anyone can add fuel; only the owner can take it out.

```solidity
vault.depositHbar{ value: amount }();          // payable, open to anyone
vault.withdrawHbar(tinybar);                   // onlyOwner
```

The vault emits `FuelLow(balance, runsRemaining)` on every run once the runway
is at or below `FUEL_WARN_RUNS`, which is **5**. That event is the thing to alert on. There is
no other warning, and by the time the runway is zero the chain has already
stopped.

Watch it from the shell:

```bash
npx hardhat run scripts/watchVault.ts --network hederaTestnet
```

---

## 07 · Headroom in your own wallet

The same reserve rule applies to the owner. Hashio will not submit a
transaction unless the sender holds `gasLimit × gasPrice` on top of any value
sent, even though most of it comes back:

| Call | Gas limit | Headroom at 114 tinybar/gas | Charged, measured |
| --- | --- | --- | --- |
| `createVault` | 4,000,000 | ~4.6 HBAR | ~2.6 HBAR |
| `arm` | 2,500,000 | ~2.9 HBAR | ~1.7 HBAR |
| `configure`, `setAllowedCall` | 1,000,000 | ~1.1 HBAR | cents |

A wallet that prices gas EIP-1559 style sets `maxFeePerGas` at about twice the
network price, and the reserve doubles with it: `createVault` then needs ~8.7
HBAR of headroom, and the failure is a bare "insufficient funds". The app sends
a legacy `gasPrice` at the network rate for exactly this reason. If you script
against a vault, do the same.

---

## 08 · What happens when it runs out

Nothing dramatic, which is the problem.

The scheduled call fails with `INSUFFICIENT_PAYER_BALANCE`. The vault's own
state is untouched — still armed, still configured, `runCount` unchanged. There
is no event, because the vault's code never ran.

To restart it: top up, then call `executeScheduled()`. It has no access control
on purpose, so **anyone** can revive a stalled chain — you do not need to be the
owner, and the vault will book its own successor again from that call.

```typescript
await vault.depositHbar({ value: ethers.parseEther("20") });
await vault.executeScheduled({ gasLimit: 3_000_000 });
```

→ Related: [the six silent failures](/docs/landmines), of which this is the
fifth.
