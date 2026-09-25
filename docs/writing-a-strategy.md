# Write a strategy

This is the part you write. The vault is finished — it holds the funds, books
the schedule, checks your plan against an allow-list and pays its own fee. A
strategy decides two things: **what to do** and **when to look again**.

Four functions. The smallest one that works is 69 lines.

---

## 01 · The interface

```solidity
interface INocturneStrategy {
    struct Action {
        address target;
        uint256 value;   // tinybar, not wei
        bytes   data;
    }

    function plan(bytes calldata config) external view returns (Action[] memory);
    function nextInterval(bytes calldata config) external view returns (uint256);
    function validateConfig(bytes calldata config) external view returns (bool);
    function explain(bytes calldata config) external view returns (string memory, uint256, uint256);
}
```

<!-- figure: swap -->

Four rules follow from that signature, and all four are enforced rather than
suggested.

**A strategy is a pure planner.** It never receives tokens, never holds an
allowance, and cannot write state — the vault reaches it through `staticcall`,
so a strategy that tries to write is rejected by the EVM rather than by a code
review.

**An empty array is a decision, not an error.** It is how you say *nothing to
do*: the position is healthy, the trade is too small to be worth its fee, the
price sources disagree. The vault records it as a refusal, emits your `explain`
output, and runs again after whatever `nextInterval` returned.

**Do not revert because the market is unfavourable.** Reverting is for malformed
config and broken assumptions. Declining is for everything else. A strategy that
reverts costs one run; the chain continues either way, but the refusal is the
one that carries a reason.

**`nextInterval` is returned even when the plan is empty** — especially then,
because a refusal usually means *look again sooner*, not *give up*.

---

## 02 · Why the interval lives here

This is the one place Nocturne deliberately differs from Hedera's own
`ScheduledVault` template, and it is worth the paragraph.

That template takes a fixed `intervalSeconds`, and its strategy interface
returns actions and nothing else. Which makes the use case in Hedera's own
documentation — *"as positions approach liquidation thresholds, contracts
schedule increasingly frequent monitoring"* — impossible to express. The
strategy is the only party that knows how close the position is, and it has no
way to say so.

It is not a stylistic point. At roughly **1.63 HBAR per execution** (measured —
see [fuel and runway](/docs/fuel)), a fixed hourly cadence costs about 39 HBAR a
day whether or not anything is happening, and a fixed daily cadence can sleep
through the event it exists to catch. Only the strategy can tell which of those
is currently wrong.

So the interval moves to the strategy. The vault keeps custody and clamps the
answer; the strategy keeps the judgement and holds nothing.

---

## 03 · A complete strategy

Here is the whole reference implementation, `HeartbeatStrategy.sol`. It calls a
counter on a fixed interval, forever. Nothing else.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";
import { Heartbeat } from "../Heartbeat.sol";

