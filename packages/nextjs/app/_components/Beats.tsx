"use client";

import { Panel, formatDuration } from "./ui";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * The counter that carries the whole argument.
 *
 * `Heartbeat` is a contract with one job: record that somebody called it. Every
 * beat on it was placed by a vault executing a schedule the network fired — no
 * wallet open, no process running anywhere. It is shown to visitors who have not
 * connected anything, because the claim is about the chain rather than them.
 */
export const Beats = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data: heartbeat } = useDeployedContractInfo({ contractName: "Heartbeat" });

  const { data: beats } = useScaffoldReadContract({ contractName: "Heartbeat", functionName: "beats" });
  const { data: silence } = useScaffoldReadContract({ contractName: "Heartbeat", functionName: "silenceFor" });

  // `silenceFor` returns 0 both for "a moment ago" and for "never", so read the
  // counter to tell them apart rather than showing a confident "0s ago".
  const everBeaten = beats !== undefined && beats > 0n;

  return (
    <Panel title="Executions nobody sent">
      <div className="flex flex-wrap items-end gap-8">
        <div>
          <div className="text-6xl font-bold tabular-nums leading-none">{beats?.toString() ?? "—"}</div>
          <div className="text-sm opacity-60 mt-1">beats recorded</div>
        </div>
        <div className="text-sm opacity-70 pb-1 max-w-sm">
          <div>
            last beat{" "}
            {everBeaten && silence !== undefined
              ? `${formatDuration(Number(silence))} ago`
              : "not yet — no vault is armed"}
          </div>
          <div className="opacity-60 mt-1">
            A vault beats on its own interval and stops when its fuel runs out. Nothing here is topped up for a demo.
          </div>
        </div>
      </div>

      {heartbeat?.address ? (
        <a
          className="link text-sm inline-block mt-4"
          href={getBlockExplorerAddressLink(targetNetwork, heartbeat.address)}
          target="_blank"
          rel="noreferrer"
        >
          Heartbeat on HashScan →
        </a>
      ) : null}
    </Panel>
  );
};
