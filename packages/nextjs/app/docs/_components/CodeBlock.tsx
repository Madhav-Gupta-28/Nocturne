"use client";

import { useRef, useState } from "react";

/**
 * A fenced block, labelled with its language and copyable in one click.
 *
 * These documents are mostly commands and contracts whose entire purpose is to
 * be run or pasted by somebody checking a claim. Making them select-and-paste
 * rather than one click puts friction on exactly the act the project is asking
 * for.
 *
 * The text is read off the rendered DOM through a ref rather than reconstructed
 * from React children, because a highlighted block is a tree of spans and
 * walking it to rebuild the source is a bug waiting to happen. What is on the
 * screen is what goes on the clipboard.
 */

/** What to call each fence in its header. Unknown languages fall back to the tag. */
const LANGUAGES: Record<string, string> = {
  bash: "Shell",
  sh: "Shell",
  shell: "Shell",
  solidity: "Solidity",
  typescript: "TypeScript",
  ts: "TypeScript",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  text: "Output",
};

export const CodeBlock = ({ children, language }: { children: React.ReactNode; language?: string }) => {
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);

  const copy = async () => {
    const text = (pre.current?.textContent ?? "").trimEnd();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable over plain http and in some embedded views.
      // The block is still selectable, so say nothing and change nothing.
    }
  };

  const label = language ? (LANGUAGES[language] ?? language) : "Output";

  return (
    <figure className="my-7 border border-line bg-ink-sunken">
      <figcaption className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="eyebrow">{label}</span>
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          className={`eyebrow cursor-pointer transition-colors ${copied ? "text-signal" : "hover:text-paper"}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>

      {/*
        The descendant reset is doing real work. A fence written without a
        language tag reaches the renderer with no className, so it is
        indistinguishable from inline code by its props alone — and the inline
        treatment paints a box behind every run of text inside the block.
      */}
      <pre
        ref={pre}
        className="m-0 overflow-x-auto bg-transparent p-4 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-paper-dim"
      >
        {children}
      </pre>
    </figure>
  );
};
