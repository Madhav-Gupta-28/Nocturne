import React from "react";
import Link from "next/link";
import { hedera } from "viem/chains";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";

/**
 * One line: what this is, and the four places a visitor might go next.
 *
 * The faucet is a plain link rather than the scaffold's button, because a
 * reviewer on testnet with an empty account needs it and nobody else does.
 */
const LINKS = [
  { label: "Docs", href: "/docs", internal: true },
  { label: "GitHub", href: "https://github.com/Madhav-Gupta-28/Nocturne" },
  { label: "HIP-1215", href: "https://hips.hedera.com/hip/hip-1215" },
];

export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isTestnet = targetNetwork.id !== hedera.id;
  const links = isTestnet ? [...LINKS, { label: "Faucet", href: "https://portal.hedera.com/faucet" }] : LINKS;

  return (
    <footer className="mt-auto border-t border-line">
      <div className="shell flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <span className="display text-lg leading-none">Nocturne</span>
          <span className="eyebrow">Cron for contracts · Hedera {isTestnet ? "testnet" : "mainnet"}</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-7 gap-y-3" aria-label="Footer">
          {links.map(l =>
            "internal" in l ? (
              <Link key={l.label} href={l.href} className="eyebrow transition-colors hover:text-paper">
                {l.label}
              </Link>
            ) : (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="eyebrow transition-colors hover:text-paper"
              >
                {l.label} ↗
              </a>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
};
