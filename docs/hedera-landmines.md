# Six ways HSS automation fails silently

Everything here was measured on Hedera testnet, with the command that measured
it. None of it is in Hedera's documentation, and all six will bite anyone who
writes a self-rescheduling contract.

The first one is the dangerous one, because it does not look like a failure. The
fifth was found the expensive way, by a vault that died with money still in it.

---

## 1. A self-rescheduling entry point needs ~1.5M gas, and 1M kills it silently

`scheduleCall` costs roughly **1.4 million gas on its own**. A function that does
some work and then books its own successor measured **1,511,731**.

Give that function a 1,000,000 gas budget and here is what happens: the work
runs, the inner `scheduleCall` runs out of gas, and — because any correct
implementation catches that failure rather than propagating it — **the outer call
still succeeds**. The transaction reports SUCCESS. The explorer is green. There
is no revert anywhere.

And the automation never runs again, because the only thing that was ever going
to call it was the successor that failed to book.

Two contracts were deployed to testnet differing in exactly this number:

| Contract | scheduled gas | fired? | booked a successor? |
| --- | --- | --- | --- |
| `0xb4f980DBdb7b62f5193d5Ab0680DB468b5143445` | 1,000,000 | yes | **no** — chain dead after one run |
| `0xAC43ea09aBb40C957488fedBa2E68a3e022ef651` | 3,000,000 | yes | yes — still running |

The under-gassed one flatlined and stayed flat:

```
17:45  ticks=1  rc=22    scheduled 0xA2Ca8d
17:46  ticks=2  rc=-102  scheduled 0x0        <- fired once, chain dead
17:47 … 17:53   ticks=2  rc=-102  scheduled 0x0
```

Check for yourself:

```bash
RPC=https://testnet.hashio.io/api
cast call 0xAC43ea09aBb40C957488fedBa2E68a3e022ef651 "ticks()(uint256)" --rpc-url $RPC
cast call 0xb4f980DBdb7b62f5193d5Ab0680DB468b5143445 "ticks()(uint256)" --rpc-url $RPC
```

**What Nocturne does:** `MIN_SCHEDULE_GAS` is a constant of 3,000,000 with no
setter. Unused gas is refunded on Hedera, so the headroom is nearly free; the
only pressure against reserving more is that `hasScheduleCapacity` is likelier to
refuse a bigger reservation.

---

## 2. A scheduled call's clock runs about two seconds behind

A call booked for second `T` executes at consensus `T.149` — and observes
`block.timestamp == T - 2`.

Measured with a probe contract: scheduled for `1788608600`, ran at
`1788608600.149`, saw `1788608598`.

So a contract that gates on `block.timestamp > deadline` and schedules itself for
`deadline + 1` hands the network a call that reverts on arrival. It reverts every
time, in production, while every unit test passes — because Foundry's and
Hardhat's clocks have no such lag.

**What Nocturne does:** `CLOCK_SKEW` is 10 seconds, five times the observed
drift. A wake-up call arriving early is still accepted. Without that tolerance
the vault would reject its own scheduled execution and stop forever, since
declining to run also means declining to book a successor.

The same constant bounds how early an uninvited caller can force a run: ten
seconds per cycle, whatever the cadence.

---

## 3. Exactly one schedule may be booked per transaction

A second booking in the same transaction is rejected with
`NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`, and the rejection fails **the
entire transaction**, not just the booking.

Found the hard way: a call that had worked all day started reverting the moment a
second schedule fell inside it.

A scheduled execution may book exactly one successor, which is what makes an
unattended chain possible at all.

**What Nocturne does:** `executeScheduled` calls `_bookNext` exactly once,
structurally. Anything that wants a second schedule has to be a separate
transaction that anybody may send.

---

## 4. Expiry is refused beyond 62 days

`scheduling.maxExpirationFutureSeconds` is **5,356,800 seconds**.
`hasScheduleCapacity` answers true at exactly 62 days and false at 63, on testnet
and on mainnet.

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

**What Nocturne does:** `MAX_INTERVAL` is 60 days, leaving two days of margin,
and every interval a strategy asks for is clamped into
`[MIN_INTERVAL, MAX_INTERVAL]`.

---

## 5. A payer must cover the whole gas allowance, not the gas it burns

This one cost a running demo vault its life, with 2.76 HBAR still in it.

The vault ran thirteen unattended executions. Each was charged **1.6299 HBAR**.
The fourteenth failed:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=0.0.10684549&limit=2&order=desc" \
  | jq -r '.transactions[] | "\(.result) charged=\(.charged_tx_fee)"'
