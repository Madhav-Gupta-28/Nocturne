"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The refusal, drawn.
 *
 * Two sources drift apart. While they agree the gate is open and the vault may
 * act; the moment the gap crosses the tolerance it shuts, and nothing is sold.
 *
 * This is the hardest thing on the site to make visible, because a refusal
 * changes nothing — no swap, no balance moves, no explorer row lights up. The
 * only trace is an event saying why. So the drawing has to supply the drama the
 * chain deliberately does not.
 *
 * The numbers are the live testnet ones, where the pool sits about 22x from the
 * feed because nothing arbitrages a testnet.
 */

const STEPS = [
  { pool: 0.094, feed: 0.094, label: "quiet" },
  { pool: 0.097, feed: 0.094, label: "drifting" },
  { pool: 0.128, feed: 0.095, label: "diverging" },
  { pool: 2.05, feed: 0.0915, label: "far apart" },
];

const TOLERANCE_BPS = 200;

export const Gate = () => {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries =>
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          io.disconnect();
          STEPS.forEach((_, k) => setTimeout(() => setI(k), 900 * k));
        }),
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const s = STEPS[i];
  // Measured against the smaller price, the way PriceGuard does it: the
  // conservative reading, which makes refusing likelier rather than less.
  const lo = Math.min(s.pool, s.feed);
  const hi = Math.max(s.pool, s.feed);
  const bps = ((hi - lo) / lo) * 10_000;
  const open = bps <= TOLERANCE_BPS;

  return (
    <div ref={ref} className="border border-line bg-ink-raised">
      <div className="grid sm:grid-cols-2 gap-px bg-line">
        <Reading label="SaucerSwap · pool TWAP" value={s.pool} />
        <Reading label="Chainlink · HBAR/USD" value={s.feed} />
      </div>

      <div className="p-6 sm:p-8">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <span className="eyebrow">Divergence · tolerance 2%</span>
          <span className="tabular font-mono text-sm text-paper-dim">{s.label}</span>
        </div>

        {/* The bar is the gap. It runs past the mark and keeps going. */}
        <div className="mt-4 h-8 relative bg-ink overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out"
            style={{
              width: `${Math.min(100, (bps / 4000) * 100)}%`,
              background: open ? "var(--color-line-bright)" : "var(--color-signal)",
            }}
          />
          <div
            className="absolute inset-y-0 w-px bg-paper-faint"
            style={{ left: `${(TOLERANCE_BPS / 4000) * 100}%` }}
            aria-hidden
          />
        </div>

        <div className="mt-6 flex items-baseline gap-5 flex-wrap">
          <span className="tabular font-mono text-3xl leading-none">
            {bps >= 1000 ? `${(bps / 100).toFixed(0)}%` : `${(bps / 100).toFixed(2)}%`}
          </span>
          <span className={open ? "text-paper-dim" : "text-signal"}>
            {open
              ? "Sources corroborate — the vault may act."
              : "Refused — nothing is sold, and the reason is recorded."}
          </span>
        </div>
      </div>
    </div>
  );
};

const Reading = ({ label, value }: { label: string; value: number }) => (
  <div className="bg-ink-raised p-6 sm:p-8">
    <div className="eyebrow mb-3">{label}</div>
    <div className="tabular font-mono text-3xl leading-none transition-all duration-700">${value.toFixed(4)}</div>
  </div>
);
