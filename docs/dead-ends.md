# Dead ends

Things that were tried and abandoned, and what closed them. Written down because
the next person will have the same ideas, and because two of these look correct
right up until they are not.

---

## Bonzo Lend as the thing being automated

The original design read a lending position's health factor from Bonzo and
unwound it before liquidation. It was the better story: a loan that defends
itself.

Three independent paths were tried, and all three are closed:

| Attempt | Result |
| --- | --- |
| Mainnet lending pool | `paused() == true` |
| Testnet pool A | `paused() == true`, error `64` = `LP_IS_PAUSED` |
| Testnet pool B | `CALLER_NOT_AUTHORIZED` — an allowlist; a plain EOA fails identically at ~221k gas |

Bonzo paused after the **11 July 2026** oracle exploit, and was still paused when
this was tried.

The important part is not that it was unavailable. It is what the design was
about to do. Bonzo's health factor is priced by the same oracle provider whose
verifier was fooled into the $9.05M loss. Automating a response to that number would
have meant automating the exact failure that broke Hedera's DeFi — selling into a
price an attacker chose, faster and more reliably than a human would have.

So the exploit became the thesis instead of the integration: **do not act on a
price you cannot corroborate.** That is `lib/PriceGuard.sol`, and it is a better
contribution than the integration would have been.

---

## EIP-1167 clones for the vaults

A factory that clones is the obvious design. Each vault costs a few tens of
thousands of gas instead of 2.2M, which on a per-user contract matters.

It does not work, and it does not fail where you would look. The clone deploys.
The clone can call `scheduleCall`. The schedule is created and returns success
code 22. Then, when the network fires it, the execution fails with
`INVALID_PAYER_SIGNATURE` — because a delegatecall frame is given a
`delegatable_contract_id` admin key rather than a plain contract key, and the
Schedule Service will not accept that as the payer's signature
([hiero-consensus-node#27263](https://github.com/hiero-ledger/hiero-consensus-node/issues/27263),
reported 2026-09-13).

Everything an integration test would assert passes. The only symptom is that the
automation never runs.

`NocturneFactory` therefore does `new NocturneVault(...)` and pays full
deployment gas per user, which is the honest cost of a vault that actually works.

---

## Trusting a single price source

Cut before it was built, for the reason above. A stop-loss that reads one price
is a stop-loss that can be triggered by whoever last moved that price, and on a
thin pool that is cheap to do. `PriceGuard` requires a pool TWAP and a Chainlink
feed to agree within a tolerance, reports *why* when they do not, and shortens
the cadence rather than acting.

The live test suite asserts the refusal against real contracts, because on
testnet those two sources genuinely disagree right now.

---

## Copying Uniswap's TickMath

`v3-core` is GPL-2.0-or-later. This repo is MIT. Copying the constants would have
relicensed the repo or quietly violated the licence.

The constants in `lib/TickMath.sol` were derived independently and then checked
two ways: they agree with Uniswap's published values to 5.5e-13, and the library
reproduces a live pool's own `sqrtPriceX96` from its own `slot0.tick` to within
0.061 bps — the residual being expected, since `slot0.tick` is floored.

---

## Mistakes that survived longer than they should have

**Reading the transaction id to find out who paid.** A scheduled transaction's id
carries the account that *created* the schedule, so a mirror-node listing appears
to show the owner sending every execution. The whole liveness claim was nearly
reported backwards. The **transfer list** is the authoritative field, and it is
what `scripts/watchVault.ts` reads.

**Blaming the platform for a confounded measurement.** The first 1M-gas schedule
failed, and it looked like Hedera's own example template was broken. It was not:
the test had a second gas variable in it. Re-run at 3M, the same code chained
correctly. The landmine is real, but the first version of the claim was wrong.

**A test that passed for the wrong reason.** A `ProtectiveExitStrategy` test
believed to prove "holds above the floor" was actually proving "refuses a stale
feed" — `time.increaseTo` over hour-long intervals had aged the mock past
`maxFeedAge`. It now asserts the `Refused` event's *reason* rather than counting
refusals, and there is a second test pinning the config trap that caused it.

**Sizing the runway by what a run costs.** See
[`hedera-landmines.md`](hedera-landmines.md), landmine 5. A vault died holding
2.76 HBAR because the number that matters is what a run *reserves* (3.27), not
what it is charged (1.63). This one was only found because the demo vault was
left to run dry instead of being topped up.

**Believing `npx hardhat verify` when it says the network failed.** Sourcify
retired its v1 API. `hardhat-verify@2.1.3` — the version pinned next to hardhat
2.22.19 — still calls it, gets a 404 HTML page, and reports
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. That reads like a
transient block-explorer problem, so the natural response is to retry it, which
never works. Upgrading is not the fix either: the versions that speak v2 require
`hardhat@^2.26.0`, and the pin belongs to the scaffold. `scripts/verifyContracts.ts`
posts to the v2 API directly instead, using the standard JSON input the compiler
already wrote.

**Patching a library to chase a phantom.** On Node 25, `globalThis.localStorage`
is `{}`, so a `typeof !== "undefined"` guard passes and the next call fails. Time
was spent patching `burner-connector` imports before the error text was read
properly: *"is not a function"*, not *"is not defined"*. All of it was reverted.
The real fix is two lines in `packages/nextjs/node-compat.cjs`, which removes
the stub before Next.js starts.
