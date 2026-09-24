"use client";

import { useState } from "react";
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
 * There is one call to action. A second button beside it only ever splits the
 * click, and everything a curious reader wants is reachable from the header.
 */

const COMMAND = "npx create-scaffold-hbar@latest --template Madhav-Gupta-28/Nocturne";

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
        <h1 className="display display-hero display-lit m-0 text-left">
          <Line index={0}>Set it once.</Line>
          <Line index={1} className="text-signal display-lit-signal">
            It runs forever.
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
            <p className="m-0 max-w-xl text-lg leading-relaxed text-paper-dim sm:text-xl">
              Fund a vault and tell it what to do. It asks Hedera to wake it up later, does the job, and books its next
              wake-up before it stops.{" "}
              <span className="text-paper">No server, no bot — the network is what calls it.</span> It keeps going until
              the HBAR runs out, and you take back whatever is left.
            </p>

            <div className="mt-10">
              <a href="#vault" className="btn-signal">
                Create a vault <span aria-hidden>→</span>
              </a>
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
const Line = ({ children, index, className }: { children: string; index: number; className?: string }) => {
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
            npx create-scaffold-hbar@latest <span className="text-paper">--template Madhav-Gupta-28/Nocturne</span>
          </code>
        </pre>

        <p className="m-0 border-t border-line px-5 py-4 text-xs leading-relaxed text-paper-faint">
          Contracts, tests, deploy scripts and this page.
        </p>
      </figure>
    </div>
  );
};
