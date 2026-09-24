"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS } from "../_lib/documents";

/**
 * The docs index, kept in view.
 *
 * Numbered rather than bulleted because these three are meant to be read in
 * order: what will bite you, then why the design answers it, then what was
 * tried and abandoned. The current page carries a lit rule so its position in
 * that sequence is visible without reading the labels.
 */
export const Sidebar = () => {
  const path = usePathname();

  return (
    <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:self-start">
      <p className="eyebrow m-0 mb-5">Pages</p>
      <ol className="m-0 p-0 list-none flex flex-col">
        {DOCS.map((doc, i) => {
          const href = `/docs/${doc.slug}`;
          const here = path === href;
          return (
            <li key={doc.slug}>
              <Link
                href={href}
                aria-current={here ? "page" : undefined}
                className={`flex gap-3 py-2.5 border-l-2 pl-4 -ml-px transition-colors ${
                  here ? "border-signal text-paper" : "border-transparent text-paper-dim hover:text-paper"
                }`}
              >
                <span className={`font-mono text-xs pt-1 ${here ? "text-signal" : "text-paper-faint"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm leading-snug">{doc.title}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
