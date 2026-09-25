"use client";

import { Reveal } from "~~/app/_components/motion";

/**
 * One act: a number, a claim, a picture, one sentence to keep, one link.
 *
 * The drawing is the explanation. Everything around it is there to name what
 * the drawing shows and to point at the exact source that implements it, so a
 * reader can go from "I see" to "I've checked" in one click.
 */
export const Act = ({
  n,
  title,
  lede,
  children,
  takeaway,
  source,
}: {
  n: string;
  title: string;
  lede: string;
  children: React.ReactNode;
  /** The one sentence worth remembering, set under the drawing. */
  takeaway: React.ReactNode;
  source: { label: string; href: string };
}) => (
  <section className="mt-24 border-t border-line pt-14 sm:mt-32">
    <Reveal>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow m-0 text-signal">{n}</p>
          <h2 className="display display-lit mb-0 mt-4 max-w-3xl text-[clamp(1.75rem,3.6vw,3rem)]">{title}</h2>
          <p className="mb-0 mt-4 max-w-xl text-lg leading-relaxed text-paper-dim">{lede}</p>
        </div>
        <a
          href={source.href}
          target="_blank"
          rel="noreferrer"
          className="eyebrow shrink-0 border border-line px-3.5 py-2 transition-colors hover:border-signal/50 hover:text-signal"
        >
          {source.label} ↗
        </a>
      </div>
    </Reveal>

    <Reveal delay={0.06}>
      <div className="mt-10">{children}</div>
    </Reveal>

    <Reveal delay={0.1}>
      <p className="mb-0 mt-6 max-w-3xl border-l-2 border-signal pl-4 text-base leading-relaxed text-paper">
        {takeaway}
      </p>
    </Reveal>
  </section>
);

/** The frame every diagram sits in, so all four read as one set. */
export const Figure = ({ children }: { children: React.ReactNode }) => (
  <figure className="lift m-0 overflow-hidden border border-line bg-ink-raised/40 backdrop-blur-sm">{children}</figure>
);
