import { Children, isValidElement } from "react";
import { slugify } from "../_lib/documents";
import { CodeBlock } from "./CodeBlock";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FuelDiagram } from "~~/app/how-it-works/_components/FuelDiagram";
import { GateDiagram } from "~~/app/how-it-works/_components/GateDiagram";
import { LoopDiagram } from "~~/app/how-it-works/_components/LoopDiagram";
import { SwapDiagram } from "~~/app/how-it-works/_components/SwapDiagram";

/**
 * The drawings from /how-it-works, placed in a document with a comment:
 *
 *   <!-- figure: loop -->
 *
 * A comment, because the same markdown is read on GitHub, where it renders as
 * nothing at all instead of as a stray token. The plugin below swaps each one
 * for an element the renderer maps to the drawing.
 */
const FIGURES: Record<string, React.ComponentType> = {
  loop: LoopDiagram,
  gate: GateDiagram,
  fuel: FuelDiagram,
  swap: SwapDiagram,
};

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };

const remarkFigures = () => (tree: MdNode) => {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.map(child => {
      const name = child.type === "html" ? /<!--\s*figure:\s*(\w+)\s*-->/.exec(child.value ?? "")?.[1] : undefined;
      if (name && FIGURES[name]) {
        return { type: "docFigure", children: [], data: { hName: "doc-figure", hProperties: { name } } };
      }
      walk(child);
      return child;
    });
  };
  walk(tree);
};

/**
 * Markdown, set for reading rather than for looking like a README.
 *
 * Three devices carry it, and each answers a specific complaint a dense
 * technical document invites.
 *
 * **Numbers live in the gutter.** Sections are written `## 01 · Scaffold it`,
 * and the number is lifted out of the heading into a margin column beside it.
 * That leaves the heading itself to be words, and gives a reader scrolling fast
 * a rail of positions to count against — which is most of what makes a long
 * page feel navigable rather than endless.
 *
 * **Blockquotes are callouts.** Every `>` block in these documents is a warning
 * about something that will cost somebody a day, so they are set as a panel
 * with a marked edge rather than as indented prose that the eye skips.
 *
 * **Headings are addressable.** Each gets an id and a hover anchor. Half of
 * what these pages are for is being cited in a review, and a page whose
 * sections have no addresses cannot be.
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

/** `01 · Scaffold it` → `["01", "Scaffold it"]`. Unnumbered headings pass through. */
const splitNumber = (text: string): [string | undefined, string] => {
  const match = /^(\d{1,2})\s*·\s*(.*)$/.exec(text);
  return match ? [match[1], match[2]] : [undefined, text];
};

/**
 * A section heading, with its number in the margin.
 *
 * The gutter is only present from `lg` up. Below that there is no margin to put
 * anything in, so the number goes back inline above the heading rather than
 * being dropped — it is part of how the document is referred to.
 */
const Section = ({ children }: { children?: React.ReactNode }) => {
  const [num, rest] = splitNumber(textOf(children));
  const id = slugify(textOf(children));

  return (
    <h2 id={id} className="group relative scroll-mt-28 lg:pl-0">
      {num ? (
        <span
          aria-hidden
          /*
            Sits in the article's own left padding, not in the grid gap — at
            `-left-20` it reached past the gap and landed on top of the
            sidebar. `top` clears the heading's 2.5rem rule padding so the
            number lines up with the words rather than with the rule above
            them.
          */
          className="mb-3 block font-mono text-xs tracking-[0.2em] text-signal lg:absolute lg:-left-14 lg:top-[2.7rem] lg:mb-0"
        >
          {num}
        </span>
      ) : null}

      <a href={`#${id}`} className="no-underline">
        {rest}
        <span
          aria-hidden
          className="ml-3 align-middle font-mono text-sm text-paper-faint opacity-0 transition-opacity group-hover:opacity-100"
        >
          #
        </span>
      </a>
    </h2>
  );
};

const Sub = ({ children }: { children?: React.ReactNode }) => {
  const id = slugify(textOf(children));
  return (
    <h3 id={id} className="group scroll-mt-28">
      <a href={`#${id}`} className="no-underline">
        {children}
        <span
          aria-hidden
          className="ml-3 align-middle font-mono text-sm text-paper-faint opacity-0 transition-opacity group-hover:opacity-100"
        >
          #
        </span>
      </a>
    </h3>
  );
};

