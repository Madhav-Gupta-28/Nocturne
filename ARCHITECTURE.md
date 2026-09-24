# Nocturne — Architecture

**Recurring on-chain jobs on Hedera, without a bot.**

A contract that books its own next execution through the Hedera Schedule Service,
chooses when that should be from what it observes, and refuses to act when its
two price sources disagree. Two strategies ship on top of it: a position that
exits itself, and a portfolio that rebalances itself.

```bash
npm create scaffold-hbar@latest --template <owner>/scaffold-hbar-nocturne
```

> *Nocturne* — a piece written for the night, played whether or not anyone
> is listening.

---

## 0. How to read this file

This is the complete specification. Someone with no prior context should be able
to build Nocturne from this document alone.

Every address, number and interface below was **verified against the live
network on 2026-09-22 or 2026-09-23**, with the command that produced it given
so any reader can re-check rather than trust. Where a claim is unverified or a
judgement call, it is marked **ASSUMPTION** in bold.

Four facts in §3.2 and §3.3 are not in Hedera's documentation anywhere. They
were measured here, and they are the reason this template exists.

| Section | What it answers |
| --- | --- |
| 1 | The problem, and the failure this is a response to |
| 2 | Why this mechanism is correct, from first principles |
| 3 | Verified chain facts, and how to reproduce them |
| 4 | System architecture and component boundaries |
| 5 | The contracts, in full |
| 6 | User flows |
| 7 | The arithmetic |
| 8 | Failure modes |
| 9 | Threat model |
| 10 | Invariants |
| 11 | Test plan |
| 12 | Build order |
| 13 | Open items and known limits |
| 14 | Sources |

---

## 1. The problem

### 1.1 "Self-executing code" has never been self-executing

A smart contract cannot wake up. It runs when somebody calls it, and not
otherwise. Every piece of on-chain automation in production — a vault that
rebalances, a vesting cliff that unlocks, a stop-loss that fires, a loan that
liquidates — is a contract plus **an off-chain process that pokes it**.

That process is Gelato, or Chainlink Automation, or a keeper network, or a cron
job on somebody's VPS. It is the part that is not on-chain, not trustless, and
not free. It is also the part that fails.

### 1.2 Hedera removed the bot, and almost nobody noticed

HIP-1215 lets a contract schedule a call — to another contract or to itself —
from inside the EVM, through the Hedera Schedule Service at `0x16b`. The network
executes it. There is no keeper, because the consensus nodes *are* the keeper.

Hedera has been saying so loudly. "Self-executing smart contracts" was the
flagship announcement at DevDay 2026. Their own blog on protocol-level
automation puts it plainly:

> *"On other networks, developers must use Chainlink Automation or build custom
> keeper infrastructure. On Hedera, automation is built in."*

And it describes the shape this template implements:

> *"self-monitoring vaults that schedule their own health checks. As positions
> approach liquidation thresholds, contracts schedule increasingly frequent
> monitoring."*

### 1.3 The gap: the promise is not yet implementable

Hedera ships a `ScheduledVault` in the built-in `payments-scheduler` template.
It is good code. It schedules, it re-schedules, it wraps execution in
`try/catch`, it counts consecutive failures.

It cannot do the sentence above. Four gaps, each verified by reading its source:

1. **`intervalSeconds` is fixed.** `IExecutionStrategy.plan()` returns a list of
   actions and nothing else. A strategy has no way to say *when to look again*,
   and `configure()` is `onlyOwner`, so the vault cannot change its own cadence
   mid-flight. "Increasingly frequent monitoring" is not expressible.
2. **No fuel check.** `_schedule()` reserves a 3,000,000 gas limit and never
   verifies the vault holds the HBAR to pay for it. §3.3 shows what happens.
3. **`consecutiveFailures` counts but never backs off.** It halts after N; it
   never slows down or speeds up.
4. **No HTS association.** `depositTokens` calls `transferFrom` on a token the
   vault was never associated with, which fails for any HTS asset (§3.7).

### 1.4 The five ways HSS automation silently breaks

This is the contribution. None of it is in Hedera's documentation.

| # | Landmine | Consequence if unknown | §  |
| --- | --- | --- | --- |
| 1 | A self-rescheduling entry point needs ≥ ~1.5M gas *for the schedule alone* | The job runs once, reports **SUCCESS**, and never runs again. Nothing reverts. | 3.3 |
| 2 | Scheduled calls see `block.timestamp` ~2 seconds **early** | A call scheduled for `deadline + 1` reverts on a `> deadline` check, in production, while every unit test passes | 3.2 |
| 3 | At most **one** scheduled call per transaction | An action that books two schedules is rejected outright and the whole transaction fails | 3.2 |
| 4 | Expiry is capped at **62 days** | A schedule booked further out is refused, and the job silently never exists | 3.2 |
| 5 | The payer must cover the **whole gas allowance**, not the gas burned | A vault funded against what a run *costs* dies with roughly a run's worth of HBAR still in it | 3.3 |

Landmine 1 is the dangerous one, because it does not look like a failure. The
work succeeds. The transaction succeeds. The explorer shows green. The
automation simply stops, forever, and nothing anywhere says why.

Landmine 5 is the one this project got wrong first and fixed afterwards, which
is why it is written down in that order. The first long-running demo vault
stopped after thirteen executions holding **2.7628 HBAR**, having been charged
**1.6299 HBAR** for every run it ever made. It had more than a run's cost left
and the fourteenth still failed with `INSUFFICIENT_PAYER_BALANCE`, because
acceptance is tested against `MIN_SCHEDULE_GAS`, and 3,000,000 gas at 109 tinybar
per gas is **3.27 HBAR**. Sizing a deposit by observed cost overstates the
runway by about half (§3.3).

### 1.5 The failure this design is a response to

On **11 July 2026** an attacker deposited 250 SAUCE — a few dollars — into Bonzo
Lend, pushed the SAUCE oracle price up by about **twelve orders of magnitude**,
and borrowed roughly 6.6M USDC and 34.5M WHBAR against it.

**$9.05M gone.** Bonzo's TVL fell 77%. Hedera's whole-chain TVL fell ~40% in
24 hours. Bonzo paused the lending pool to contain it, and **it is still paused**
— verified on mainnet on 2026-09-23 (§3.8).

The vulnerability was not in Bonzo's contracts. It was a third-party oracle that
lied, and a protocol that believed it.

That matters here for one reason. Nocturne is automation that *acts on a price*.
An automated seller that believes a single manipulated feed is not a safety
tool; it is a liquidation bot working for the attacker. So the first design
constraint of this system is not "act quickly." It is **do not act on a price
you cannot corroborate**.

