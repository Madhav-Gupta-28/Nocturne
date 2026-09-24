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
  <div className="flex flex-col items-center grow w-full px-4 pt-10 pb-20">
    <div className="w-full max-w-3xl flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold m-0">Docs</h1>
        <p className="opacity-70 m-0 max-w-2xl">
          Rendered from the markdown in the repository, so nothing here can drift from what the code actually does.
          Every measured number carries the command that measured it.
        </p>
      </header>

      <nav className="flex flex-col gap-4">
        {DOCS.map(doc => (
          <Link
            key={doc.slug}
            href={`/docs/${doc.slug}`}
            className="bg-base-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow no-underline"
          >
            <h2 className="text-lg font-semibold mt-0 mb-2">{doc.title}</h2>
            <p className="text-sm opacity-70 m-0">{doc.blurb}</p>
            <p className="text-xs opacity-40 mt-3 mb-0 font-mono">{doc.file}</p>
          </Link>
        ))}
      </nav>
    </div>
  </div>
);

export default DocsIndex;
