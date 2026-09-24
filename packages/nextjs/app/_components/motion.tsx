"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";

/**
 * One motion system, so the whole site decelerates the same way.
 *
 * Everything here obeys two rules that are easy to get wrong and expensive when
 * you do:
 *
 *   1. Nothing is parked hidden. Every animation below is an *enhancement* of a
 *      resting state that is already visible and already readable. A section
 *      whose content only exists once an observer fires is a section that is
 *      missing from a screenshot, a print, a crawler, and a short window.
 *   2. Reduced motion means reduced motion, not no page. Every wrapper checks
 *      the preference and renders the finished frame instead of animating to
 *      it.
 */

/** The single curve. Matches `--ease-score` in the stylesheet. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * A line of display type arriving from under its own baseline.
 *
 * The clip is the point: the glyphs slide up inside a box that does not move,
 * which reads as type being set rather than as a div flying in.
 */
export const lineVariants: Variants = {
  rest: { y: "110%" },
  play: (i: number) => ({
    y: "0%",
    transition: { duration: 0.95, delay: 0.08 + i * 0.09, ease: EASE },
  }),
};

export const fadeUp: Variants = {
  rest: { opacity: 0, y: 18 },
  play: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: i * 0.07, ease: EASE },
  }),
};

/**
 * Reveal a block the first time it comes near the fold, once.
 *
 * `once` matters. A section that re-animates every time it scrolls back into
 * view turns a long page into a slideshow, and the second viewing is always
 * worse than the first.
 */
export const Reveal = ({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) => {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const still = useReducedMotion();

  /*
    The safety net, and it is not optional.

    An entrance that starts at `opacity: 0` is a promise that something will set
    it back to 1. If the observer never fires — a viewport taller than the
    document, a headless capture, an engine that lays out once and never scrolls
    — that promise is broken and the section is simply missing, silently, with
    its height still reserved. So the reveal gives the observer a second and
    then shows the content regardless. Animation is allowed to be an
    enhancement; it is never allowed to be a precondition.
  */
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 900);
    return () => clearTimeout(timer);
  }, []);

  const shown = still || inView || timedOut;

  // The element varies so a reveal can be a list item where the parent is a
  // list, which matters for semantics and for how a screen reader counts. The
  // cast is because a union of motion components intersects their ref types
  // into something no single element can satisfy; every member accepts an
  // HTMLElement ref at runtime.
  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      initial={still ? false : { opacity: 0, y: 22 }}
      animate={shown ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </Tag>
  );
};