---

## 2. Why this mechanism is correct

### 2.1 Cadence belongs to the strategy, not the vault

A fixed interval forces one choice forever, and both ends are wrong.

At ~1.6 HBAR per execution (§3.3), checking hourly costs ~38 HBAR/day whether or
not anything is happening. Checking daily costs ~1.6 HBAR/day and can miss a
50% move entirely.

There is no correct constant, because the right frequency depends on **how close
the position is to the thing you care about** — which only the strategy knows.
So `nextInterval()` sits on the strategy interface alongside `plan()`, and the
vault's job is to enforce bounds on what the strategy asks for, not to pick.

This is the smallest possible change to Hedera's own pattern that makes their
own sentence implementable. It is deliberately small: the vault stays a
custody-and-scheduling shell, and the intelligence stays in a strategy that
holds no funds.

### 2.2 One price source is never enough

§1.5 is the argument. A single feed is a single point of failure with a
nine-million-dollar precedent on this exact chain.

Nocturne reads two sources that fail independently:

- **SaucerSwap TWAP** — derived from the pool the trade would actually execute
  against, so it cannot be "right" about a price the trade cannot get.
- **Chainlink** — an off-chain aggregate, live on Hedera testnet with seven
  feeds (§3.6).

They have no common failure mode. Manipulating the pool does not move Chainlink;
corrupting Chainlink does not move the pool.

### 2.3 TWAP, not spot

A spot price from `slot0()` is whatever the last trade left behind. Anyone can
move it inside one transaction with a flash loan, trigger the strategy, and take
the other side. This is not hypothetical — it is a standard attack and it is
close to what happened to Bonzo.

A time-weighted average over `TWAP_WINDOW` costs an attacker the price impact
*sustained across the whole window*, which is a different order of expense.

Uniswap V3's oracle (which SaucerSwap V2 inherits) exposes this through
`observe()`. Verified working on the live testnet pool at cardinality 1 for
short windows; longer windows need `increaseObservationCardinalityNext`, which
is permissionless (§3.5).

### 2.4 Refusing is a feature, and it is the demo

When the two sources disagree by more than `MAX_DIVERGENCE_BPS`, the strategy
returns **no actions** and a **shorter** interval. It does not act. It emits
`SourcesDiverged` with both prices, and looks again sooner.

This is the behaviour that would have saved Bonzo, and on testnet it can be
demonstrated *today* with real data: the SaucerSwap testnet WHBAR/USDC pool
prices HBAR at **$2.05** while Chainlink says **$0.094** — a **21.72×**
divergence, verified three ways in §3.5.

**That divergence is honest about its cause: nobody arbitrages testnet pools.**
It is not an attack. It is, however, exactly what a bad price looks like to the
guard, which makes it the right thing to point the demo at — labelled as such.

### 2.5 Two strategies, because one proves nothing

A single strategy and an engine are indistinguishable from an app. Two
strategies of **different shapes** on one engine is the evidence that the
abstraction holds:

- **Protective exit** — a threshold breach. One-way, terminal, urgent.
- **Drift rebalance** — a continuous target. Two-way, repeating, economic.

If `nextInterval()` and `plan()` express both without special cases, the
interface is right, and a third strategy is a file rather than a rewrite.

---

## 3. Verified chain facts

Reproduce anything here with the command beside it. `$RPC` is
`https://testnet.hashio.io/api` unless stated.

### 3.1 Networks

| | Chain ID | JSON-RPC | Mirror node |
| --- | --- | --- | --- |
| Hedera testnet | 296 | `https://testnet.hashio.io/api` | `https://testnet.mirrornode.hedera.com` |
| Hedera mainnet | 295 | `https://mainnet.hashio.io/api` | `https://mainnet.mirrornode.hedera.com` |

```bash
cast chain-id --rpc-url https://testnet.hashio.io/api   # 296
```

### 3.2 HIP-1215 / Hedera Schedule Service

System contract `0x16b`. Success response code is **22**.

```solidity
function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit,
                      uint64 value, bytes memory callData)
    returns (int64 responseCode, address scheduleAddress);
function scheduleCallWithPayer(address to, address payer, uint256 expirySecond,
                      uint256 gasLimit, uint64 value, bytes memory callData)
    returns (int64, address);
function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit)
    view returns (bool);
function deleteSchedule(address scheduleAddress) returns (int64);
```

**`scheduleCall` never reverts.** On failure it returns a zero address and a
non-22 code. A caller that ignores the return value believes it scheduled
something that does not exist.

Live and answering on testnet:

```bash
cast call 0x000000000000000000000000000000000000016b \
  "hasScheduleCapacity(uint256,uint256)(bool)" $(( $(date +%s) + 600 )) 500000 \
  --rpc-url $RPC        # true
```

**Measured limits** (the last three carried forward from a prior production
build on this chain, all previously verified on-chain):

| Fact | Value | How it was established |
| --- | --- | --- |
| Max expiry ahead | **5,356,800 s = 62 days** | `hasScheduleCapacity` true at exactly 62 days, false at 63, on testnet *and* mainnet |
| Scheduled-call clock | runs **~2 s early** | A call scheduled for `1788608600` executed at consensus `1788608600.149` and observed `block.timestamp == 1788608598` |
| Schedules per transaction | **exactly 1** | A second booking in the same transaction is rejected with `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`, failing the whole transaction |
| `eth_estimateGas` | **under-reports** | 277,394 estimated vs 472,252 actually charged for the same call. Budget from receipts |

**A scheduled execution may itself book exactly one successor.** This is what
makes an unattended chain possible, and it is verified below.

### 3.3 The silent death — measured, with a working control

Two contracts were deployed to testnet that differ **only** in the gas reserved
for the scheduled call. Both are live.

| Contract | scheduled gas | network fired it? | booked a successor? |
| --- | --- | --- | --- |
| `0xb4f980DBdb7b62f5193d5Ab0680DB468b5143445` | 1,000,000 | yes, `ticks` 1 → 2 | **no** — `rc -102`, schedule `0x0` |
| `0xAC43ea09aBb40C957488fedBa2E68a3e022ef651` | 3,000,000 | yes, `ticks` 1 → 2 → 3 → 4 | **yes** — `rc 22`, new schedule each time |

`scheduleCall` costs **~1.4M gas on its own**; the full self-rescheduling
entry point measured **1,511,731 gas**. With a 1,000,000 limit the scheduled
execution had ~970,000 available, the inner `scheduleCall` reverted, and because
a correct implementation catches that failure rather than propagating it, the
outer call **still succeeded**.

