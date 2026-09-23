"use client";

import { useEffect, useState } from "react";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { Address } from "viem";

/**
 * The small shared pieces the dashboard panels are built from, plus the
 * formatting the chain's units need before a person should see them.
 */

export const Panel = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <section className="bg-base-100 rounded-2xl p-6 shadow-sm">
    <h2 className="text-sm font-semibold uppercase tracking-wider opacity-50 mt-0 mb-1">{title}</h2>
    {subtitle ? <p className="text-sm opacity-60 mt-0 mb-4">{subtitle}</p> : <div className="mb-4" />}
    {children}
  </section>
);

export const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="min-w-24">
    <div className="text-3xl font-semibold tabular-nums leading-none">{value}</div>
    <div className="text-sm opacity-60 mt-1">{label}</div>
    {hint ? <div className="text-xs opacity-40">{hint}</div> : null}
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
