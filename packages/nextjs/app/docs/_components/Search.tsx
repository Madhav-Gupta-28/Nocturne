"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Heading } from "../_lib/documents";

/**
 * ⌘K search over every heading in the docs.
 *
 * The index is built at build time from the same markdown the pages render, so
 * it cannot drift from what is on the page and it costs no runtime fetch. Every
 * heading in every document is about 120 entries — small enough that a plain
 * substring scan beats loading a search library, and it has no ranking model to
 * be wrong.
 *
 * It searches *headings* rather than body text on purpose. A hit on a heading
 * tells you which section answers the question; a hit on a sentence tells you a
 * word appears somewhere, which in a document this dense is noise.
 */

export type IndexEntry = { slug: string; title: string; headings: Heading[] };

type Hit = { slug: string; doc: string; text: string; id: string; depth: number };

export const Search = ({ index }: { index: IndexEntry[] }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const flat = useMemo<Hit[]>(
    () =>
      index.flatMap(entry => [
        { slug: entry.slug, doc: entry.title, text: entry.title, id: "", depth: 1 },
        ...entry.headings.map(h => ({
          slug: entry.slug,
          doc: entry.title,
          // Section headings are numbered in the source ("01 · Scaffold it").
          // The number is noise in a result list.
          text: h.text.replace(/^\d+\s*·\s*/, ""),
          id: h.id,
          depth: h.depth,
        })),
      ]),
    [index],
  );

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return flat.filter(h => h.text.toLowerCase().includes(q) || h.doc.toLowerCase().includes(q)).slice(0, 12);
  }, [flat, query]);

  // ⌘K anywhere, Escape to leave. Registered on the document so it works
  // without the field being focused, which is the whole point of the shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // The dialog mounts in the same frame; focus has to wait for it.
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const go = useCallback(
    (hit: Hit) => {
      setOpen(false);
      router.push(`/docs/${hit.slug}${hit.id ? `#${hit.id}` : ""}`);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, hits.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    }
    if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between border border-line bg-ink-raised/40 px-4 py-3 text-left transition-colors hover:border-line-bright"
      >
        <span className="eyebrow">Search docs</span>
        <kbd className="eyebrow border border-line px-1.5 py-0.5">⌘K</kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink-sunken/80 px-5 pt-[12vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="lift w-full max-w-xl border border-line-bright bg-ink-raised"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
          >
            <input
              ref={input}
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search the docs…"
              aria-label="Search the docs"
              className="w-full border-b border-line bg-transparent px-5 py-4 text-base text-paper outline-none placeholder:text-paper-faint"
            />

            {query && !hits.length ? (
              <p className="m-0 px-5 py-6 text-sm text-paper-faint">
                Nothing matches “{query}”. The index covers every heading in every document.
              </p>
            ) : null}

            <ul className="m-0 max-h-[52vh] list-none overflow-y-auto p-0">
              {hits.map((hit, i) => (
                <li key={`${hit.slug}-${hit.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-baseline justify-between gap-4 px-5 py-3 text-left transition-colors ${
                      i === cursor ? "bg-signal-glow" : ""
                    }`}
                  >
                    <span className={`text-sm ${i === cursor ? "text-signal" : "text-paper"}`}>{hit.text}</span>
                    <span className="eyebrow shrink-0">{hit.doc}</span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="m-0 flex items-center gap-4 border-t border-line px-5 py-3">
              <span className="eyebrow">↑↓ move</span>
              <span className="eyebrow">↵ open</span>
              <span className="eyebrow">esc close</span>
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
};