The under-gassed contract flatlined for the entire observation window:

```
17:45  ticks=1  rc=22    scheduled 0xA2Ca8d
17:46  ticks=2  rc=-102  scheduled 0x0        ← fired once, chain dead
17:47 … 17:53   ticks=2  rc=-102  scheduled 0x0
```

**Cost per execution ≈ 1.6 HBAR**, measured from the funded contract's balance:
40.00 → 35.21 HBAR across three unattended executions. The contract is the
schedule's `payer_account_id`, so it pays for its own future gas.

**The balance it must hold is roughly twice that**, because the payer is tested
against the whole `MIN_SCHEDULE_GAS` allowance and only charged for the gas it
burns (§1.4 landmine 5, §7.2). Budget 3.27 HBAR per run, not 1.63.

This is why `NocturneVault` enforces a `MIN_SCHEDULE_GAS` floor, exposes
`runway()` and `reservePerRun()`, and emits `FuelLow`. It is also why the demo shows a live tick
counter: an automation you cannot see the liveness of is an automation you
cannot trust.

Reproduce:

```bash
cast call 0xAC43ea09aBb40C957488fedBa2E68a3e022ef651 "ticks()(uint256)"  --rpc-url $RPC
cast call 0xb4f980DBdb7b62f5193d5Ab0680DB468b5143445 "ticks()(uint256)"  --rpc-url $RPC
```

### 3.4 Hedera landmines that bite this design

1. **HBAR is tinybar inside the EVM and weibar over JSON-RPC.** Exactly `1e10`
   apart. A contract that hard-codes an 18-decimal HBAR amount will fail.

   ```
   eth_getBalance (relay)        60000000000000000000   (weibar, 18 dp)
   address(this).balance (EVM)             6000000000   (tinybar, 8 dp)
   ```

   WHBAR is 8 decimals, so **WHBAR and in-EVM HBAR are 1:1**.

2. **HTS system contracts have no EVM bytecode.** `eth_getCode(0x16b)` returns
   `0x`. Solidity ≥ 0.8.10 skips the `extcodesize` check for calls that return
   data, so typed interface calls to `scheduleCall` work — but a call with **no
   return value** would revert. Nocturne uses raw `call`/`staticcall` to HSS
   regardless, so the same bytecode is deployable on a chain without HSS and
   degrades to "scheduling unavailable" rather than reverting.

3. **HTS tokens require association before an account can receive them**, and
   that includes contracts (§3.7).

4. **`forge script --gas-limit` is silently ignored.** It aliases
   `--block-gas-limit`. The flag that matters is `-g` /
   `--gas-estimate-multiplier`. Deployments on Hedera need a large multiplier
   (`-g 2500`) *and* an account fat enough to cover the reservation; ordinary
   calls need a small one (`-g 140`) or they fail with *Insufficient funds for
   transfer* on an account that plainly has funds — that is the reservation, not
   the fee.

5. **A forge script cannot schedule.** Scheduling must happen inside a
   transaction sent to a deployed contract, not from a script's simulated frame.

### 3.5 SaucerSwap V2 — verified live on testnet

All confirmed to have bytecode on 2026-09-22.

| Contract | Hedera ID | EVM address |
| --- | --- | --- |
| V2 Factory | `0.0.1197038` | `0x00000000000000000000000000000000001243ee` |
| V2 SwapRouter | `0.0.1414040` | `0x0000000000000000000000000000000000159398` |
| V2 QuoterV2 | `0.0.1390002` | `0x00000000000000000000000000000000001535b2` |
| WHBAR contract | `0.0.15057` | `0x0000000000000000000000000000000000003aD1` |
| WHBAR token | `0.0.15058` | `0x0000000000000000000000000000000000003aD2` |
| SAUCE | `0.0.1183558` | `0x0000000000000000000000000000000000120f46` |
| USDC | `0.0.5449` | `0x0000000000000000000000000000000000001549` |

**The SwapRouter is the original Uniswap V3 router, not SwapRouter02** —
established from the deployed bytecode, not from documentation:

```
selector 0x414bf389  exactInputSingle(...,uint256 deadline,...)   present
selector 0x04e45aaf  exactInputSingle(...no deadline...)          absent
selector 0x12210e8a  refundETH                                    present
selector 0xac9650d8  multicall                                    present
```

So the struct **includes `deadline`**:

```solidity
struct ExactInputSingleParams {
    address tokenIn; address tokenOut; uint24 fee; address recipient;
    uint256 deadline; uint256 amountIn; uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}
```

**Reference pool — WHBAR/USDC, fee 3000:** `0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a`

```
token0 = USDC  (6 dp)      token1 = WHBAR (8 dp)
liquidity = 120,043,203,390        tick = 38874        unlocked = true
```

Quote sanity check — 10 WHBAR in:

```bash
cast call 0x00000000000000000000000000000000001535b2 \
  "quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)" \
  "(0x…3aD2,0x…1549,1000000000,3000,0)" --rpc-url $RPC      # 20416521 = 20.42 USDC
```

**TWAP is available now.** `observe([60,0])` returns two tick cumulatives on the
live pool at `observationCardinality = 1`, so a 60-second TWAP is computable
today. Longer windows need `increaseObservationCardinalityNext(uint16)`, which
anyone may call.

**The divergence, verified three independent ways** (quoter, `sqrtPriceX96`
arithmetic, and `1.0001^tick`, all agreeing):

```
1 WHBAR = 2.050231 USDC   (pool)
HBAR/USD = $0.094407      (Chainlink)
divergence = 21.72x
```

Cause: testnet pools are not arbitraged. Not an attack — but exactly the input
the guard exists to reject.

### 3.6 Chainlink price feeds — verified live on testnet

Standard `AggregatorV3Interface`, 8 decimals.

| Pair | Address |
| --- | --- |
| HBAR/USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` |
| BTC/USD | `0x058fE79CB5775d4b167920Ca6036B824805A9ABd` |
| ETH/USD | `0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9` |
| USDC/USD | `0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5` |
| DAI/USD | `0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389` |
| LINK/USD | `0xF111b70231E89D69eBC9f6C9208e9890383Ef432` |
| USDT/USD | `0x06823de8E77d708C4cB72Cbf04495D67afF4Bd37` |

Freshness measured 2026-09-23:

```
HBAR/USD  $0.093934   updated 105 s ago
ETH/USD   $2,713.97   updated 51 m ago
USDC/USD  $0.999931   updated 18.8 h ago   (deviation-triggered; normal)
```

Nocturne therefore treats **staleness as divergence**: a feed older than
`MAX_FEED_AGE` is not a second opinion, and the strategy refuses rather than
falling back to one source.

### 3.7 HTS association from a contract — verified

```solidity
IHederaTokenService(0x167).associateToken(address account, address token)
    returns (int64 responseCode);   // 22 = SUCCESS
