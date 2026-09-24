"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Doc, Heading } from "../_lib/documents";

/**
 * The docs rail: every page, numbered, with the current page opened out.
 *
 * Two jobs in one column. Across documents it is a table of contents, so a
 * reader can see the whole shape of the material without leaving the page they
 * are on. Within the current document it becomes an outline — the h2s appear
 * underneath it, and the one being read is marked.
 *
 * The section highlight is driven by an IntersectionObserver rather than by
 * scroll arithmetic, so it tracks the heading actually in view rather than a
 * position computed from offsets that reflow.
 */
export const Sidebar = ({
  docs,
  headings,
  onNavigate,
}: {
  docs: Doc[];
  /** Outline for the current document, if we are inside one. */
  headings?: Heading[];
  onNavigate?: () => void;
}) => {
  const path = usePathname();
  const active = useActiveHeading(headings);

  return (
    <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
      <p className="eyebrow m-0 mb-5">Pages</p>

      <ol className="m-0 list-none p-0">
        {docs.map((doc, i) => {
          const href = `/docs/${doc.slug}`;
          const here = path === href;

          return (
            <li key={doc.slug}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={here ? "page" : undefined}
                className={`-ml-px flex gap-3 border-l-2 py-2.5 pl-4 transition-colors ${
                  here ? "border-signal text-paper" : "border-transparent text-paper-dim hover:text-paper"
                }`}
              >
                <span className={`pt-0.5 font-mono text-xs ${here ? "text-signal" : "text-paper-faint"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm leading-snug">{doc.title}</span>
              </Link>

              {/*
                The current document's own sections, nested under it. Only one
                document is ever open, so the rail never becomes a wall.
              */}
              {here && headings?.length ? (
                <ul className="-ml-px m-0 mb-2 list-none border-l-2 border-line py-1 pl-4">
                  {headings
                    .filter(h => h.depth === 2)
                    .map(h => (
                      <li key={h.id}>
                        <a
                          href={`#${h.id}`}
                          onClick={onNavigate}
                          className={`block py-1.5 pl-3 font-mono text-[11px] leading-snug transition-colors ${
                            active === h.id ? "text-signal" : "text-paper-faint hover:text-paper"
                          }`}
                        >
                          {h.text}
                        </a>
                      </li>
                    ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

/**
 * Which section the reader is currently in.
 *
 * `rootMargin` pulls the observation band up near the top of the viewport, so a
 * heading becomes current once it reaches the top rather than when it first
 * appears at the bottom — which is how a reader would describe where they are.
 */
function useActiveHeading(headings?: Heading[]) {
  const [active, setActive] = useState<string | undefined>();

  useEffect(() => {
    if (!headings?.length) return;

    const targets = headings
      .filter(h => h.depth === 2)
      .map(h => document.getElementById(h.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (!targets.length) return;

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 },
    );

    targets.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  return active;
}
