"use client";

import { useState } from "react";

/**
 * A fenced block with a copy button.
 *
 * These documents are mostly commands whose entire purpose is to be run by
 * someone checking a claim. Making them select-and-paste rather than one click
 * puts friction on exactly the act the project is asking for.
 */
export const CodeBlock = ({ children }: { children: React.ReactNode }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // The text lives in the rendered children, so read it off the DOM rather
    // than trying to reconstruct it from React nodes.
    const text = (document.activeElement?.closest("figure")?.querySelector("pre")?.textContent ?? "").trimEnd();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is unavailable over plain http and in some embedded views.
      // The block is still selectable, so say nothing and change nothing.
    }
  };

  return (
    <figure className="my-6 border border-line bg-ink-sunken">
      <figcaption className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="eyebrow">Shell</span>
        <button type="button" onClick={copy} className="eyebrow hover:text-paper transition-colors cursor-pointer">
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      {/*
        The descendant reset is doing real work. A fence written without a
        language tag reaches the renderer with no className, so it is
        indistinguishable from inline code by its props alone — and the inline
        treatment paints a box behind every run of text inside the block.
      */}
      <pre className="m-0 overflow-x-auto p-4 text-[13px] leading-relaxed bg-transparent [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-paper-dim">
        {children}
      </pre>
    </figure>
  );
};
