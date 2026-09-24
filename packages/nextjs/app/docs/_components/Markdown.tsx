import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown, styled for reading rather than for looking like a README.
 *
 * DaisyUI's `prose` covers most of it. The overrides below exist because these
 * particular documents lean on three things heavily: wide tables of measured
 * numbers, fenced blocks holding commands meant to be copied, and inline code
 * naming Solidity identifiers. Each gets treatment that survives a phone.
 */
export const Markdown = ({ children }: { children: string }) => (
  <article className="prose prose-sm sm:prose-base max-w-none prose-headings:font-semibold prose-a:link prose-pre:bg-base-300 prose-pre:text-base-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Tables of measurements are the point of these documents and are often
        // wider than a phone. Scroll the table, never the page.
        table: ({ children }) => (
          <div className="overflow-x-auto">
            <table className="table table-sm">{children}</table>
          </div>
        ),
        // Commands are meant to be copied, so they must not wrap mid-flag.
        pre: ({ children }) => <pre className="overflow-x-auto text-xs sm:text-sm">{children}</pre>,
        code: ({ className, children, ...props }) => {
          const fenced = /language-/.test(className ?? "");
          return fenced ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code className="bg-base-300 px-1 py-0.5 rounded text-[0.9em] before:content-none after:content-none">
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
