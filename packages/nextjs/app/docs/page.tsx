import Link from "next/link";
import { Search } from "./_components/Search";
import { DOCS, searchIndex } from "./_lib/documents";
import type { NextPage } from "next";

export const metadata = {
  title: "Docs",
  description: "Scaffold it, write a strategy, and every measured number with the command that produced it.",
};

/**
 * The index.
 *
 * Split into two groups because they are read differently. The first four are a
 * path — get it running, make it yours, look things up, work out what it costs.
 * The last three are the evidence behind the claims: longer, denser, and
 * written for somebody who has already decided to dig.
 *
 * Presenting seven equal cards would hide that distinction and leave a reader
 * to guess where to start, which is the most common way a documentation index
 * fails.
 */
const DocsIndex: NextPage = () => {
  const index = searchIndex();
  const path = DOCS.slice(0, 4);
  const reference = DOCS.slice(4);

  return (
    <div className="flex w-full grow flex-col pb-28">
      <div className="shell">
        <header className="glowfield pt-14 pb-14 sm:pt-20">
          <p className="eyebrow m-0">Docs</p>
          <h1 className="display display-lit mt-8 mb-0 text-[clamp(2.2rem,6.4vw,5.5rem)]">
            Everything here was <span className="text-signal display-lit-signal">measured.</span>
          </h1>
          <p className="mt-9 mb-0 max-w-2xl text-lg leading-relaxed text-paper-dim">
            Rendered from the markdown in the repository, so nothing on these pages can drift from what the code does.
            Every measured number carries the command that produced it.
          </p>

          <div className="mt-10 max-w-sm">
            <Search index={index} />
          </div>
        </header>

        <Group label="Start here" docs={path} offset={0} />
        <Group label="The evidence" docs={reference} offset={path.length} />
      </div>
    </div>
  );
};

const Group = ({ label, docs, offset }: { label: string; docs: typeof DOCS; offset: number }) => (
  <section className="mt-20">
    <p className="eyebrow m-0 mb-2">{label}</p>

    <ol className="m-0 list-none border-t border-line p-0">
      {docs.map((doc, i) => (
        <li key={doc.slug}>
          <Link
            href={`/docs/${doc.slug}`}
            className="group -mx-2 grid gap-x-8 gap-y-3 border-b border-line px-2 py-8 transition-colors hover:bg-ink-raised/60 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
          >
            <span className="eyebrow self-start pt-2">{String(offset + i + 1).padStart(2, "0")}</span>
            <div>
              <h2 className="display m-0 mb-4 text-2xl transition-colors group-hover:text-signal sm:text-3xl">
                {doc.title}
              </h2>
              <p className="m-0 max-w-2xl leading-relaxed text-paper-dim">{doc.blurb}</p>
              <p className="eyebrow mt-4 mb-0">
                {doc.file} · {doc.minutes} min
              </p>
            </div>
            <span className="hidden self-center text-paper-faint transition-colors group-hover:text-signal sm:block">
              →
            </span>
          </Link>
        </li>
      ))}
    </ol>
  </section>
);

export default DocsIndex;