contract HeartbeatStrategy is INocturneStrategy {
    struct Config {
        address heartbeat;
        uint256 intervalSeconds;
    }

    function plan(bytes calldata config) external pure override returns (Action[] memory actions) {
        Config memory c = abi.decode(config, (Config));

        actions = new Action[](1);
        actions[0] = Action({
            target: c.heartbeat,
            value: 0,
            data: abi.encodeCall(Heartbeat.beat, ())
        });
    }

    function nextInterval(bytes calldata config) external pure override returns (uint256) {
        return abi.decode(config, (Config)).intervalSeconds;
    }

    function validateConfig(bytes calldata config) external pure override returns (bool) {
        Config memory c = abi.decode(config, (Config));
        if (c.heartbeat == address(0)) return false;
        if (c.intervalSeconds == 0) return false;
        return true;
    }

    function explain(bytes calldata config) external view override returns (string memory, uint256, uint256) {
        Config memory c = abi.decode(config, (Config));
        return ("beating", Heartbeat(c.heartbeat).beats(), c.intervalSeconds);
    }

    /// Helper so a UI or a script does not have to hand-encode the config.
    function encodeConfig(address heartbeat, uint256 intervalSeconds) external pure returns (bytes memory) {
        return abi.encode(Config({ heartbeat: heartbeat, intervalSeconds: intervalSeconds }));
    }
}
```

That `encodeConfig` helper is not part of the interface and the vault never
calls it. Add one anyway: without it, every script and every frontend has to
hand-encode your config struct, and the first time somebody gets the field order
wrong they will not find out until a scheduled call at 4am.

---

## 04 · Config is an opaque blob

The vault stores `bytes` and hands them back untouched. It has no idea what is
in them, which is what lets one vault serve every strategy.

That puts the whole burden on `validateConfig`, which the vault calls at
configure time — in front of the person who wrote it, rather than at 3am inside
a call nobody is watching.

A malformed blob makes `abi.decode` revert, so the vault rejects it either way.
Your explicit checks are for the **decodable-but-useless** cases: a zero
address, a zero interval, a floor above the current price, a tolerance of
10,000 basis points.

---

## 05 · The allow-list

A plan is not trusted. Before it runs anything, the vault checks every action
against a per-`(target, selector)` allow-list the owner set:

```solidity
vault.setAllowedCall(router, IRouter.exactInputSingle.selector, true);
```

If any action in the plan is not allowed, **the whole plan is rejected** — the
vault emits `PlanRejected` and runs none of it, rather than running the prefix
that happened to be permitted.

Two details that are easy to get wrong:

**The selector matters, not just the target.** Allowing a token for `approve`
would, on a target-only allow-list, equally allow `transfer(attacker, balance)`.
That was a real hole in an earlier version of this vault. It is now keyed on
both.

**`value` must be zero.** The vault refuses any action carrying HBAR. The
allow-list bounds *what you may call*, not *how much you may send*, so a hostile
plan pointed at an allow-listed payable target could otherwise hand over the
whole balance.

Changing the strategy clears every grant. `setStrategy` bumps a `grantEpoch`
and the allow-list is keyed by it, so grants made for the old strategy cannot
be inherited by the new one.

---

## 06 · Build your own

Say you want a vault that tops up a gas tank when it drops below a threshold.
This exact contract is in the repository as
`contracts/examples/TopUpStrategy.sol`, and CI tests it, so it compiles and does
what this page says.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { INocturneStrategy } from "../interfaces/INocturneStrategy.sol";

interface IGasTank {
    function balanceOf(address who) external view returns (uint256);
    function topUp(address who, uint256 amount) external;
}

contract TopUpStrategy is INocturneStrategy {
    struct Config {
        address tank;
        address beneficiary;
        uint256 floor;      // top up below this
        uint256 target;     // top up to this
    }

    function plan(bytes calldata config) external view override returns (Action[] memory actions) {
        Config memory c = abi.decode(config, (Config));
        uint256 balance = IGasTank(c.tank).balanceOf(c.beneficiary);

        // Healthy. Say so with an empty plan rather than reverting.
        if (balance >= c.floor) return new Action[](0);

        actions = new Action[](1);
        actions[0] = Action({
            target: c.tank,
            value: 0,
            data: abi.encodeCall(IGasTank.topUp, (c.beneficiary, c.target - balance))
        });
    }

    function nextInterval(bytes calldata config) external view override returns (uint256) {
        Config memory c = abi.decode(config, (Config));
        uint256 balance = IGasTank(c.tank).balanceOf(c.beneficiary);

        // The whole point of the interface: look more often as it gets close.
        if (balance >= c.floor * 2) return 6 hours;
        if (balance >= c.floor) return 1 hours;
        return 5 minutes;
    }

    function validateConfig(bytes calldata config) external pure override returns (bool) {
        Config memory c = abi.decode(config, (Config));
        if (c.tank == address(0) || c.beneficiary == address(0)) return false;
        if (c.floor == 0 || c.target <= c.floor) return false;
        return true;
    }

    function explain(bytes calldata config) external view override returns (string memory, uint256, uint256) {
        Config memory c = abi.decode(config, (Config));
        uint256 balance = IGasTank(c.tank).balanceOf(c.beneficiary);
        return (balance >= c.floor ? "healthy" : "topping up", balance, c.floor);
    }

    function encodeConfig(address tank, address beneficiary, uint256 floor, uint256 target)
        external pure returns (bytes memory)
    {
        return abi.encode(Config({ tank: tank, beneficiary: beneficiary, floor: floor, target: target }));
    }
}
```

