import React from "react";
import Link from "next/link";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import { hedera } from "viem/chains";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";

/**
 * The footer, which is where the scaffold's furniture lives now.
 *
 * The template ships a floating pill with the HBAR price in it, pinned over the
 * bottom-left corner of every page. It is the sort of thing that looks like a
 * feature and reads like clutter: the price of HBAR has nothing to do with
 * anything on this site, and a fixed element covers content at every scroll
 * position. The faucet stays, because a reviewer on testnet with an empty
 * account genuinely needs it — it just sits in the footer like a link instead
 * of hovering over the page.
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isTestnet = targetNetwork.id !== hedera.id;

  return (
    <footer className="mt-auto border-t border-line px-5 py-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="block h-1.5 w-1.5 rounded-full bg-signal-dim" aria-hidden />
          <span className="display text-base leading-none">Nocturne</span>
          <span className="eyebrow ml-2">Hedera {isTestnet ? "testnet" : "mainnet"}</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3" aria-label="Footer">
          <Link href="/docs" className="eyebrow transition-colors hover:text-paper">
            Docs
          </Link>
          <a
            href="https://github.com/Madhav-Gupta-28/Nocturne"
            target="_blank"
            rel="noreferrer"
            className="eyebrow transition-colors hover:text-paper"
          >
            Source ↗
          </a>
          <a
            href="https://hips.hedera.com/hip/hip-1215"
            target="_blank"
            rel="noreferrer"
            className="eyebrow transition-colors hover:text-paper"
          >
            HIP-1215 ↗
          </a>
          {isTestnet ? <HederaPortalFaucet showIcon /> : null}
        </nav>
      </div>
    </footer>
  );
};