export const Markdown = ({ children }: { children: string }) => {
  /*
    Which fence is the first one on this page.

    Scoped to the render rather than kept at module level: ReactMarkdown walks
    the tree in document order during a single pass, so a closure counter is
    correct and a module-level one would leak across pages and mark the wrong
    block on the second document rendered.
  */
  let fences = 0;

  return (
    <article
      /*
      A measure, not a column width. These documents are read start to finish,
      and a line of 110 characters loses the reader on the return sweep — the
      eye has to find which of two near-identical lines it just left. Tables and
      fenced blocks are allowed past it, because a column of measurements that
      wraps is worse than one that scrolls.

      The heading anchors need both `no-underline` and `text-paper`: they are
      real links, so Typography's `.prose :where(a)` rule reaches them and
      would otherwise paint every section title in the accent. A descendant
      selector outranks `:where`, which contributes no specificity.
    */
      className="prose prose-invert max-w-[72ch]
      prose-pre:max-w-none [&_.overflow-x-auto]:max-w-none [&_figure]:max-w-none
      prose-headings:font-display prose-headings:font-normal prose-headings:uppercase prose-headings:leading-[0.95]
      [&_h2>a]:no-underline [&_h3>a]:no-underline
      [&_h2>a]:text-paper [&_h3>a]:text-paper
      prose-h1:text-[2.75rem] sm:prose-h1:text-[3.5rem] prose-h1:mb-8
      prose-h2:text-[2rem] prose-h2:mt-20 prose-h2:mb-6 prose-h2:pt-10 prose-h2:border-t prose-h2:border-line
      prose-h3:text-xl prose-h3:mt-12 prose-h3:mb-4
      prose-p:text-paper-dim prose-p:leading-[1.75] prose-li:text-paper-dim prose-li:leading-[1.75]
      prose-strong:text-paper prose-strong:font-semibold
      prose-em:text-paper-dim
      prose-a:text-signal prose-a:underline prose-a:underline-offset-[3px] prose-a:decoration-signal-dim hover:prose-a:decoration-signal
      prose-hr:border-transparent prose-hr:my-4"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFigures]}
        components={{
          ...({
            "doc-figure": ({ name }: { name: string }) => {
              const Figure = FIGURES[name];
              return (
                <figure className="not-prose lift my-10 overflow-hidden border border-line bg-ink-raised/40">
                  <Figure />
                </figure>
              );
            },
          } as Components),
          h2: Section,
          h3: Sub,

          /*
          A callout, not an indent.

          Every blockquote in these documents is a warning about something that
          costs a day when it bites. Set as prose with a left rule it reads as
          an aside and gets skipped; set as a panel with a marked edge it reads
          as the thing to slow down for.
        */
          /*
            Two kinds, told apart by their first words. A note that opens with
            "Nocturne:" is how this template handles the problem above it, and
            gets the accent. Everything else is a warning, and gets the colour
            the site reserves for things that fail.
          */
          blockquote: ({ children }) => {
            const fix = textOf(children).trimStart().startsWith("Nocturne:");
            return (
              <div
                className={`my-8 border-l-2 px-6 py-1 [&>p]:text-paper-dim [&_strong]:text-paper ${
                  fix ? "border-signal bg-signal-glow/30" : "border-signal-dead bg-signal-dead/[0.07]"
                }`}
              >
                {children}
              </div>
            );
          },

          // Tables of measurements are the point of these documents and are often
          // wider than a phone. Scroll the table, never the page.
          table: ({ children }) => (
            <div className="my-8 max-w-none overflow-x-auto border border-line bg-ink-raised/40">
              <table className="m-0 w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-ink-sunken/60">{children}</thead>,
          // Nowrap on the header, because a measurement table's columns are
          // narrow and a wrapped heading reads as a row of its own.
          th: ({ children }) => (
            <th className="eyebrow whitespace-nowrap border-b border-line px-4 py-3.5 text-left font-normal">
              {children}
            </th>
          ),
          tr: ({ children }) => <tr className="border-b border-line last:border-b-0">{children}</tr>,
          td: ({ children }) => <td className="px-4 py-3.5 align-top text-paper-dim">{children}</td>,

          /*
          The language tag lives on the inner <code>, not on <pre>, so it has to
          be dug out of the child element's className here — by the time the
          `code` renderer sees it, the wrapper has already been chosen.
        */
          pre: ({ children }) => {
            const child = Children.toArray(children)[0];
            const className = isValidElement(child) ? ((child.props as { className?: string }).className ?? "") : "";
            const language = /language-(\w+)/.exec(className)?.[1];
            return (
              <CodeBlock language={language} primary={fences++ === 0}>
                {children}
              </CodeBlock>
            );
          },

          code: ({ className, children, ...props }) => {
            const fenced = /language-/.test(className ?? "");
            return fenced ? (
              <code className={className} {...props}>
                {children}
              </code>
            ) : (
              <code className="border border-line bg-ink-raised px-1.5 py-0.5 text-[0.85em] font-normal text-paper before:content-none after:content-none">
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
};
