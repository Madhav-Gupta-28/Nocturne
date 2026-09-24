import Link from "next/link";
import { DOCS } from "./_lib/documents";
import type { NextPage } from "next";

export const metadata = { title: "Docs" };

/**
 * The index.
 *
 * Ordered by what a reader needs first rather than by length: the landmines are
 * the thing that will cost someone a weekend, so they go above the design
 * document even though the design document is six times the size.
 */
const DocsIndex: NextPage = () => (
  <div className="flex w-full grow flex-col pb-28">
    <div className="shell">
      <header className="glowfield pt-14 pb-16 sm:pt-20">
        <p className="eyebrow m-0">Docs</p>
        <h1 className="display mt-8 mb-0 text-[clamp(2.2rem,7vw,6.5rem)]">
          Everything here was <span className="text-signal">measured.</span>
        </h1>
        <p className="mt-7 mb-0 max-w-2xl text-lg leading-relaxed text-paper-dim">
          Rendered from the markdown in the repository, so nothing on these pages can drift from what the code actually
          does. Every measured number carries the command that produced it.
        </p>
      </header>

      <ol className="m-0 p-0 list-none border-t border-line">
        {DOCS.map((doc, i) => (
          <li key={doc.slug}>
            <Link
              href={`/docs/${doc.slug}`}
              className="group grid sm:grid-cols-[3rem_1fr_auto] gap-x-8 gap-y-3 border-b border-line py-8 hover:bg-ink-raised transition-colors px-2 -mx-2"
            >
              <span className="eyebrow pt-2 self-start">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h2 className="display text-2xl sm:text-3xl m-0 mb-4 group-hover:text-signal transition-colors">
                  {doc.title}
                </h2>
                <p className="m-0 text-paper-dim leading-relaxed max-w-2xl">{doc.blurb}</p>
                <p className="eyebrow mt-4 mb-0">{doc.file}</p>
              </div>
              <span className="text-paper-faint self-center hidden sm:block group-hover:text-signal transition-colors">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  </div>
);

export default DocsIndex;
