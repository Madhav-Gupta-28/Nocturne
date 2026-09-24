import { CodeBlock } from "./CodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown, styled for reading rather than for looking like a README.
 *
 * `prose` covers most of it. The overrides below exist because these documents
 * lean on three things heavily: wide tables of measured numbers, fenced blocks
 * holding commands meant to be copied, and inline code naming Solidity
 * identifiers. Each gets treatment that survives a phone.
 */
export const Markdown = ({ children }: { children: string }) => (
  <article
    className="prose prose-invert max-w-none
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
        // Tables of measurements are the point of these documents and are often
        // wider than a phone. Scroll the table, never the page.
        table: ({ children }) => (
          <div className="overflow-x-auto my-6 border border-line">
            <table className="w-full m-0 text-sm border-collapse">{children}</table>
          </div>
        ),
        // Nowrap on the header, because a measurement table's columns are
        // narrow and a wrapped heading reads as a row of its own.
        th: ({ children }) => <th className="eyebrow whitespace-nowrap text-left px-4 py-3 font-normal">{children}</th>,
        tr: ({ children }) => <tr className="border-b border-line last:border-b-0">{children}</tr>,
        td: ({ children }) => <td className="px-4 py-3 align-top">{children}</td>,

        // Commands are meant to be copied, so they get a header and a button
        // rather than wrapping mid-flag.
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,

        code: ({ className, children, ...props }) => {
          const fenced = /language-/.test(className ?? "");
          return fenced ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code className="bg-ink-raised text-paper px-1.5 py-0.5 text-[0.9em] before:content-none after:content-none">
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
