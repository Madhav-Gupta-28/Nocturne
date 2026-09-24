"use client";

import { Reveal } from "./motion";

/**
 * The header every section on this site wears.
 *
 * Display caps on the left, the explanation on the right, a hairline under
 * both. The split is not decoration — it separates the claim from the argument,
 * so a reader skimming the page reads four headlines and a reader who has
 * stopped reads the paragraph beside the one they stopped at.
 *
 * The eyebrow is optional and should carry something true: a count, a source, a
 * network. Never a category name repeating the heading in smaller type.
 */
export const SectionHead = ({
  eyebrow,
  title,
  children,
  id,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
  id?: string;
}) => (
  <div id={id} className="scroll-mt-28">
    {eyebrow ? (
      <Reveal>
        <p className="eyebrow m-0 mb-7">{eyebrow}</p>
      </Reveal>
    ) : null}

    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
      <Reveal>
        <h2 className="display display-section m-0">{title}</h2>
      </Reveal>

      {children ? (
        <Reveal delay={0.08}>
          <div className="max-w-xl text-base leading-relaxed text-paper-dim sm:text-lg [&>p]:m-0 [&>p+p]:mt-4">
            {children}
          </div>
        </Reveal>
      ) : null}
    </div>

    <Reveal delay={0.12}>
      <div className="mt-10 h-px w-full bg-line" />
    </Reveal>
  </div>
);
