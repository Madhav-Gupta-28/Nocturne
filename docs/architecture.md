# Architecture

Six contracts. One of them holds money, one of them decides things, and the
other four are strategies or instruments.

> The long version — threat model, invariants, every chain fact marked as
> measured or assumed — is `ARCHITECTURE.md` in the repository. This page is
> the shape of it.

---

## 01 · The split

Custody and judgement are separated, and that separation is the design.

| | Holds funds | Can write state | Decides what to do |
| --- | --- | --- | --- |
| `NocturneVault` | Yes | Yes | No |
| A strategy | No | **No** | Yes |

A strategy is a pure planner. It is reached through `staticcall`, so a strategy
that tries to write state is rejected by the EVM rather than by a code review.
It never holds a token, never holds an allowance, and never sees a private key.

That means a bad strategy can waste a run. It cannot take anything.

```
     ┌────────────────┐        staticcall        ┌──────────────┐
     │  NocturneVault │ ───────────────────────▶ │  IStrategy   │
     │                │                          │              │
     │  · funds       │ ◀─── Action[] + gap ──── │  · plan()    │
     │  · schedule    │                          │  · interval  │
     │  · allow-list  │                          │  (no state)  │
     └───────┬────────┘                          └──────────────┘
             │
             │ scheduleCall(address(this), …)
             ▼
        0x16b — Hedera Schedule Service
```

---

## 02 · The loop

One transaction, and the order inside it is the whole mechanism.

```solidity
function executeScheduled() external nonReentrant {
    if (!armed) return;                          // 1. a stale schedule
    if (block.timestamp + CLOCK_SKEW < nextRunAt) return;   // 2. too early
    if (msg.sender != address(this)) _releaseSchedule();     // 3. manual revival

    uint64 run = ++runCount;
    _bookNext(_clampInterval(_askInterval()));   // 4. BOOK FIRST

    try strategy.plan(config) returns (...) {    // 5. then work
        ...
    }
}
```

Step 4 before step 5 is not a detail. If planning reverted and took the booking
with it, the chain would end there — silently, with a transaction that reported
SUCCESS.

Three consequences fall out of it:

- A strategy that reverts costs **one run**, never the chain.
- `executeScheduled` has **no access control**, so anyone can restart a chain
  that stopped.
- A scheduled call arrives with `msg.sender == address(this)`, which is how the
  vault tells its own wake-up from an uninvited caller.

---

## 03 · The six contracts

| Contract | Job |
| --- | --- |
| `NocturneVault` | Holds funds, books schedules, checks plans, pays its own fee |
| `NocturneFactory` | One vault per call, funded at birth, ownership transferred out |
| `HeartbeatStrategy` | Fixed cadence. The reference implementation, 69 lines |
| `ProtectiveExitStrategy` | Sells to a floor, refuses when sources disagree |
| `DriftRebalanceStrategy` | Holds a ratio, tightens as it drifts |
| `PriceLens` | Stateless view over `PriceGuard`, so a frontend sees what a vault sees |

`PriceGuard` is a library, not a contract — the two-source check is shared code
rather than a deployment, so a strategy cannot be pointed at a different one.

> **Vaults are deployed with `new`, not cloned.** EIP-1167 minimal proxies break
> HSS scheduling: a delegatecall frame gets a `delegatable_contract_id` admin
> key and `scheduleCall` fails with `INVALID_PAYER_SIGNATURE`. Full-bytecode
> deployment costs more gas and is the only thing that works.

---

## 04 · What the vault refuses

A plan is not trusted. Before anything runs:

1. **Every action needs a grant** for its exact `(target, selector)` pair. Not
   the target alone — allowing a token for `approve` would otherwise equally
   allow `transfer(attacker, balance)`.
2. **`value` must be zero.** The allow-list bounds what may be called, not how
   much may be sent, so a payable target would otherwise be a way to hand over
   the balance.
3. **The whole plan is rejected, or none of it is.** A partially-permitted plan
   runs nothing rather than running its permitted prefix.

Grants are keyed by a `grantEpoch` that `setStrategy` increments, so permissions
made for one strategy can never be inherited by the next.

---

## 05 · The money

The vault is the schedule's payer. Two numbers govern it and they are not the
same number:

| | Tinybar | |
| --- | --- | --- |
| `reservePerRun()` | `3_000_000 × gasPrice` | What the balance must clear |
| `chargePerRun()` | `1_500_000 × gasPrice` | What a run actually costs |

```
runway = (balance − reserve) / charge + 1
```

Hedera tests the payer against the whole gas allowance, then charges only for
gas burned. Fund against the charge and a vault stops with roughly twice a run's
worth still in it.

→ [Fuel and runway](/docs/fuel) has the arithmetic and the funding table.

---

## 06 · What is deliberately absent

| Not here | Why |
| --- | --- |
| An upgrade proxy | A vault that can be upgraded is a vault whose owner can rewrite the rules after you fund it |
| A fee | Nothing to collect, nothing to argue about, nothing to govern |
| A keeper network | The whole point |
| A token | There is no protocol to govern |
| Off-chain state | The factory's mapping is the only index, and it is on chain |

---

→ Next: [what fails silently](/docs/landmines), and
[what was tried and abandoned](/docs/dead-ends).
