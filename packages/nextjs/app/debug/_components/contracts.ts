/**
 * What each deployed contract is, in words rather than ABI.
 *
 * The scaffold's debug page lists contract names and their functions, which is
 * everything a developer needs and nothing a reviewer does. Somebody arriving
 * here cold sees `encodeConfig(c tuple)` and learns nothing at all.
 *
 * So every contract gets a plain-language card: what it is, why it exists, and
 * the one call worth making first. That last field is the important one — the
 * difference between a page a judge bounces off and one where they click
 * something and see a number that backs up a claim made on the landing page.
 *
 * Keyed by contract name, matching `deployedContracts.ts`. A contract deployed
 * without an entry here still renders; it just gets no explanation, which is
 * the right failure for a template somebody will add their own contracts to.
 */

export type ContractNote = {
  /** One line, for the card. */
  role: string;
  /** Two or three sentences, for the popover. */
  what: string;
  /** Why it is a separate contract at all. */
  why: string;
  /** The call to make first, and what it proves. */
  tryThis?: { call: string; proves: string };
  /** Path from the repository's contracts directory. */
  source: string;
};

export const CONTRACT_NOTES: Record<string, ContractNote> = {
  NocturneFactory: {
    role: "Builds vaults, and remembers who owns what",
    what: "Deploys one NocturneVault per call, funds it from the HBAR you attach, and transfers ownership to you before it returns. It keeps a mapping from owner to vaults so the frontend needs no storage of its own.",
    why: "Vaults are deployed with `new`, not cloned. EIP-1167 minimal proxies break scheduling on Hedera — a delegatecall frame gets a delegatable_contract_id admin key and scheduleCall then fails with INVALID_PAYER_SIGNATURE.",
    tryThis: {
      call: "totalVaults",
      proves: "How many vaults this factory has built.",
    },
    source: "NocturneFactory.sol",
  },

  Heartbeat: {
    role: "Records that somebody called it. Nothing else",
    what: "A counter with one function. Every increment on it was placed by a vault executing a schedule the network fired — no human sent any of them.",
    why: "The liveness proof needs to be something with no other explanation. A counter that only goes up when a scheduled call lands is the smallest thing that cannot be faked by a person clicking a button.",
    tryThis: {
      call: "beats",
      proves: "The same number the landing page shows, read straight off the chain.",
    },
    source: "Heartbeat.sol",
  },

  HeartbeatStrategy: {
    role: "Fixed cadence. The smallest strategy that can exist",
    what: "The reference implementation of INocturneStrategy in 69 lines. It plans one call to a Heartbeat and returns a fixed interval.",
    why: "It is the one case where a fixed interval is correct, because nothing it observes could change its mind — which is the contrast the price-driven strategies are drawn against.",
    tryThis: {
      call: "encodeConfig",
      proves: "The config blob a vault stores. Pass a Heartbeat address and an interval in seconds.",
    },
    source: "strategies/HeartbeatStrategy.sol",
  },

  ProtectiveExitStrategy: {
    role: "Sells to a floor, and refuses when sources disagree",
    what: "Watches a SaucerSwap pool TWAP against a Chainlink feed. Above the floor it holds; below it, it plans an approve and a swap. If the two prices disagree beyond your tolerance it plans nothing and records why.",
    why: "A stop-loss that trusts one price can be triggered by whoever last moved that price. On 11 July 2026 one manipulated price took $9.05M out of Bonzo Lend.",
    tryThis: {
      call: "nextInterval",
      proves:
        "The accelerando: the same config returns 6 hours when the price is far from the floor and 60 seconds when it is close.",
    },
    source: "strategies/ProtectiveExitStrategy.sol",
  },

  DriftRebalanceStrategy: {
    role: "Holds a ratio, and tightens as it drifts",
    what: "Keeps a two-asset position near a target split. Inside a dead band it does nothing; outside it, it plans a swap back toward the ratio, and it checks two price sources before acting.",
    why: "Rebalancing on a fixed schedule either trades too often and pays fees for nothing, or too rarely and holds the wrong thing through the move. The interval belongs to the strategy for the same reason the exit's does.",
    tryThis: {
      call: "inspect",
      proves: "What the strategy sees for a given config, without running anything.",
    },
    source: "strategies/DriftRebalanceStrategy.sol",
  },

  PriceLens: {
    role: "Reads both price sources so a frontend can see what a vault sees",
    what: "Stateless and entirely view. It runs the same PriceGuard logic a strategy would, and returns both prices, how far apart they are, the feed's age, and whether they agree.",
    why: "A refusal leaves no trace — no swap, no transfer, nothing an explorer highlights. Without this, the most important thing the system does would be invisible until after you had trusted it with money.",
    tryThis: {
      call: "read",
      proves:
        "The live divergence between SaucerSwap and Chainlink. On testnet they are far apart, which is exactly when a vault should refuse.",
    },
    source: "PriceLens.sol",
  },
};
