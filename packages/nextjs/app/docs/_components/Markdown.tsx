import { Children, isValidElement } from "react";
import { slugify } from "../_lib/documents";
import { CodeBlock } from "./CodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown, styled for reading rather than for looking like a README.
 *
 * `prose` covers most of it. The overrides exist because these documents lean
 * on four things heavily: numbered section headings, wide tables of measured
 * numbers, fenced blocks meant to be copied, and inline code naming Solidity
 * identifiers. Each gets treatment that survives a phone.
 *
 * Every heading gets an id and a hover anchor, so a section can be linked to.
 * In documentation that is not a nicety — half of what these pages are for is
 * being cited in an issue or a review, and a page whose sections have no
 * addresses cannot be.
 */

/** Recover the plain text of a heading, which may contain `code` spans. */
const textOf = (node: React.ReactNode): string =>
  Children.toArray(node)
    .map(child => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement(child)) return textOf((child.props as { children?: React.ReactNode }).children);
      return "";
    })
    .join("");

/** A heading that can be linked to, with the anchor revealed on hover. */
function anchored(Tag: "h2" | "h3") {
  const Heading = ({ children }: { children?: React.ReactNode }) => {
    const id = slugify(textOf(children));

    /*
      `[&>a]:no-underline` rather than a plain `no-underline` on the anchor.
      Typography's rule is `.prose :where(a)`, and `:where` contributes no
      specificity — so it weighs the same as a bare utility class and wins on
      source order, underlining every heading on the page. A descendant
      selector outranks it without reaching for `!important`.
    */
    return (
      <Tag id={id} className="group scroll-mt-28 [&>a]:no-underline">
        <a href={`#${id}`}>
          {children}
          <span
            aria-hidden
            className="ml-3 align-middle font-mono text-sm text-paper-faint opacity-0 transition-opacity group-hover:opacity-100"
          >
            #
          </span>
        </a>
      </Tag>
    );
  };
  // Named, so React DevTools and the lint rule both have something to show.
  Heading.displayName = `Anchored${Tag.toUpperCase()}`;
  return Heading;
}

export const Markdown = ({ children }: { children: string }) => (
  <article
    /*
      A measure, not a column width. These documents are read start to finish,
      and a line of 110 characters loses the reader on the return sweep — the
      eye has to find which of two near-identical lines it just left. Tables and
      fenced blocks are allowed past it, because a column of measurements that
      wraps is worse than one that scrolls.
    */
    className="prose prose-invert max-w-[74ch]
      prose-pre:max-w-none [&_.overflow-x-auto]:max-w-none [&_figure]:max-w-none
      prose-headings:font-display prose-headings:font-normal prose-headings:uppercase prose-headings:leading-[0.95]
      prose-h1:text-[2.75rem] sm:prose-h1:text-[3.5rem] prose-h1:mb-8
      prose-h2:text-3xl prose-h2:mt-16 prose-h2:mb-5 prose-h2:pt-9 prose-h2:border-t prose-h2:border-line
      prose-h3:text-xl prose-h3:mt-10
      prose-p:text-paper-dim prose-li:text-paper-dim
      prose-strong:text-paper prose-strong:font-medium
      prose-a:text-paper prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-signal
      prose-hr:border-transparent prose-blockquote:border-signal prose-blockquote:text-paper-dim"
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: anchored("h2"),
        h3: anchored("h3"),

        // Tables of measurements are the point of these documents and are often
        // wider than a phone. Scroll the table, never the page.
        table: ({ children }) => (
          <div className="my-6 max-w-none overflow-x-auto border border-line">
            <table className="m-0 w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        // Nowrap on the header, because a measurement table's columns are
        // narrow and a wrapped heading reads as a row of its own.
        th: ({ children }) => <th className="eyebrow whitespace-nowrap px-4 py-3 text-left font-normal">{children}</th>,
        tr: ({ children }) => <tr className="border-b border-line last:border-b-0">{children}</tr>,
        td: ({ children }) => <td className="px-4 py-3 align-top">{children}</td>,

        /*
          The language tag lives on the inner <code>, not on <pre>, so it has to
          be dug out of the child element's className here — by the time the
          `code` renderer sees it, the wrapper has already been chosen.
        */
        pre: ({ children }) => {
          const child = Children.toArray(children)[0];
          const className = isValidElement(child) ? ((child.props as { className?: string }).className ?? "") : "";
          const language = /language-(\w+)/.exec(className)?.[1];
          return <CodeBlock language={language}>{children}</CodeBlock>;
        },

        code: ({ className, children, ...props }) => {
          const fenced = /language-/.test(className ?? "");
          return fenced ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code className="bg-ink-raised px-1.5 py-0.5 text-[0.9em] text-paper before:content-none after:content-none">
              {children}
            </code>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  </article>
);
