# Hedera Harness recipe: add a DCA strategy

This directory is a [hedera-harness](https://github.com/hedera-dev/hedera-harness)
recipe. It asks a coding agent to add a fourth strategy to Nocturne,
`DcaStrategy`, by following `AGENTS.md` and the docs, and then decides for
itself whether the agent succeeded. It is also a test of the template's central
claim: that a new job is one file against a four-function interface, with the
vault, the fuel accounting and the price guard untouched.

| File | Tier | What it checks |
| --- | --- | --- |
| `prd.md` | — | What to build: the strategy, its config, its behaviour, its tests, the README row. |
| `validators/static.json` | 0 | The contract and test exist where AGENTS.md puts them, implement the interface with the guard, a minimum output and the 60-day idle rule, and the README lists the strategy as shipped. No `.env` files. |
| `validators/commands.json` | 1 | Compile, the whole offline suite, both lints, strict types and the production build, the same gates CI runs. |
| `validators/playwright-smoke.yaml` | 2 | The app boots; `/`, `/how-it-works`, two docs pages and `/debug` render. |

## Running it

Use a fresh scaffold, or move any `.env` aside first: the harness forbids env
files in the workspace and checks the disk, not git.

```bash
npm run harness:doctor     # prerequisites, the recipe, every path it references
npm run harness:validate   # Tiers 0–2, no agent; fails until DcaStrategy exists
npm run harness:run        # the full run: agent, repairs, all tiers
```

- **Tier 2 needs Playwright's Chromium:** `npx playwright install chromium`.
  Playwright itself is already a dev dependency.
- **The agent** (`claude` by default, set in `spec.yaml`) must be on your `PATH`.
- **No testnet funds are needed.** Every tier here runs offline against
  `MockHederaScheduleService`, which is how the template's own tests run.

## How the recipe was verified

A validator is only useful if it fails without the feature and passes with it.
Both were checked with `harness:validate` (Tiers 0–2), each in a clean copy of
the template with no env files:

- **Without `DcaStrategy`** (the template as shipped): `passed=false` with
  exactly 5 findings, all about the missing strategy: its two files, their text
  assertions, and the README row. All seven commands passed and the Playwright
  gate rendered all five routes, so there were no false alarms.
- **With a correct implementation that follows `prd.md`**: `passed=true`,
  `findings=0`, `playwrightGate=true routes=5`. That implementation's four
  tests (a buy through a real vault fired by the mock scheduler, a refusal when
  the sources disagree, the 60-day park once funds run out, and config
  validation) passed alongside the existing 127.