```

A contract associates **itself** by passing `address(this)`. Verified: response
code 22, and the contract account `0.0.10678190` shows two associations on the
mirror node afterwards.

**Only genuine HTS tokens can be associated.** Associating a plain ERC-20
contract returns **167 = `INVALID_TOKEN_ID`** and is a no-op. This was
established by attempting to associate a Bonzo aToken (a real ERC-20 with 3,561
bytes of code and symbol `amWHBAR`) and getting 167 while the two real HTS
tokens returned 22.

So the rule Nocturne follows: **associate the tokens it will custody; never
associate a contract-deployed ERC-20.**

Association is idempotent-ish but not free, so it is done once at vault
creation, and `NocturneFactory` funds the new vault with enough HBAR to pay for it.

### 3.8 Dead ends — documented so the next person does not repeat them

**Bonzo Lend cannot be integrated.** Three independent paths, all closed
(verified 2026-09-23):

| Deployment | State | `deposit()` result |
| --- | --- | --- |
| mainnet `0x236897c518996163E7b313aD21D1C9fCC7BA1afc` | `paused() = true` | reverts `"64"` = `LP_IS_PAUSED` |
| testnet `0x7710a96b01e02eD00768C3b39BfA7B4f1c128c62` | `paused() = true` | reverts `"64"` |
| testnet `0xf67DBe9bD1B331cA379c44b5562EAa1CE831EbC2` | not paused | reverts `CALLER_NOT_AUTHORIZED` |

The third is an **allowlist, not a contract block** — an EOA fails identically,
at ~221k gas, which is a modifier at the top of the call. The pause is the
aftermath of §1.5.

Two further traps found here and worth stating:

- **`LendingPoolAddressesProvider.getLendingPool()` — the canonical Aave
  discovery path — returns the *paused* pool.** Following best practice leads
  to the dead deployment.
- **The published `bonzo-contracts.json` is partly stale.** Its `PriceOracle`
  disagrees with what the addresses provider returns on-chain.

**SaucerSwap farms do not exist on testnet.** `Masterchef`
(`0x000000000000000000000000000000000011fe23`) reports `poolLength() = 0`, though
`saucePerSecond` is configured at 4,700,000. An auto-compounding strategy is
therefore not buildable where a developer scaffolding this template could run
it, and is out of scope (§13).

---

## 4. System architecture

### 4.1 Components

```
packages/foundry/            (or hardhat — the manifest declares both)
  contracts/
    NocturneVault.sol           custody + HSS scheduling + fuel. Holds funds.
    NocturneFactory.sol         one vault per user, per strategy. Real deploys.
    interfaces/
      INocturneStrategy.sol     plan() + nextInterval(). Pure. Holds nothing.
      IHederaScheduleService.sol
      IHederaTokenService.sol
      ISwapRouter.sol        SaucerSwap V2 (Uniswap V3 shape, with deadline)
      IUniswapV3PoolOracle.sol  observe(), slot0()
      AggregatorV3Interface.sol
    lib/
      TwapLib.sol            tick cumulatives -> price, decimal-aware
      PriceGuard.sol         two-source agreement + staleness
    strategies/
      ProtectiveExitStrategy.sol
      DriftRebalanceStrategy.sol

packages/nextjs/
  app/                       arm a position, watch it tick, see refusals
  lib/                       mirror-node reads; no backend, no indexer
```

### 4.2 The separation that makes this safe

**The vault holds funds and cannot decide anything. The strategy decides
everything and cannot hold funds.**

A strategy is a `view` planner. It reads prices, returns an ordered list of
calls and a requested interval. It never receives tokens, never holds an
allowance, and can be swapped out by the owner.

The vault executes those calls **as itself**, so a hostile strategy could at
worst propose calls that lose the vault's own money — which is why the vault
bounds what it will execute (§9). This mirrors the separation Hedera's own
`ScheduledVault` established, and Nocturne keeps it deliberately rather than
inventing a new one.

### 4.3 Data flow of one unattended cycle

```
HSS (network)
   │  calls executeScheduled() at the booked second
   ▼
NocturneVault
   │  1. book the NEXT schedule FIRST (see §8.1)
   │  2. staticcall strategy.plan(config)
   ▼
Strategy (view)
   │  reads SaucerSwap TWAP  ── observe()
   │  reads Chainlink        ── latestRoundData()
   │  agree?  ──no──►  return [] and a SHORTER interval
   │     yes
   ▼  returns [approve, exactInputSingle]
NocturneVault
   │  3. execute each action, catching failures per action
   │  4. emit Executed / Refused / FuelLow
   ▼
SaucerSwap SwapRouter  ── the swap that actually moves the position
```


---

## 5. The contracts

### 5.1 `INocturneStrategy`

The whole contribution is the second function.

```solidity
interface INocturneStrategy {
    struct Action { address target; uint256 value; bytes data; }

    /// @notice The calls the vault should execute now. Empty means "do nothing".
    /// @dev MUST be view. MUST NOT revert on a merely unfavourable market —
    ///      returning an empty array is how a strategy declines.
    function plan(bytes calldata config) external view returns (Action[] memory);

    /// @notice How many seconds until the vault should look again.
    /// @dev This is the gap Hedera's ScheduledVault leaves open. The strategy
    ///      knows how close the position is to the thing that matters; the
    ///      vault does not. The vault clamps this to [MIN_INTERVAL, MAX_INTERVAL].
    function nextInterval(bytes calldata config) external view returns (uint256);

    /// @notice Reject malformed config at configure() time, not at 3am.
    function validateConfig(bytes calldata config) external view returns (bool);

