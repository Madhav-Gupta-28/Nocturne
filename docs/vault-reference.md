# Vault reference

Every function on `NocturneVault`, what it does, and the ones that will surprise
you. The vault is `Ownable` and `ReentrancyGuard`; `onlyOwner` is noted where it
applies.

---

## 01 · Constants

None of these have setters. They are the vault's contract with the network, not
configuration.

| Constant | Value | Why |
| --- | --- | --- |
| `MIN_SCHEDULE_GAS` | `3_000_000` | A self-rescheduling entry point needs ~1.5M. At 1M the inner `scheduleCall` runs out and **the outer call still reports SUCCESS**. |
| `GAS_PER_RUN` | `1_500_000` | What a run actually burns (1,495,298 measured), used for runway arithmetic. |
| `MIN_INTERVAL` | `60` | Seconds. The floor a strategy's answer is clamped to. |
| `MAX_INTERVAL` | `60 days` | The ceiling. Hedera refuses schedules beyond 62 days. |
| `CLOCK_SKEW` | `10` | Seconds of tolerance. **A scheduled call arrives with `block.timestamp` about 2s early.** |
| `TINYBAR_PER_RUN` | `160_000_000` | 1.6 HBAR, a run's observed cost. For context only; runway uses the two views below. |
| `FALLBACK_GAS_PRICE` | `109` | Tinybar per gas, for chains where `tx.gasprice` is zero. |
| `FUEL_WARN_RUNS` | `5` | Runway at which `FuelLow` is emitted. |

---

## 02 · Setup

### `setStrategy(address) onlyOwner`

Points the vault at a different strategy. The factory already set one at
creation, so you only need this to change it. It **starts from nothing**: it
disarms, releases the pending schedule, deletes the config, and clears every
allow-list grant by bumping `grantEpoch`, so nothing made for the old strategy
carries over. Emits `GrantsCleared` and `StrategySet`.

### `configure(bytes) onlyOwner`

Stores the strategy's config blob. Calls `strategy.validateConfig(config)` first
and reverts with `InvalidConfig` if it returns false — so a bad config fails in
front of you rather than at 3am inside a scheduled call.

**It also disarms.** Re-configuring a running vault releases the pending
schedule and sets `armed = false`, because the next execution would otherwise
fire against a config the owner has already replaced. Call `arm()` again when
you are done.

### `setAllowedCall(address target, bytes4 selector, bool) onlyOwner`

Grants or revokes permission for one exact `(target, selector)` pair.

Keyed on **both**, deliberately. A target-only allow-list that permits a token
for `approve` equally permits `transfer(attacker, balance)`. That was a real
hole in an earlier version of this vault.

### `allowedCall(address, bytes4) → bool`

Reads the grant for the current epoch.

### `associate(address token) onlyOwner → int64`

Associates an HTS token so the vault can hold it. Returns the raw Hedera
response code: **22 is success**, 167 means the address is not an HTS token.
Required before any token transfer in.

---

## 03 · Funds

| Function | Who may call it |
| --- | --- |
| `depositHbar() payable` | **Anyone.** Adds fuel. A plain HBAR transfer works too. |
| `depositToken(address, uint256) onlyOwner` | Pulls tokens in. Associate first. |
| `withdrawHbar(uint256 tinybar) onlyOwner` | Takes HBAR out. |
| `withdrawToken(address, uint256) onlyOwner` | Takes tokens out. |

Deposits are open so a third party can keep a public vault alive. Withdrawals
never are, and they always go to the owner.