Note what `nextInterval` is doing. Six hours while there is plenty, one hour as
it approaches, five minutes when it is under. That is the accelerando, and it is
three lines.

---

## 07 · Stay inside the gas budget

Every run is booked with `MIN_SCHEDULE_GAS`, 3,000,000 gas, and that is all
your plan gets. Measured on testnet:

| Run | Gas used | Share of the budget |
| --- | --- | --- |
| A check that holds | 1,535,860 | 51% |
| A refusal, sources disagree | 1,663,853 | 55% |
| An approve and one SaucerSwap swap | 2,419,009 | 81% |

One swap leaves about 580k of headroom. Plan for **under 2.5M** per run. An
action that runs out of gas fails on its own and the vault logs `ActionFailed`
with the 1/64 of gas the EVM holds back for it. But if what is left is too
little to finish the run, the whole transaction reverts, taking the successor
it booked at the start with it, and the chain stops. So do not put two swaps in
one plan. Split the work across runs; a short `nextInterval` is what that is
for.

---

## 08 · Test it offline

You do not need a network, and you should not use one for this. The repository
ships `MockHederaScheduleService`, so the whole loop runs in Hardhat.

```typescript
it("tops the tank up through a vault, with nobody sending the run", async () => {
  const { tank, vault, hss, user, config } = await loadFixture(deployFixture);
  await tank.setBalance(user.address, 40n);

  await vault.setAllowedCall(await tank.getAddress(), tank.interface.getFunction("topUp")!.selector, true);
  await vault.configure(config);
  await vault.arm();

  // Jump to the booked time and let the mock scheduler fire it.
  await time.increaseTo((await vault.nextRunAt()) + 1n);
  await expect(hss.fireLatest()).to.emit(vault, "Executed");

  expect(await tank.balanceOf(user.address)).to.equal(500n);
});
```

That is one of three tests in `test/TopUpStrategy.test.ts`; the fixture above
it deploys the mock scheduler, a `MockGasTank`, the strategy and a vault.

```bash
npm run hardhat:test
```

`test/NocturneVault.test.ts` has the full-loop pattern: 34 tests that arm a
vault against the mock scheduler and step it through executions, refusals,
rejected plans and running out of fuel.

---

## 09 · Ship it

Add your contract to the deploy script, then:

```bash
npm run hardhat:deploy -- --network hederaTestnet
```

Point a vault at it:

```typescript
const vault = await ethers.getContractAt("NocturneVault", vaultAddress);
const topUp = ethers.id("topUp(address,uint256)").slice(0, 10);

await vault.setStrategy(strategy.target);
await vault.setAllowedCall(tank, topUp, true);
await vault.configure(await strategy.encodeConfig(tank, user, 100n, 500n));
await vault.arm();
```

Order matters. `setStrategy` wipes the config and every grant, so both come
after it, and `arm()` comes last. A vault made by the factory for your strategy
already has it set; skip that line.

---

## The four rules, once more

1. `plan` and `nextInterval` are `view`. The vault `staticcall`s them.
2. An empty plan is a refusal, not a failure. Return one instead of reverting.
3. Every action needs an allow-list grant for its exact `(target, selector)`.
4. `value` is always zero. The vault refuses anything else.

→ Next: [the six ways this fails silently](/docs/landmines).
