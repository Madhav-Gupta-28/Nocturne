"use client";

import { useEffect, useState } from "react";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { Address } from "viem";

/**
 * The small shared pieces the dashboard panels are built from, plus the
 * formatting the chain's units need before a person should see them.
 */

/**
 * A section of the page.
 *
 * Two treatments, because a card means "this is a discrete object" and not
 * everything on this page is one. Live state a reader might act on gets the
 * raised surface; prose explaining the design gets a rule and open space, so
 * the eye can tell the two apart without reading either.
 */
export const Panel = ({
  title,
  subtitle,
  children,
  quiet = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Prose rather than state: no raised surface, just a rule above it. */
  quiet?: boolean;
}) => (
  <section className={quiet ? "pt-14 rule" : "border border-line bg-ink-raised p-6 sm:p-8"}>
    <h2 className="eyebrow m-0">{title}</h2>
    {subtitle ? <p className="text-sm text-paper-dim mt-3 mb-6 max-w-2xl">{subtitle}</p> : <div className="mb-6" />}
    {children}
  </section>
);

export const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="min-w-24">
    <div className="eyebrow mb-2">{label}</div>
    <div className="tabular font-mono text-3xl leading-none">{value}</div>
    {hint ? <div className="text-xs text-paper-faint mt-2">{hint}</div> : null}
  </div>
);

/**
 * A clock that ticks in the browser.
 *
 * The countdown to the next run should move every second, but the chain is
 * polled every five. Ticking locally and re-reading on a slower cadence keeps
 * the page alive without hammering the relay.
 */
export const useNow = () => {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "due now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

/** Tinybar to a readable HBAR figure. In-EVM balances are 8 decimals, not 18. */
export function formatHbar(tinybar: bigint): string {
  return (Number(tinybar) / 1e8).toFixed(2);
}

/**
 * `abi.encode` of `HeartbeatStrategy.Config`.
 *
 * Both fields are static, so encoding the struct and encoding the two values in
 * order produce identical bytes. `HeartbeatStrategy.encodeConfig` exists on
 * chain and says the same thing; doing it here saves the round trip.
 */
export function encodeHeartbeatConfig(heartbeat: Address, intervalSeconds: bigint) {
  return encodeAbiParameters(parseAbiParameters("address, uint256"), [heartbeat, intervalSeconds]);
}