# INSUFFICIENT_PAYER_BALANCE charged=2306440
# SUCCESS                    charged=162987482
```

It held 2.7628 HBAR at that moment — **1.7 times** what a run had ever cost. The
network refused it anyway, because acceptance is tested against the full gas
allowance the schedule was created with, and only the gas actually burned is
then charged. Those are very different numbers: a run burns about 1.43M gas and
reserves `MIN_SCHEDULE_GAS`, which is 3M.

At 109 tinybar per gas, the reserve is **3.27 HBAR**, and 2.7628 does not cover
it. A run costing 1.63 needs twice that in the account before it will start.

The price is not a constant either. Hedera prices gas in USD, so tinybar per gas
moves with the exchange rate; a vault funded when HBAR was expensive dies earlier
than its own arithmetic predicts when HBAR falls.

**Reading the price from inside the EVM needs no conversion**, which is the one
piece of good news here and the opposite of what the tinybar/weibar rule below
would lead you to expect:

```
tx.gasprice (in EVM)   109              <- tinybar per gas
eth_gasPrice (RPC)     1140000000000    <- weibar per gas, and marked up
block.basefee          0                <- always zero on Hedera, do not use it
balance after 1 HBAR   100000000        <- tinybar, same unit as tx.gasprice
```

Reproduce it with `contracts/test/GasPriceProbe.sol`, live at `0.0.10685635`:

```bash
npx hardhat run scripts/probeGasPrice.ts --network hederaTestnet
```

`tx.gasprice` also survives `eth_call` — the relay substitutes the network's
price and ignores any the caller nominates — so a view function can report a
live figure rather than a frozen one.

### Confirmed by prediction, not just by post-mortem

The first vault died by accident. A second one was funded deliberately to see
whether the corrected arithmetic could call the death in advance.

Vault `0.0.10685769`, funded with **5 HBAR**, beating every 120 seconds. Before a
single run, the contract was asked what it expected:

```
balance  5.0000 HBAR
reserve  3.2700 HBAR per run   (accepted only above this)
charge   1.6350 HBAR per run   (what it actually costs)
runway   2 runs                <-- prediction
```

What the network then did:

| Time (UTC) | Result | Charged | Balance after |
| --- | --- | --- | --- |
| 18:46:00 | SUCCESS | 1.6331 | 3.3669 |
| 18:47:58 | SUCCESS | 1.6301 | 1.7368 |
| 18:49:56 | **INSUFFICIENT_PAYER_BALANCE** | 0.0231 | 1.7137 |

Two runs, as predicted, and the vault stopped holding **1.74 HBAR** — again more
than the 1.63 a run is charged, and again below the 3.27 it must reserve. The old
arithmetic would have reported one run remaining at that moment. `runway()` read
`0`.

Reproduce the whole thing in about six minutes:

```bash
cd packages/hardhat
FUEL_HBAR=5 INTERVAL=120 npx hardhat run scripts/armVault.ts --network hederaTestnet
```

### The same rule applies to your own wallet

This is not only a contract problem. Every transaction reserves its gas limit
against the *sender's* balance before the relay will submit it, so a generous
`gasLimit` on a cheap call quietly locks up HBAR the sender may not have.

Arming a vault burns **1,501,968** gas. Sending it with `gasLimit: 4_000_000`
reserves about **4.6 HBAR** to do it. Fund a vault with most of your balance and
the next line fails:

```
ProviderError: Insufficient funds for transfer
```

— which is how this got measured: an owner with 4.68 HBAR could not arm a vault
they had just funded with 5. `scripts/armVault.ts` now arms at 2.5M, which is
still 66% headroom over what the call burns and reserves ~2.9 HBAR instead.

**What Nocturne does:** `reservePerRun()` returns
`MIN_SCHEDULE_GAS * tx.gasprice`, and `runway()` divides the balance by that
rather than by what a run has historically cost. The earlier constant,
`TINYBAR_PER_RUN`, is kept and reported, but only as context; using it to size a
deposit overstates the runway by about half.

---

## 6. Inside a scheduled call, the balance is already down the whole allowance

A contract reading its own balance during a scheduled execution does not see what
it will end up with. It sees the balance **after the entire gas allowance has
been debited**, because the refund of unused gas only lands once the call
returns.

Measured on vault `0.0.10690925`, funded with exactly 4 HBAR:

```
FuelLow emitted during the run   73000000 tinybar   = 0.73 HBAR
balance after the run settled   222452080 tinybar   = 2.2245 HBAR
actually charged                177547920 tinybar   = 1.7755 HBAR
```

`4.00 - 3.27 = 0.73` to the tinybar, where 3.27 is `MIN_SCHEDULE_GAS` at 109
tinybar per gas. The run was then charged 1.7755 and the remaining 1.49 came
back.

So a fuel check written inside the scheduled call is reading a number that is a
full reserve too low, and will believe the vault is nearly empty when it has
comfortably more than a run left. **Anything that acts on that — disarming,
halting, refusing to book a successor — stops a vault that was fine**, and it
stops it from inside a transaction that reports SUCCESS.

**What Nocturne does:** the understatement is left in place deliberately, because
it errs in the safe direction: `FuelLow` warns a run early rather than a run
late, and nothing in the vault ever *acts* on `runway()` — it is a signal to the
owner, not a control input. `_bookNext` runs unconditionally, so a vault that
looks broke inside a call still books its successor and lets the network decide
whether it can pay.

The consequence worth remembering: `runway()` read from outside and `runway()`
read during a scheduled run will legitimately disagree by one.

---

## A useful fact, for once

**A scheduled call arrives with `msg.sender` set to the contract itself.** The
network runs it as though the contract called itself; `tx.origin` is the contract
too, not the account that created the schedule.

```
sender = 0x03F7F064E6ceD8e154e3FdAAF92DcCC4e818E97B   <- the probe contract
origin = 0x03F7F064E6ceD8e154e3FdAAF92DcCC4e818E97B   <- also the contract
lag    = -1s                                          <- fired a second early
```

Reproduce with `contracts/test/ScheduledSenderProbe.sol` (live at
`0x03F7F064E6ceD8e154e3FdAAF92DcCC4e818E97B`), which books a call to itself and
records what it was handed.

This matters because a self-rescheduling entry point has to be permissionless —
there is no caller to authenticate, and locking it down would mean a stalled
chain could never be revived. `msg.sender` gives such a function a way to tell
its own wake-up call from an uninvited one without giving up that property.

`NocturneVault` uses it for exactly one thing. An uninvited caller inside the
`CLOCK_SKEW` window advances `nextRunAt`, which orphans the schedule already
booked; the orphan fires, finds the vault not due, does nothing, and the vault is
charged a full execution for it. So when `msg.sender != address(this)`, the vault
releases the pending schedule before booking the next one.

The lag also confirms landmine 2 from a second, independent contract.

---

## And three more that are not about scheduling

### `scheduleCall` never reverts

It signals failure with a response code and a zero address. Code that ignores the
return value believes it scheduled something that does not exist. Nocturne checks
both the raw call and the decoded code.

### The Schedule Service has no EVM bytecode

`eth_getCode(0x16b)` returns `0x`. Solidity ≥ 0.8.10 skips its `extcodesize`
check when a call is expected to return data, so typed calls happen to work — but
a call with no return value would revert in a frame `try/catch` cannot see.
Nocturne uses raw `call` and `staticcall` throughout, which also means the same
bytecode deploys to a chain without HSS and degrades to "scheduling unavailable"
rather than reverting.

### HBAR is tinybar inside the EVM and weibar over JSON-RPC

Exactly `1e10` apart.

```
eth_getBalance (relay)        60000000000000000000   weibar, 18 dp
address(this).balance (EVM)             6000000000   tinybar, 8 dp
```

WHBAR is 8 decimals, so WHBAR and in-EVM HBAR are 1:1. A tinybar figure passed as
a transaction `value` underfunds by ten billion times, and the only symptom is a
vault that stops after one run.

### EIP-1167 clones break scheduling entirely

A schedule booked from inside a `DELEGATECALL` frame is created with a
`delegatable_contract_id` admin key instead of a plain `contractID` key. The key
is accepted at creation and then not handled by the payer-signature check at
execution, so the schedule fires on time and fails `INVALID_PAYER_SIGNATURE` with
no contract result.

A cloned vault looks armed, funded and scheduled, and never executes once. Open
issue against `hiero-consensus-node` (#27263, reported 2026-09-13).

**Do not put a proxy anywhere in the scheduling path.** `NocturneFactory` deploys
real contracts at roughly thirty times the gas, because the cheap version does
not work. There is a test asserting the deployed bytecode is not a minimal proxy,
purely so that this stays a decision rather than an accident.

---

*Measured 2026-09-22 and 2026-09-23. Re-run the commands before trusting them;
networks move.*