    /// @notice Human-readable reason for the last plan decision, for the UI and
    ///         for the event log. Pure presentation; never consumed on-chain.
    function explain(bytes calldata config)
        external view returns (string memory state, uint256 a, uint256 b);
}
```

`plan()` being `view` is inherited from Hedera's interface and kept on purpose:
a planner that cannot write cannot be the thing that drains you.

### 5.2 `NocturneVault`

```solidity
contract NocturneVault is Ownable, ReentrancyGuard {
    address private constant HSS = address(0x16b);
    address private constant HTS = address(0x167);
    int64   private constant HSS_SUCCESS = 22;

    /// Measured, not guessed. scheduleCall alone costs ~1.4M (§3.3); the whole
    /// entry point measured 1,511,731. Below this the chain dies silently.
    uint256 public constant MIN_SCHEDULE_GAS = 3_000_000;

    /// Hedera refuses expiry beyond 5,356,800s (62 days). Margin, then clamp.
    uint256 public constant MAX_INTERVAL = 60 days;
    uint256 public constant MIN_INTERVAL = 60;

    /// A scheduled call observes block.timestamp ~2s early (§3.2). Any strategy
    /// that gates on a deadline must be scheduled past it, not at it.
    uint256 public constant CLOCK_MARGIN = 60;

    INocturneStrategy public strategy;
    bytes   public config;
    address public nextSchedule;
    uint64  public lastRunAt;
    uint64  public runCount;
    uint64  public refusalCount;
    bool    public armed;

    event Armed(uint256 firstRunAt, address schedule);
    event Disarmed();
    event Executed(uint64 indexed run, uint256 actions, uint256 nextAt);
    event Refused(uint64 indexed run, string reason, uint256 a, uint256 b);
    event ActionFailed(uint64 indexed run, uint256 index, address target, bytes reason);
    event ScheduleBooked(address schedule, uint256 at);
    event ScheduleFailed(int64 rc, uint256 at);
    event FuelLow(uint256 tinybarBalance, uint256 estimatedRuns);
    event Associated(address token, int64 rc);

    // ---- lifecycle ----
    function associate(address token) external onlyOwner;   // HTS, §3.7
    function depositHbar() external payable;                // tinybar, §3.4
    function depositToken(address token, uint256 amount) external onlyOwner;
    function withdrawHbar(uint256 tinybar) external onlyOwner nonReentrant;
    function withdrawToken(address token, uint256 amount) external onlyOwner nonReentrant;

    function configure(bytes calldata c) external onlyOwner;
    function arm() external onlyOwner;      // books the first schedule
    function disarm() external onlyOwner;   // deletes the pending schedule

    // ---- the network calls this ----
    function executeScheduled() external nonReentrant;

    // ---- views the UI lives on ----
    function runway() external view returns (uint256 runsRemaining);
    function reservePerRun() external view returns (uint256 tinybar);
    function fuel() external view returns (uint256 tinybar);
    function status() external view
        returns (bool armed_, uint64 runs, uint64 refusals, uint256 nextAt, uint256 runsLeft);
}
```

**`executeScheduled` ordering is the heart of it** (§8.1):

```solidity
function executeScheduled() external nonReentrant {
    require(armed, "not armed");
    uint64 run = ++runCount;
    lastRunAt = uint64(block.timestamp);

    // 1. Book the successor FIRST. If the strategy or an action reverts, the
    //    chain must still survive. Hedera permits exactly one schedule per
    //    transaction (§3.2), so this is the only one we may book.
    uint256 gap = _clamp(_askInterval());
    _bookNext(gap);

    // 2. Plan. A strategy that reverts is a bug, not a reason to stop.
    try strategy.plan(config) returns (INocturneStrategy.Action[] memory actions) {
        if (actions.length == 0) {
            refusalCount++;
            (string memory why, uint256 a, uint256 b) = _explainSafely();
            emit Refused(run, why, a, b);
        } else {
            for (uint256 i; i < actions.length; ++i) {
                (bool ok, bytes memory ret) =
                    actions[i].target.call{value: actions[i].value}(actions[i].data);
                if (!ok) { emit ActionFailed(run, i, actions[i].target, ret); break; }
            }
            emit Executed(run, actions.length, block.timestamp + gap);
        }
    } catch (bytes memory reason) {
        emit ActionFailed(run, type(uint256).max, address(strategy), reason);
    }

    // 3. Fuel warning, so a dying automation says so before it dies.
    uint256 left = _runway();
    if (left <= FUEL_WARN_RUNS) emit FuelLow(address(this).balance, left);
}
```

`_bookNext` uses raw calls (§3.4 landmine 2) and checks the response code,
because `scheduleCall` does not revert:

```solidity
function _bookNext(uint256 gap) private {
    uint256 at = block.timestamp + gap;
    (bool ok, bytes memory d) = HSS.staticcall(
        abi.encodeWithSelector(IHSS.hasScheduleCapacity.selector, at, MIN_SCHEDULE_GAS));
    if (!ok || d.length < 32 || !abi.decode(d, (bool))) { emit ScheduleFailed(-101, at); return; }

    (ok, d) = HSS.call(abi.encodeWithSelector(
        IHSS.scheduleCall.selector, address(this), at, MIN_SCHEDULE_GAS,
        uint64(0), abi.encodeCall(this.executeScheduled, ())));
    if (!ok || d.length < 64) { emit ScheduleFailed(-102, at); return; }

    (int64 rc, address s) = abi.decode(d, (int64, address));
    if (rc != HSS_SUCCESS || s == address(0)) { emit ScheduleFailed(rc, at); return; }
    nextSchedule = s;
    emit ScheduleBooked(s, at);
}
```

### 5.3 `NocturneFactory`

```solidity
contract NocturneFactory {
    mapping(address => address[]) public vaultsOf;
    event VaultCreated(address indexed owner, address vault, address strategy);

    function createVault(address strategy) external payable returns (address vault);
    function vaultCount(address owner) external view returns (uint256);
}
```

**`new NocturneVault(...)`, never a clone.** EIP-1167 minimal proxies are
`DELEGATECALL`, and a schedule booked from a delegatecall frame receives a
`delegatable_contract_id` admin key that the payer-signature check does not
handle at execution: the schedule fires on time and then fails
`INVALID_PAYER_SIGNATURE`, producing no contract result. Open issue on
`hiero-consensus-node`, reported 2026-09-13 against testnet v0.76.

So: **no proxies anywhere in the scheduling path.** Hedera's own
`ScheduledVaultFactory` also deploys real contracts; this is why.

`createVault` is `payable` and forwards the value so a new vault can pay for its
own HTS associations without a second transaction.

### 5.4 `PriceGuard` — the two-source rule

```solidity
library PriceGuard {
    struct Sources {
        address pool;          // SaucerSwap V2 pool
        uint32  twapWindow;    // seconds
        address feed;          // Chainlink AggregatorV3Interface
        uint256 maxFeedAge;    // seconds; stale == diverged
        uint256 maxDivergenceBps;
        bool    assetIsToken0;
        uint8   assetDecimals;
        uint8   quoteDecimals;
    }

    /// @return agreed  both sources present, fresh, and within tolerance
    /// @return price   the CONSERVATIVE of the two for the action at hand
    /// @return twap    pool TWAP, quote-per-asset, 1e18
    /// @return feedPx  Chainlink, normalised to 1e18
    function read(Sources memory s)
        internal view returns (bool agreed, uint256 price, uint256 twap, uint256 feedPx);
}
```

TWAP from tick cumulatives, the standard Uniswap V3 derivation:

```
secondsAgos = [twapWindow, 0]
(tickCumulatives, ) = pool.observe(secondsAgos)
meanTick = (tickCumulatives[1] - tickCumulatives[0]) / twapWindow
   // floor toward negative infinity when the delta is negative
