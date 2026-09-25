"use client";

import { useState } from "react";
import Link from "next/link";
import { EASE, fadeUp, lineVariants } from "./motion";
import { motion, useReducedMotion } from "framer-motion";
import { Starfield } from "~~/components/Starfield";

/**
 * The opening, and the only place on this site with a sky.
 *
 * Four seconds is the honest budget. Somebody arrives, reads two lines and a
 * paragraph, and either understands what this is or leaves — so the headline
 * says what you get rather than being clever about it, and the paragraph
 * describes the whole product in words that need no vocabulary beyond the name
 * of the chain.
 *
 * There is one call to action, and it goes to the docs: this is a template, so
 * the thing a visitor came to do is build with it. The command beside it is
 * the other half of the same action.
 */

// The `--` is load-bearing. Without it `--template` is consumed by npm, never
// reaches the CLI, and the user lands in the stock template picker.
const COMMAND = "npm create scaffold-hbar@latest -- --template Madhav-Gupta-28/Nocturne";

export const Hero = () => {
  const still = useReducedMotion();

  return (
    <header className="glowfield relative overflow-hidden">
      <Starfield />

      <div className="shell pt-24 pb-24 sm:pt-32 sm:pb-32">
        {/*
          Each line is a clip window with the glyphs sliding up inside it, so
          the type reads as being set rather than as a block flying in.
        */}
        {/*
          Category, then the impossible-sounding part. Every developer knows
          what a cron job is and every one of them knows it needs a machine —
          so naming the category and then removing the machine states the whole
          product in six words, before anybody has read a paragraph.
        */}
        <h1 className="display display-hero m-0 text-left">
          <Line index={0}>Cron for contracts.</Line>
          <Line index={1}>
            <span className="marker">No server.</span>
          </Line>
        </h1>

        <motion.div
          className="mt-12 h-px origin-left bg-line"
          initial={still ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.1, delay: 0.45, ease: EASE }}
        />

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
          <motion.div className="min-w-0" variants={fadeUp} custom={5} initial={still ? false : "rest"} animate="play">
            {/*
              "Pays for it" is not decoration. Somebody has to pay every run's
              fee; if it is not the contract, it is a funded bot — which is the
              server this line says you no longer need.
            */}
            <p className="m-0 max-w-xl text-lg leading-relaxed text-paper-dim sm:text-xl">
              Your contract books its own next run on Hedera and pays for it.{" "}
              <span className="text-paper">Nothing to host. Nothing to keep online.</span>
            </p>

            <div className="mt-10">
              <Link href="/docs/quickstart" className="btn-signal">
                Get started <span aria-hidden>→</span>
              </Link>
            </div>
          </motion.div>

          <motion.div className="min-w-0" variants={fadeUp} custom={7} initial={still ? false : "rest"} animate="play">
            <CommandCard />
          </motion.div>
        </div>
      </div>
    </header>
  );
};

/** One line of the headline, in its own clip window. */
const Line = ({ children, index, className }: { children: React.ReactNode; index: number; className?: string }) => {
  const still = useReducedMotion();
  const [arrived, setArrived] = useState(still);

  return (
    /*
      The clip has to go once the line has arrived. Type this size carries a
      wide, very faint bloom so it sits in the same air as the stars behind it —
      and `overflow: hidden` crops that bloom to the line box, which paints a
      visible rectangle of grey around every word.
    */
    <span className={`block pb-[0.06em] ${arrived ? "" : "overflow-hidden"}`}>
      <motion.span
        className={`block ${className ?? ""}`}
        variants={lineVariants}
        custom={index}
        initial={still ? false : "rest"}
        animate="play"
        onAnimationComplete={() => setArrived(true)}
      >
        {children}
      </motion.span>
    </span>
  );
};

/**
 * The command, framed like an instrument rather than a code block.
 *
 * This is a template, so the single most useful thing on the page is the line
 * that makes it yours. It gets the accent border and a wash of the accent
 * spilling out from behind it — the one object in the composition that is lit
 * from within rather than lit from the page.
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
    <div className="relative">
      {/*
        The wash sits behind the frame and spills past its edges, which is what
        makes the card read as the source of the light rather than as a box
        that happens to have a coloured border.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-12 -z-10 blur-3xl"
        style={{ background: "radial-gradient(58% 55% at 50% 50%, var(--color-signal-glow), transparent 72%)" }}
      />

      <figure className="lift-signal m-0 border border-signal/45 bg-ink-sunken/70 backdrop-blur-sm">
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
            <span className="select-none text-paper-faint">$ </span>
            npm create scaffold-hbar@latest -- <span className="text-paper">--template Madhav-Gupta-28/Nocturne</span>
          </code>
        </pre>
      </figure>
      <p className="mb-0 mt-3 text-xs text-paper-faint">
        The bare <code className="text-paper-dim">--</code> is intentional: it hands the flag to the CLI.
      </p>
    </div>
  );
};
