"use client";

import { Reveal } from "./motion";
import deployedContracts from "~~/contracts/deployedContracts";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * Every contract this template puts on chain, with a link to each one.
 *
 * It lives here rather than on the landing page because it answers a question
 * only a reader who has already decided to look would ask. On the way in it is
 * six rows of hex between somebody and the point.
 *
 * The rows are read from the generated deployment file, so they cannot drift
 * from what is actually deployed: redeploy a contract and this table changes
 * with it. A table of addresses that can go stale is worse than no table.
 */

/** What each one is for, in a line a reviewer can check against the source. */
const ROLES: Record<string, string> = {
  NocturneFactory: "Builds one vault per owner and keeps the mapping",
  Heartbeat: "Records that somebody called it. Nothing else",
  HeartbeatStrategy: "Fixed cadence. The smallest strategy that can exist",
  ProtectiveExitStrategy: "Sells to a floor, and refuses when sources disagree",
  DriftRebalanceStrategy: "Holds a ratio, and tightens as it drifts",
  PriceLens: "Reads both price sources so a frontend can see what a vault sees",
};

const ORDER = [
  "NocturneFactory",
  "Heartbeat",
  "ProtectiveExitStrategy",
  "DriftRebalanceStrategy",
  "HeartbeatStrategy",
  "PriceLens",
];

export const ContractLedger = () => {
  const { targetNetwork } = useTargetNetwork();
  const chain = (deployedContracts as Record<number, Record<string, { address: string }>>)[targetNetwork.id] ?? {};
  const rows = ORDER.filter(name => chain[name]).map(name => ({ name, address: chain[name].address }));

  return (
    <Reveal>
      <div className="lift border border-line bg-ink-raised/30">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="eyebrow">{rows.length} contracts · source verified</span>
          <span className="eyebrow hidden sm:block">Open on HashScan</span>
        </div>

        <ul className="m-0 list-none divide-y divide-line p-0">
          {rows.map(({ name, address }) => (
            <li key={name}>
              <a
                href={getBlockExplorerAddressLink(targetNetwork, address)}
                target="_blank"
                rel="noreferrer"
                className="group grid items-baseline gap-x-6 gap-y-1 px-5 py-4 transition-colors hover:bg-signal-glow/40 sm:grid-cols-[13rem_minmax(0,1fr)_auto]"
              >
                <span className="font-mono text-sm text-paper transition-colors group-hover:text-signal">{name}</span>
                <span className="text-sm text-paper-dim">{ROLES[name]}</span>
                <span className="font-mono text-xs text-paper-faint transition-colors group-hover:text-paper">
                  {address.slice(0, 10)}…{address.slice(-6)} <span aria-hidden>↗</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
};