rawPrice = 1.0001 ** meanTick        // token1 per token0, raw units
```
then adjust by `10**assetDecimals / 10**quoteDecimals` to get whole-token price,
inverting when the asset is `token1`. Implemented with
`TickMath.getSqrtRatioAtTick` and `FullMath.mulDiv` — never floating point,
never `**`.

**Which price is used when they agree:** the one less favourable to acting. For
a protective exit that is the *higher* of the two (harder to trigger a sale);
for a rebalance it is the one that produces the *smaller* trade. A guard should
never be made more eager by a disagreement it tolerated.

### 5.5 `ProtectiveExitStrategy`

```solidity
struct ExitConfig {
    address vault;
    address asset;        // HTS token being protected
    address quote;        // what to exit into
    uint24  fee;          // 3000 on the reference pool
    uint256 floorPrice1e18;
    uint256 slippageBps;
    PriceGuard.Sources sources;
}
```

`plan()`:

1. `PriceGuard.read`. If not `agreed` → return `[]`. **This is the refusal.**
2. If `price >= floorPrice` → return `[]` (nothing to do; still healthy).
3. Otherwise return two actions:
   - `asset.approve(swapRouter, balance)`
   - `swapRouter.exactInputSingle({... deadline: block.timestamp + CLOCK_MARGIN ...})`
     with `amountOutMinimum` derived from the agreed price and `slippageBps`.

`nextInterval()` — the sentence Hedera's vault cannot express:

```
d = (price - floor) / floor          // fractional distance above the floor
d <= 0            ->  MIN_INTERVAL        (act now)
d <  0.01         ->  60      seconds
d <  0.05         ->  300     seconds
d <  0.15         ->  3600    seconds
otherwise         ->  21600   seconds     (6 hours)
disagreement      ->  300     seconds     (re-check sooner than the band implies)
```

`amountOutMinimum` is never zero. A scheduled swap with no slippage floor is a
free option for anyone watching the mempool, and on a thin pool it is a
guaranteed loss.

### 5.6 `DriftRebalanceStrategy`

```solidity
struct RebalanceConfig {
    address vault;
    address tokenA; address tokenB;
    uint24  fee;
    uint16  targetBpsA;      // e.g. 5000 = 50/50
    uint16  bandBps;         // act only outside target ± band
    uint256 minTradeValue1e18;
    PriceGuard.Sources sources;
}
```

`plan()`:

1. `PriceGuard.read` → refuse on disagreement, exactly as above.
2. Value both balances in the quote asset; compute `driftBps`.
3. If `|drift| <= band` → `[]`.
4. If the corrective trade's value `< minTradeValue` → `[]`. **A rebalance that
   costs more than it corrects is not a rebalance.** With execution at ~1.6 HBAR
   (§3.3), `minTradeValue` should be set so the trade is worth several
   multiples of that; the README gives the arithmetic (§7.3).
5. Otherwise approve + `exactInputSingle` in the correcting direction.

`nextInterval()` scales on how near the drift is to the band edge — the same
shape as §5.5 but two-sided, which is precisely the point of shipping both
(§2.5).

---

## 6. User flows

### 6.1 Arm a protective exit

1. Connect. Pick asset, quote, floor price, slippage.
2. `factory.createVault(protectiveExit)` — one real deployment, value forwarded.
3. `vault.associate(asset)` and `associate(quote)` — HTS, once (§3.7).
4. `vault.depositToken(asset, amount)` and `vault.depositHbar{value: fuel}()`.
   The UI states the runway in **runs and in days at the current cadence**.
5. `vault.configure(abi.encode(cfg))` — `validateConfig` rejects a bad floor now.
6. `vault.arm()` — books the first schedule; UI shows the countdown and the
   HashScan link to the schedule entity.
7. **Close the tab.**

### 6.2 What the owner sees on return

- run count, refusal count, last run, next run
- the last decision, in words: *"holding — 12.4% above floor"*, or
  *"refused — pool $2.05 vs feed $0.094, 21.7× apart"*, or
  *"exited at $0.0932, received 184.21 USDC"*
- runway in runs, with `FuelLow` surfaced before it matters
- every execution links to the mirror node, and **none of them has a user
  transaction behind it**

### 6.3 Disarm / withdraw

`disarm()` deletes the pending schedule (best-effort; releasing the slot is a
courtesy and must never block a withdrawal) and `withdrawToken` / `withdrawHbar`
return everything. Non-custodial throughout: the owner can always leave.

### 6.4 Verify, as a stranger

```bash
# the vault paid for its own executions; no EOA sent them
curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/<vaultId>/transactions?limit=10"
curl -s "https://testnet.mirrornode.hedera.com/api/v1/schedules/<scheduleId>"
```

`executed_timestamp` non-null and `payer_account_id` equal to the vault's own
account is the proof that nobody poked it.

---

## 7. The arithmetic

### 7.1 Cost of being watched

Measured: **~1.6 HBAR per execution** (§3.3).

| Cadence | Executions/day | HBAR/day | At $0.094 |
| --- | --- | --- | --- |
| 6 hours (calm) | 4 | 6.4 | $0.60 |
| 1 hour | 24 | 38.4 | $3.61 |
| 5 minutes (near trigger) | 288 | 460.8 | $43.31 |

A fixed interval forces one row forever. Adaptive cadence spends the top row
almost always and the bottom row only while it matters. **This table is the
argument for `nextInterval()`, and it is measured rather than asserted.**

### 7.2 Runway

Runway is governed by what a run **reserves**, not what it **costs**, and the two
are roughly a factor of two apart:

```
reservePerRun = MIN_SCHEDULE_GAS * tx.gasprice          // 3_000_000 * 109 = 3.27 HBAR
runsRemaining = floor(tinybarBalance / reservePerRun)
```

The network tests a payer against the whole gas allowance before accepting the
transaction, then charges only for the gas burned (~1.43M of the 3M reserved,
about 1.63 HBAR). Dividing by the observed cost therefore reports fuel the vault
cannot actually spend — which is exactly how the first demo vault died with
2.7628 HBAR in it (§1.4, landmine 5).

Two properties of `tx.gasprice` make this safe to compute on chain, both measured
rather than assumed (`contracts/test/GasPriceProbe.sol`, live at `0.0.10685635`):

- Inside the EVM it is quoted in **tinybar per gas**, the same unit as
  `address(this).balance`, so no 1e10 conversion applies. The JSON-RPC
  `eth_gasPrice` is weibar *and* marked up — 1.14e12 weibar against the EVM's
  109 tinybar.
- It survives `eth_call`: the relay substitutes the network's price and ignores
  any the caller nominates, so a UI reading `runway()` gets a live figure. This
  matters because Hedera prices gas in USD, so tinybar per gas moves with the
  exchange rate and a frozen constant goes wrong on its own.

`block.basefee` is **0** on Hedera and must not be used for this.

`TINYBAR_PER_RUN` (160,000,000) is retained and reported as the observed cost,
for the cadence table in §7.1, but no longer sizes the runway. The UI converts
runway to days using the *current* cadence and says so, because a runway quoted
at calm cadence is a lie during a crash.

### 7.3 When a rebalance is worth doing

Acting costs the execution (~1.6 HBAR) plus the pool fee (0.3%) plus slippage.
The correction is worth `driftBps` of the traded value. So:

```
minTradeValue  >  (executionCost + poolFee + slippage) / driftFraction
```

Default: `minTradeValue1e18` set so the corrected value exceeds **10×** the
round-trip cost. Below that the strategy returns `[]` and waits — which is
itself a decision worth logging.

### 7.4 Why `MIN_SCHEDULE_GAS` is 3,000,000 and not 1,500,000

Measured need is ~1.5M (§3.3). Unused gas is refunded on Hedera, so headroom is
nearly free; the only pressure against a larger reservation is that
`hasScheduleCapacity` is likelier to refuse it. 3M is the value Hedera's own
vault uses, and it survived every test here. 1M does not, and fails **silently**
— which is why this is a hard floor in code and not a parameter.

---

## 8. Failure modes

| Mode | Effect | Handling |
| --- | --- | --- |
| **Under-gassed schedule** | Job runs once, reports success, never runs again | `MIN_SCHEDULE_GAS` floor, enforced in code, not configurable downward (§3.3) |
| **Vault runs out of HBAR** | Automation stops silently | `runway()`, `FuelLow` before it happens, prominent in UI |
| **Strategy reverts** | Would kill the chain | `try/catch`; the successor is booked *before* planning |
| **An action reverts** | Partial execution | Caught per action, `ActionFailed`, loop breaks, chain survives |
| **`scheduleCall` returns non-22** | No successor exists | Return code checked (it never reverts); `ScheduleFailed` emitted; owner can `arm()` again |
| **Network capacity refuses the second** | No successor | `hasScheduleCapacity` probed first; `ScheduleFailed(-101)` |
| **Sources diverge** | Acting would be dangerous | `Refused`, shorter interval, no trade (§2.4) |
| **Chainlink feed stale** | One-sided information | Treated as divergence, not as fallback (§3.6) |
| **Pool has no TWAP history** | `observe` reverts or is thin | `increaseObservationCardinalityNext` at setup; strategy refuses while the window is unmet |
| **Interval beyond 62 days** | Schedule silently never exists | `MAX_INTERVAL = 60 days`, clamped (§3.2) |
| **Two schedules in one tx** | Whole transaction rejected | Exactly one `_bookNext` per execution, structurally (§3.2) |
| **Deadline check fires early** | Scheduled call reverts on `> deadline` | `CLOCK_MARGIN = 60s`; never schedule *at* a boundary (§3.2) |

---

## 9. Threat model

### 9.1 What an attacker cannot do

- **Move one price and trigger a sale.** Both sources must agree within
  `maxDivergenceBps`; they share no failure mode (§2.2).
- **Move the pool inside one block.** The trigger is a TWAP, so the cost is the
  price impact sustained across the window (§2.3).
- **Steal from the vault by calling it.** `executeScheduled` is permissionless
  by necessity — the network calls it — but it moves funds only along the
  strategy's plan, and only to the pool. Withdrawals are `onlyOwner`.
- **Grief by spamming `executeScheduled`.** Each call re-books, but the vault
  pays gas from its own balance; `MIN_INTERVAL` plus an internal
  `lastRunAt + MIN_INTERVAL` guard makes an early call a no-op that books
  nothing. **ASSUMPTION:** rate-limiting `executeScheduled` to one run per
  `MIN_INTERVAL` is sufficient; to be re-checked under test (§11.2).
- **Drain via a hostile strategy.** Strategy changes are `onlyOwner`, the
  planner is `view`, and the vault executes only `approve`/`exactInputSingle`
  shapes it recognises. **ASSUMPTION:** an action allowlist (target must be the
  configured router or token) is the right bound; §13 flags the alternative.

### 9.2 What is deliberately trusted

- **The Hedera network** to execute a booked schedule. That is the entire
  premise; if it fails, so does the chain.
- **Chainlink and SaucerSwap** each to be honest *or* to be caught by the other.
  Nocturne does not assume either is correct, only that both are not wrong in the
  same direction at the same moment.
- **The owner** to set a sane floor. The contract validates ranges, not wisdom.

### 9.3 What it does not claim

It does not guarantee execution at the floor price. It guarantees a *check* at
a cadence, and a trade only when two sources agree. A gap through the floor
between two checks is a real outcome, and §13 says so.

---

## 10. Invariants

1. A vault never holds an allowance to anything except the configured router,
   and never beyond the current action.
2. `executeScheduled` books **exactly one** successor, or zero if capacity or
   the response code says otherwise — never two (§3.2).
3. The successor is booked **before** any strategy call, so no plan failure can
   terminate the chain.
4. `plan()` is `staticcall`-safe: a strategy can never mutate vault state.
5. `MIN_SCHEDULE_GAS` is a constant; no configuration path lowers it.
6. Every interval the vault uses lies in `[MIN_INTERVAL, MAX_INTERVAL]`, and
   `MAX_INTERVAL < 62 days`.
7. `withdraw*` is `onlyOwner` and always available, armed or not.
8. A refusal emits `Refused` with both observed prices. Silence is never a
   decision.
9. Tokens the vault custodies are HTS-associated before any transfer to it.
10. Funds only ever leave the vault to (a) the owner, or (b) the configured
    router as part of a planned action.

---

## 11. Test plan

### 11.1 Unit — Foundry, with a mock HSS

Mirrors Hedera's own `MockHederaScheduleService` approach, plus what it misses.

- interval clamping at both bounds, and at exactly 62 days
- `MIN_SCHEDULE_GAS` cannot be lowered
- successor booked before a reverting `plan()` — chain survives
- action revert → `ActionFailed`, loop breaks, chain survives
- `scheduleCall` returning a non-22 code → `ScheduleFailed`, no phantom schedule
- capacity refusal → no booking, no revert
- refusal path emits both prices
- runway arithmetic and `FuelLow` threshold
- `plan()` attempting a state write → reverts under `staticcall`
- withdrawals while armed

### 11.2 Adversarial

- spam `executeScheduled` → rate limit holds, no fuel drain
- hostile strategy proposing a transfer to an arbitrary address → rejected
- TWAP window unmet → refuses rather than falling back to spot
- one source stale, other fine → refuses (does not single-source)
- divergence exactly at tolerance → refuses (boundary is closed)

### 11.3 Fork / live testnet — the tests a mock cannot replace

- **the silent-death regression:** deploy with 1M and with 3M scheduled gas,
  assert the first dies after one run and the second chains. This is §3.3 turned
  into a test, and it is the single most valuable test in the repo.
- a real `observe()` against `0x914B98…741a`
- a real `latestRoundData()` against `0x59bC15…2B4a`
- **the divergence refusal, against live testnet state** — the pool/feed gap is
  21.72× today, so this asserts a refusal with no mocking at all
- one full unattended cycle: arm, wait, assert `runCount` increased with no EOA
  transaction in the vault's mirror-node history

### 11.4 Gate self-check

The bounty's mechanical gate, run before submission:

- scaffolds from a clean directory via `--template owner/repo`
- `template.json` validates — **it needs a top-level `name`**, which the public
  docs example omits; a manifest copied from those docs fails here
- `README.md` and `AGENTS.md` present
- install, lint, build clean from a fresh scaffold
- app boots, core routes 200 **without a wallet or keys**
- no committed `.env`, no secrets
- MIT

---

## 12. Build order

1. **Engine + mock HSS.** `INocturneStrategy`, `NocturneVault`, `NocturneFactory`, unit
   tests. Nothing else until the chain survives a reverting strategy.
2. **Live scheduling proof.** Deploy the vault with a trivial strategy, arm it,
   watch three unattended runs. Capture the HashScan links now — they are the
   submission's on-chain evidence.
3. **`TwapLib` + `PriceGuard`** against the real pool and feed. Assert the
   21.72× refusal.
4. **`ProtectiveExitStrategy`** end-to-end on testnet, including one real swap.
5. **Frontend:** arm, live tick counter, decision in words, runway, mirror-node
   links.
6. **`DriftRebalanceStrategy`** — proves the interface generalises.
7. **Docs:** `README.md`, `AGENTS.md`, `docs/hedera-landmines.md` (§3.2–3.4),
   `docs/dead-ends.md` (§3.8).
8. **Gate self-check**, then submit.

Steps 1–4 are the template. 5–7 are most of the score.

---

## 13. Open items and known limits

- **Gaps through the floor are real.** Between two checks the price can pass the
  floor and keep going. Adaptive cadence narrows the window; it does not close
  it. Anyone claiming otherwise is selling something.
- **Thin testnet liquidity.** A real exit on the reference pool will move it. The
  demo uses small sizes and the README says so.
- **The testnet pool is 21.72× from spot.** Honest cause: no arbitrage on
  testnet. Useful for demonstrating refusal; useless for demonstrating a
  *realistic* exit. Both facts are stated in the UI.
- **Auto-compounding is out of scope** — `Masterchef.poolLength() = 0` on
  testnet (§3.8). It is the natural third strategy the day farms exist.
- **Bonzo is out of scope** — paused on mainnet, paused or allowlisted on
  testnet (§3.8). `BonzoHealthGuard` is a single strategy file the day the pool
  unpauses, and the interface already accommodates it.
- **ASSUMPTION — action allowlist shape.** The vault bounding actions to
  "router or configured token" is believed sufficient. The alternative is
  encoding permitted selectors. To be settled in §11.2 before submission.
- **SETTLED — rate limit.** The belief that one run per `MIN_INTERVAL` made
  `executeScheduled` spam pointless was **wrong**, and measuring it found a real
  griefing vector. An uninvited caller inside the `CLOCK_SKEW` window advances
  `nextRunAt` and orphans the schedule already booked; the orphan fires at its
  original second, finds the vault not due, returns without doing anything, and
  the vault is charged a full execution (~1.63 HBAR) for it. Once per cycle that
  halves a vault's life at roughly 16:1 damage to attacker cost.

  Fixed by releasing the pending schedule when the call did not come from it.
  The two are distinguishable because **a scheduled call arrives with
  `msg.sender` set to the contract itself** — measured with
  `contracts/test/ScheduledSenderProbe.sol`, not assumed. The rate limit does
  still hold for its original purpose: a run happens at most once per interval,
  so there is no unbounded drain.
- **No mainnet deployment.** Everything here is testnet by design; a template a
  developer cannot run for free is not a template.

---

## 14. Sources

- HIP-1215, Generalized Scheduled Contract Calls — `hips.hedera.com/hip/hip-1215`
- Hedera Schedule Service system contract — `docs.hedera.com/evm/hedera-services/system-contracts/schedule-service`
- Hedera, *Real-world applications of protocol-level smart contract automation*
- Hedera, Scaffold-HBAR Template Bounty brief (rubric and eligibility gate)
- `hedera-dev/scaffold-hbar`, `payments-scheduler` branch — `ScheduledVault.sol`,
  `IExecutionStrategy.sol` (the four gaps in §1.3 were read from this source)
- `hiero-consensus-node` issue #27263 — DELEGATECALL schedules fail
  `INVALID_PAYER_SIGNATURE` (§5.3)
- SaucerSwap contract deployments — `docs.saucerswap.finance/developerx/contract-deployments`
- Chainlink price feeds on Hedera — `docs.chain.link/data-feeds/price-feeds/addresses?network=hedera`
- Bonzo Lend incident report, 11 July 2026 — `bonzo.finance/blog/bonzo-lend-incident-report-oracle-provider-exploit`
- CoinDesk, *Lending protocol Bonzo loses 77% of value locked as $9 million oracle exploit rattles Hedera*, 11 July 2026

---

*Every address and measurement in §3 was taken from the live network on
2026-09-22 or 2026-09-23. Re-run the commands before trusting them; chains move.*
