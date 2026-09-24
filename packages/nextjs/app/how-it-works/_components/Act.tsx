"use client";

import { Reveal } from "~~/app/_components/motion";

/**
 * One act: a number, a claim, a picture, and three receipts.
 *
 * The shape is deliberate and it is the whole page. A judge reading this is
 * asking two questions — *what does it do* and *is any of this real* — and a
 * paragraph answers neither well. So each act spends its space on a drawing,
 * keeps the prose to a headline and two lines, and then ends with three cells
 * that a reader can click:
 *
 *   · which Hedera primitive this uses
 *   · where it is in the source
 *   · the transaction where it actually happened
 *
 * That strip is the part that matters for a template. Anyone can describe a
 * mechanism; the strip is the difference between describing one and having
 * built one, and it puts the evidence one click away instead of one paragraph
 * away.
 */

export type Receipt = {
  /** The column heading: what kind of evidence this is. */
  kind: string;
  /** The evidence itself, short enough to read at a glance. */
  what: string;
  href: string;
};

export const Act = ({
  n,
  title,
  lede,
  children,
  takeaway,
  receipts,
}: {
  n: string;
  title: string;
  lede: string;
  children: React.ReactNode;
  /** The one sentence worth remembering, set under the drawing. */
  takeaway: React.ReactNode;
  receipts: [Receipt, Receipt, Receipt];
}) => (
  <section className="mt-28 border-t border-line pt-14 sm:mt-36">
    <Reveal>
      <p className="eyebrow m-0">{n}</p>
      <h2 className="display display-lit m-0 mt-5 max-w-3xl text-[clamp(1.75rem,3.6vw,3rem)]">{title}</h2>
      <p className="m-0 mt-5 max-w-2xl text-lg leading-relaxed text-paper-dim">{lede}</p>
    </Reveal>

    <Reveal delay={0.06}>
      <div className="mt-12">{children}</div>
    </Reveal>

    <Reveal delay={0.1}>
      <p className="m-0 mt-8 max-w-3xl text-base leading-relaxed text-paper-dim sm:text-lg">{takeaway}</p>
    </Reveal>

    <Reveal delay={0.14}>
      <dl className="m-0 mt-10 grid grid-cols-[minmax(0,1fr)] divide-line border border-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
        {receipts.map(r => (
          <a
            key={r.kind}
            href={r.href}
            target="_blank"
            rel="noreferrer"
            className="group px-5 py-4 transition-colors hover:bg-signal-glow/40"
          >
            <dt className="eyebrow">{r.kind}</dt>
            <dd className="m-0 mt-2 text-sm text-paper transition-colors group-hover:text-signal">
              {r.what} <span aria-hidden>↗</span>
            </dd>
          </a>
        ))}
      </dl>
    </Reveal>
  </section>
);

/** The frame every diagram sits in, so all four read as one set. */
export const Figure = ({ caption, children }: { caption: string; children: React.ReactNode }) => (
  <figure className="lift m-0 overflow-hidden border border-line bg-ink-raised/40 backdrop-blur-sm">
    <figcaption className="border-b border-line px-5 py-3">
      <span className="eyebrow">{caption}</span>
    </figcaption>
    {children}
  </figure>
);
