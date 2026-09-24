"use client";

import { useState } from "react";
import { CONTRACT_NOTES } from "./contracts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

/**
 * The contract picker, as an explanation rather than a row of chips.
 *
 * The scaffold ships a list of names. A name is enough for the developer who
 * wrote the contract and useless to everybody else — which on a template, where
 * most readers are seeing the code for the first time, is the wrong audience to
 * optimise for.
 *
 * So each contract is a card carrying its role, and hovering or focusing one
 * opens a panel with what it is, why it exists as a separate contract, and the
 * one call worth making first. The popover appears on focus as well as hover,
 * so it is reachable from the keyboard rather than being a mouse-only feature.
 */

const SRC = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main/packages/hardhat/contracts";

export const ContractPicker = ({
  names,
  selected,
  onSelect,
  addresses,
}: {
  names: string[];
  selected: string;
  onSelect: (name: string) => void;
  addresses: Record<string, string | undefined>;
}) => {
  const [open, setOpen] = useState<string | undefined>();
  const { targetNetwork } = useTargetNetwork();
  const still = useReducedMotion();

  return (
    <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line p-0 sm:grid-cols-2 lg:grid-cols-3">
      {names.map(name => {
        const note = CONTRACT_NOTES[name];
        const on = name === selected;
        const address = addresses[name];

        return (
          <li
            key={name}
            className="relative bg-ink-raised"
            onMouseEnter={() => setOpen(name)}
            onMouseLeave={() => setOpen(undefined)}
          >
            <button
              type="button"
              onClick={() => onSelect(name)}
              onFocus={() => setOpen(name)}
              onBlur={() => setOpen(undefined)}
              aria-pressed={on}
              className={`relative w-full cursor-pointer px-5 py-5 text-left transition-colors ${
                on ? "bg-signal-glow" : "hover:bg-ink"
              }`}
            >
              {/* A rail that lights, matching every other selected state on the site. */}
              <span
                className="absolute inset-y-0 left-0 w-0.5 origin-top bg-signal transition-transform duration-300"
                style={{ transform: on ? "scaleY(1)" : "scaleY(0)" }}
                aria-hidden
              />

              <span className={`block font-mono text-sm ${on ? "text-signal" : "text-paper"}`}>{name}</span>
              <span className="mt-2 block text-sm leading-snug text-paper-dim">
                {note?.role ?? "Deployed by this template"}
              </span>
            </button>

            {/*
              The explanation. Positioned over the grid rather than inside the
              card, so a long one is not bounded by the card's height and the
              cards stay the same size as each other.
            */}
            <AnimatePresence>
              {open === name && note ? (
                <motion.div
                  initial={still ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  role="tooltip"
                  className="lift absolute left-0 right-0 top-full z-30 border border-line-bright bg-ink-sunken p-5"
                >
                  <p className="m-0 text-sm leading-relaxed text-paper">{note.what}</p>

                  <p className="mb-0 mt-4 border-l border-signal-dim pl-4 text-xs leading-relaxed text-paper-dim">
                    <span className="eyebrow mr-2 text-signal">Why</span>
                    {note.why}
                  </p>

                  {note.tryThis ? (
                    <p className="mb-0 mt-4 text-xs leading-relaxed text-paper-faint">
                      <span className="eyebrow mr-2">Try</span>
                      <code className="text-paper">{note.tryThis.call}</code> — {note.tryThis.proves}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-3">
                    <a
                      href={`${SRC}/${note.source}`}
                      target="_blank"
                      rel="noreferrer"
                      className="eyebrow transition-colors hover:text-paper"
                    >
                      {note.source} ↗
                    </a>
                    {address ? (
                      <a
                        href={getBlockExplorerAddressLink(targetNetwork, address)}
                        target="_blank"
                        rel="noreferrer"
                        className="eyebrow transition-colors hover:text-paper"
                      >
                        HashScan ↗
                      </a>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
};