Amounts are **tinybar**, 8 decimals — not wei. See
[fuel and runway](/docs/fuel#05--tinybar-weibar-and-a-silent-overspend).

---

## 04 · Running

### `arm() onlyOwner`

Books the first execution and sets `armed = true`. Reverts with `AlreadyArmed`
if it is already running, and `NotConfigured` if `config` is empty. So the order
is `configure` and `setAllowedCall`, in either order, then `arm`.

> Send this with a **gas limit of at least 2,500,000**. `scheduleCall` alone
> costs about 1.4M, and a 4M limit makes the network reserve ~4.6 HBAR from the
> *owner's* account for the duration of the call.

### `disarm() onlyOwner`

Sets `armed = false` and releases the pending schedule. A schedule that has
already been booked may still fire; `executeScheduled` returns immediately when
the vault is not armed, so that costs one wasted execution and nothing else.

### `executeScheduled()`

The entry point the network calls. **No access control, on purpose** — anyone
can restart a chain that stopped.

The ordering inside it is the whole design:

1. Return if not armed.
2. Return if too early, tolerating `CLOCK_SKEW`.
3. If `msg.sender != address(this)`, release the pending schedule — this call is
   a manual revival, so the orphan booking would otherwise fire and waste a run.
4. `++runCount`
5. **Book the successor.** Before any work.
6. `try strategy.plan(config)`. An empty plan emits `Refused`; a plan with a
   call off the allow-list emits `PlanRejected`; otherwise it executes.
7. Emit `FuelLow` if the runway is at or below `FUEL_WARN_RUNS`.

Step 5 before step 6 is not a detail. If planning reverted and took the booking
with it, the chain would end there — silently, with a transaction that reported
success.

> **A scheduled call arrives with `msg.sender == address(this)`.** The network
> runs it as though the vault called itself. Measured, not assumed — see
> `contracts/test/ScheduledSenderProbe.sol`, which the network fired with sender
> and origin both equal to the probe.

---

## 05 · Views

| View | Returns |
| --- | --- |
| `status()` | `(armed, runs, refusals, nextAt, runsRemaining)` — everything a UI needs in one call |
| `runway()` | Executions the current balance can still pay for |
| `reservePerRun()` | Tinybar the balance must clear for the next run to be accepted |
| `chargePerRun()` | Tinybar a run is actually charged, about half the reserve |
| `runCount()`, `refusalCount()` | Runs so far, and how many of them declined |
| `nextRunAt()`, `lastRunAt()` | Unix seconds |
| `nextSchedule()` | The pending schedule's address, for HashScan |
| `fuel()` | Balance in tinybar |
| `preview()` | `strategy.explain(config)` — what it would say right now, running nothing |

---

## 06 · Events

The ones worth indexing. The rest (`Armed`, `Configured`, `CallAllowed`,
deposits and withdrawals) record setup and funding.

```solidity
event Executed(uint64 indexed run, uint256 actions, uint256 nextAt);
event Refused(uint64 indexed run, string reason, uint256 a, uint256 b);
event PlanRejected(uint64 indexed run, address target);
event ActionFailed(uint64 indexed run, uint256 index, address target, bytes reason);
event PlanReverted(uint64 indexed run, bytes reason);

event ScheduleBooked(address indexed schedule, uint256 at);
event ScheduleFailed(int64 responseCode, uint256 at);
event FuelLow(uint256 tinybarBalance, uint256 runsRemaining);
```

`Refused` is the one that matters most. A vault that declines to act changes
nothing on chain — no swap, no transfer, no balance moves — so this event is the
only trace that it looked and decided not to. It carries the strategy's own
words and two supporting numbers.

It is emitted for **every empty plan**, including a healthy one. A protective
exit above its floor logs `Refused(run, "holding", price, floor)`, and
`refusalCount` counts it. Read the reason, not the event name: `holding`,
`balanced` and `nothing held` are a vault doing its job; `sources disagree` and
`feed stale` are the guard stopping a trade.

`ScheduleFailed` carries a raw Hedera response code because
**`scheduleCall` never reverts**. It returns a zero address and a non-22 code,
which is trivially easy to ignore — so the vault checks it and emits.

---

## 07 · Errors

```solidity
error ZeroAddress();
error ZeroAmount();
error NotConfigured();
error InvalidConfig();      // strategy.validateConfig returned false
error AlreadyArmed();
error NotArmed();
error InsufficientBalance();
```

---

## 08 · The factory

`NocturneFactory` builds one vault per call and remembers who owns what.

```solidity
function createVault(address strategy) external payable returns (address vault);
function latestVaultOf(address owner) external view returns (address);
function vaultOf(address owner, uint256 index) external view returns (address);
function vaultCount(address owner) external view returns (uint256);
function vaultsOf(address owner) external view returns (address[] memory);
function vaultsOf(address owner, uint256 offset, uint256 limit) external view returns (address[] memory);
function totalVaults() external view returns (uint256);
function allVaults(uint256 offset, uint256 limit) external view returns (address[] memory);
```

Attach the fuel to `createVault` and the vault is funded at birth. The caller is
the vault's owner from its constructor onward, and the strategy is already set.

> **Vaults are deployed with `new`, not cloned.** EIP-1167 minimal proxies break
> HSS scheduling: a delegatecall frame gets a `delegatable_contract_id` admin
> key, and `scheduleCall` then fails with `INVALID_PAYER_SIGNATURE`
> (hiero-consensus-node #27263). The full-bytecode deploy costs more gas and is
> the only thing that works. Written up under
> [dead ends](/docs/dead-ends).

---

→ Next: [the six ways this fails silently](/docs/landmines).
