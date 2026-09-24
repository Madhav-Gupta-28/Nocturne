# Six silent failures

Six ways a self-rescheduling contract dies on Hedera. Every one was measured on
testnet with the command shown. **None of them report an error** — the
transaction succeeds, the explorer is green, and the automation is simply never
called again.

None of this is in Hedera's documentation.

---

## 01 · A 1M gas budget kills the chain, silently

`scheduleCall` costs about **1.4M gas by itself**. A function that does some
work and then books its successor measured **1,511,731**.

Give it 1,000,000 and the work runs, the inner `scheduleCall` runs out of gas,
and the outer call **still reports SUCCESS**. Nothing reverts. The chain is dead
because the only thing that was ever going to call it again was the successor
that failed to book.

Two contracts, identical but for that number:

| Scheduled gas | Fired | Booked a successor |
| --- | --- | --- |
| `1,000,000` | yes | **no** — dead after one run |
| `3,000,000` | yes | yes — still running |

```
17:45  ticks=1  rc=22    scheduled 0xA2Ca8d
17:46  ticks=2  rc=-102  scheduled 0x0        <- fired once, chain dead
17:47 … 17:53   ticks=2  rc=-102  scheduled 0x0
```

```bash
RPC=https://testnet.hashio.io/api
cast call 0xAC43ea09aBb40C957488fedBa2E68a3e022ef651 "ticks()(uint256)" --rpc-url $RPC
cast call 0xb4f980DBdb7b62f5193d5Ab0680DB468b5143445 "ticks()(uint256)" --rpc-url $RPC
```

> **Nocturne:** `MIN_SCHEDULE_GAS = 3_000_000`, a constant with no setter.
> Unused gas is refunded, so the headroom is nearly free.

---

## 02 · The clock runs two seconds behind

A call booked for second `T` executes at consensus `T.149` — and sees
`block.timestamp == T - 2`.

```
scheduled for  1788608600
ran at         1788608600.149
observed       1788608598
```

A contract that gates on `block.timestamp > deadline` and schedules itself for
`deadline + 1` hands the network a call that reverts on arrival. Every time, in
production, while every unit test passes — Foundry and Hardhat have no such lag.

> **Nocturne:** `CLOCK_SKEW = 10` seconds, five times the observed drift. Without
> it the vault would reject its own wake-up and stop forever, since declining to
> run also means declining to book a successor.

---

## 03 · One schedule per transaction

A second booking in the same transaction fails with
`NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION` — and it fails **the whole
transaction**, not just the booking.

A scheduled execution may book exactly one successor. That is what makes an
unattended chain possible at all.

> **Nocturne:** `executeScheduled` calls `_bookNext` exactly once, structurally.
> Anything wanting a second schedule is a separate transaction.

---

## 04 · Expiry is refused beyond 62 days

`scheduling.maxExpirationFutureSeconds` is **5,356,800**. True at exactly 62
days, false at 63, on testnet and mainnet.

```bash
RPC=https://testnet.hashio.io/api
NOW=$(date -u +%s)
HSS=0x000000000000000000000000000000000000016b
for d in 61 62 63; do
  printf "%s days -> " "$d"
  cast call $HSS "hasScheduleCapacity(uint256,uint256)(bool)" $(( NOW + d*86400 )) 3000000 --rpc-url $RPC
done
# 61 days -> true
# 62 days -> true
# 63 days -> false
```

> **Nocturne:** `MAX_INTERVAL = 60 days`, two days of margin, and every interval
> a strategy asks for is clamped into `[MIN_INTERVAL, MAX_INTERVAL]`.

---

## 05 · The payer is tested against gas reserved, not gas burned

This one cost a running vault its life with **2.76 HBAR still in it**.

Thirteen unattended runs, each charged **1.6299 HBAR**. The fourteenth failed:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=0.0.10684549&limit=2&order=desc" \
  | jq -r '.transactions[] | "\(.result) charged=\(.charged_tx_fee)"'
# INSUFFICIENT_PAYER_BALANCE charged=2306440
# SUCCESS                    charged=162987482
```

The balance has to clear `3,000,000 × 109 = 3.27 HBAR` — the whole allowance —
even though a run only costs 1.63. Fund against the cost and the vault stops
holding nearly twice a run's worth.

> **Nocturne:** `reservePerRun()` and `chargePerRun()` are separate views, and
> `runway()` uses both: `(balance − reserve) / charge + 1`. See
> [fuel and runway](/docs/fuel).

---

## 06 · Mid-run, the balance is already down the whole allowance

A contract reading its own balance during a scheduled call sees the balance
**after the entire gas allowance has been debited**. The refund of unused gas
only lands when the call returns.

Measured on vault `0.0.10690925`, funded with exactly 4 HBAR:

| | Tinybar | HBAR |
| --- | --- | --- |
| Seen during the run | `73,000,000` | 0.73 |
| After it settled | `222,452,080` | 2.2245 |
| Actually charged | `177,547,920` | 1.7755 |

`4.00 − 3.27 = 0.73` to the tinybar. So a fuel check written inside a scheduled
call reads a full reserve too low, and will believe a healthy vault is nearly
empty. **Anything that acts on that — disarming, halting, refusing to book —
stops a vault that was fine**, from inside a transaction reporting SUCCESS.

> **Nocturne:** the understatement is left in place because it errs safe —
> `FuelLow` warns a run early rather than late — and nothing in the vault ever
> *acts* on `runway()`. `_bookNext` runs unconditionally.

---

## A useful one, for once

**A scheduled call arrives with `msg.sender` set to the contract itself.** The
network runs it as though the contract called itself; `tx.origin` is the contract
too, not the account that created the schedule.

```
sender = 0x03F7F064E6ceD8e154e3FdAAF92DcCC4e818E97B   <- the probe contract
origin = 0x03F7F064E6ceD8e154e3FdAAF92DcCC4e818E97B   <- also the contract
lag    = -1s                                          <- fired a second early
```

This matters because a self-rescheduling entry point has to be permissionless —
there is no caller to authenticate, and locking it down means a stalled chain
can never be revived. `msg.sender` lets such a function tell its own wake-up
from an uninvited one without giving that up.

`NocturneVault` uses it for exactly one thing: when `msg.sender != address(this)`
it releases the pending schedule first, so the orphaned booking cannot fire
later and waste a run.

Reproduce with `contracts/test/ScheduledSenderProbe.sol`, live at
`0x03F7F064E6ceD8e154e3FdAAF92DcCC4e818E97B`.

---

## Three more, not about scheduling

**`npx hardhat verify` does not work.** Sourcify retired the v1 API the pinned
`hardhat-verify` still calls. The 404 comes back as HTML, so the error you see is
`Unexpected token '<'`. Use `npm run hardhat:verify:sourcify`.

**`block.basefee` is 0.** Not a usable gas-price source. `tx.gasprice` is, and
inside the EVM it is already tinybar per gas — the same unit as
`address(this).balance`, no 1e10 conversion.

**EIP-1167 clones cannot schedule.** A delegatecall frame gets a
`delegatable_contract_id` admin key, and `scheduleCall` then fails with
`INVALID_PAYER_SIGNATURE` (hiero-consensus-node #27263). Deploy with `new`.

---

→ Next: [what was tried and abandoned](/docs/dead-ends).
