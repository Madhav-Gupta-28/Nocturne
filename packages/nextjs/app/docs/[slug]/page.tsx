import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "../_components/Markdown";
import { Search } from "../_components/Search";
import { Sidebar } from "../_components/Sidebar";
import { DOCS, getDoc, searchIndex } from "../_lib/documents";

/** Every document is known at build time, so all of them are prerendered. */
export function generateStaticParams() {
  return DOCS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = getDoc((await params).slug);
  return found ? { title: found.doc.title, description: found.doc.blurb } : { title: "Docs" };
}

const REPO = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main";

/**
 * One document.
 *
 * Three columns on a wide screen: the rail, the prose, and — on the widest —
 * nothing, because the rail already carries the outline and a second copy of it
 * on the right would be the same information twice.
 *
 * The prose column is capped at a reading measure rather than filling the
 * space. A documentation page that runs the full width of a 27-inch monitor is
 * unreadable, and the empty margin is doing a job.
 */
const DocPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const found = getDoc((await params).slug);
  if (!found) notFound();

  const { doc, markdown, headings } = found;
  const index = searchIndex();
  const position = DOCS.findIndex(d => d.slug === doc.slug);
  const next = DOCS[position + 1];

  return (
    <div className="w-full pb-28">
      <div className="shell grid gap-x-16 pt-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="mb-12 lg:mb-0">
          <div className="mb-8">
            <Search index={index} />
          </div>
          <Sidebar docs={DOCS} headings={headings} />
        </div>

        <main className="min-w-0">
          {/*
            The source, because a document whose whole argument is "check this
            yourself" should be checkable at the level of the document too.
          */}
          <div className="mb-12 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="eyebrow">
              {String(position + 1).padStart(2, "0")} · {doc.minutes} min read
            </span>
            <a
              className="eyebrow transition-colors hover:text-paper"
              href={`${REPO}/${doc.file}`}
              target="_blank"
              rel="noreferrer"
            >
              {doc.file} ↗
            </a>
          </div>

          <Markdown>{markdown}</Markdown>

          {/*
            Somewhere to go next. A documentation page that ends at the bottom
            of its last paragraph makes the reader go back to an index to
            continue, and most of them simply stop instead.
          */}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="group mt-20 flex items-center justify-between gap-6 border border-line p-6 transition-colors hover:border-line-bright hover:bg-ink-raised/60"
            >
              <span>
                <span className="eyebrow">Next</span>
                <span className="display mt-2 block text-2xl transition-colors group-hover:text-signal">
                  {next.title}
                </span>
              </span>
              <span className="shrink-0 text-paper-faint transition-colors group-hover:text-signal" aria-hidden>
                →
              </span>
            </Link>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default DocPage;
