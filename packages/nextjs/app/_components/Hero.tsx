"use client";

import { useState } from "react";
import Link from "next/link";
import { EASE, fadeUp, lineVariants } from "./motion";
import { motion, useReducedMotion } from "framer-motion";

/**
 * The opening.
 *
 * Two decisions carry it. The first is scale: the headline is cut from the
 * viewport rather than from a column, so it runs margin to margin at every
 * width and the page opens with a statement instead of a paragraph. The second
 * is that the claim is immediately followed by the one command that lets you
 * check it — this is a template, and the fastest possible path from *reading*
 * about it to *running* it is the whole product.
 *
 * The live evidence sits in its own band below, under `Proof`, because a
 * counter that has to compete with 150px type loses.
 */

const COMMAND = "npx create-scaffold-hbar@latest --template Madhav-Gupta-28/Nocturne";

export const Hero = () => {
  const still = useReducedMotion();

  return (
    <header className="glowfield shell pt-14 pb-16 sm:pt-20 lg:pt-24">
      <motion.div
        className="flex flex-wrap items-center justify-between gap-4"
        variants={fadeUp}
        initial={still ? false : "rest"}
        animate="play"
      >
        <p className="eyebrow m-0 flex items-center gap-2.5">
          <span className="alive inline-block h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
          Recurring on-chain jobs · no keeper
        </p>
        <p className="eyebrow m-0">HIP-1215 · Hedera Schedule Service</p>
      </motion.div>

      {/*
        Each line is a clip window with the glyphs sliding up inside it, so the
        type reads as being set rather than as a block flying in. The window
        never moves, which is what keeps it from looking like a carousel.
      */}
      <h1 className="display display-hero m-0 mt-8 text-left">
        <Line index={0}>Close the tab.</Line>
        <Line index={1} className="text-signal">
          It already happened.
        </Line>
      </h1>

      <motion.div
        className="mt-12 h-px origin-left bg-line"
        initial={still ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.1, delay: 0.45, ease: EASE }}
      />

      {/*
        `minmax(0, …)` on every track, at every width, including the single
        column. An `auto` track is allowed to size itself to its content's
        max-content, and the content here is a 70-character shell command that
        never wraps — which drags the whole column, and the paragraph beside it,
        past the edge of a phone.
      */}
      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
        <motion.div className="min-w-0" variants={fadeUp} custom={5} initial={still ? false : "rest"} animate="play">
          <p className="m-0 max-w-xl text-lg leading-relaxed text-paper-dim sm:text-xl">
            A vault that books its own next execution with the Hedera Schedule Service. No keeper, no bot, no cron job
            on somebody&apos;s laptop —{" "}
            <span className="text-paper">the thing that fires at 4am is the network itself.</span>
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href="#vault" className="btn-signal">
              Arm a vault <span aria-hidden>→</span>
            </a>
            <Link href="/how-it-works" className="btn-line">
              How it works
            </Link>
          </div>
        </motion.div>

        <motion.div className="min-w-0" variants={fadeUp} custom={7} initial={still ? false : "rest"} animate="play">
          <CommandCard />
        </motion.div>
      </div>
    </header>
  );
};

/** One line of the headline, in its own clip window. */
const Line = ({ children, index, className }: { children: string; index: number; className?: string }) => {
  const still = useReducedMotion();

  return (
    <span className="block overflow-hidden pb-[0.06em]">
      <motion.span
        className={`block ${className ?? ""}`}
        variants={lineVariants}
        custom={index}
        initial={still ? false : "rest"}
        animate="play"
      >
        {children}
      </motion.span>
    </span>
  );
};

/**
 * The command, framed like an instrument rather than a code block.
 *
 * It is bordered in the accent because it is the single most useful thing on
 * the page: this is a template, and everything else here is an argument for
 * running it. The frame glows faintly so it reads as the lit object in the
 * composition without being a filled button competing with the call to action.
 */
const CommandCard = () => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable over plain http and in some embedded views.
      // The text is still selectable, so say nothing and change nothing.
    }
  };

  return (
    <figure className="m-0 border border-signal/45 bg-ink-sunken/70 shadow-[0_0_50px_-20px_var(--color-signal-glow)] backdrop-blur-sm">
      <figcaption className="flex items-center justify-between border-b border-signal/30 px-5 py-3">
        <span className="eyebrow text-signal">Scaffold it</span>
        <button
          type="button"
          onClick={copy}
          className="eyebrow cursor-pointer transition-colors hover:text-paper"
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>

      <pre className="m-0 overflow-x-auto px-5 py-5 text-[13px] leading-relaxed text-paper-dim">
        <code>
          <span className="text-paper-faint select-none">$ </span>
          npx create-scaffold-hbar@latest <span className="text-paper">--template Madhav-Gupta-28/Nocturne</span>
        </code>
      </pre>

      <p className="m-0 border-t border-line px-5 py-4 text-xs leading-relaxed text-paper-faint">
        Contracts, tests, deploy scripts and this frontend. Nothing here is a mock — the numbers below were measured on
        testnet, and every one of them can be reproduced with a command in the docs.
      </p>
    </figure>
  );
};
