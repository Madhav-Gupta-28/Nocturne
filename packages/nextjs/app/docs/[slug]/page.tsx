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
 * What Nocturne can do, shown once, at the top of the first document.
 *
 * `/docs` redirects here, so this is where somebody arriving from the header
 * lands — and "what can it do" is the question a judge is holding when they
 * arrive. It appears on the quickstart only; repeating it above the vault
 * reference would be furniture.
 */
const CAPABILITIES = [
  ["Schedules itself", "Books its own next run through the Hedera Schedule Service"],
  ["Sets its own pace", "Six hours or sixty seconds, decided per run by the strategy"],
  ["Can refuse", "Two prices must agree, or nothing moves and the reason is logged"],
  ["Pays its own way", "The vault funds its own gas, with a runway you can read"],
];

/**
 * One document.
 *
 * Two columns: the rail, and the prose. No third column of contents on the
 * right — the rail already carries the outline, and a second copy of the same
 * information is a second thing to maintain and nothing to read.
 */
const DocPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const found = getDoc((await params).slug);
  if (!found) notFound();

  const { doc, markdown, headings } = found;
  const index = searchIndex();
  const position = DOCS.findIndex(d => d.slug === doc.slug);
  const next = DOCS[position + 1];
  const isEntry = position === 0;

  return (
    <div className="doc-ground w-full pb-28">
      <div className="shell grid gap-x-16 pt-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="mb-12 lg:mb-0">
          <div className="mb-8">
            <Search index={index} />
          </div>
          <Sidebar docs={DOCS} headings={headings} />
        </div>

        <main className="min-w-0 lg:pl-14">
          {/*
            The entry document gets an opening that says what this is. Every
            other one gets a thin rule with its position and source, because a
            reader who has reached the vault reference already knows.
          */}
          {isEntry ? (
            <header className="mb-16">
              <p className="eyebrow mb-0">Nocturne · Hedera testnet</p>
              <h1 className="display display-lit mb-0 mt-9 text-[clamp(2.6rem,6vw,4.5rem)]">
                Contracts that <span className="marker">run themselves.</span>
              </h1>
              <p className="mb-0 mt-8 max-w-[62ch] text-lg leading-relaxed text-paper-dim">
                A Scaffold-HBAR template for on-chain jobs with no keeper. A vault holds funds, books its own next
                execution through Hedera&apos;s Schedule Service, and pays the fee from its own balance. You write a
                strategy; the vault does the rest.
              </p>

              <ul className="m-0 mt-10 grid list-none grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line p-0 sm:grid-cols-2">
                {CAPABILITIES.map(([title, body]) => (
                  <li key={title} className="bg-ink-raised/70 px-5 py-5">
                    <p className="mb-0 font-mono text-[13px] text-signal">{title}</p>
                    <p className="mb-0 mt-2 text-sm leading-snug text-paper-dim">{body}</p>
                  </li>
                ))}
              </ul>
            </header>
          ) : (
            <div className="mb-14 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
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
          )}

          <Markdown>{markdown}</Markdown>

          {/*
            Somewhere to go next. A documentation page that ends at the bottom
            of its last paragraph sends the reader back to an index to
            continue, and most of them simply stop instead.
          */}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="lift group mt-20 flex items-center justify-between gap-6 border border-line bg-ink-raised/50 p-6 transition-colors hover:border-signal/40 hover:bg-signal-glow/25"
            >
              <span>
                <span className="eyebrow">Next · {next.minutes} min</span>
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
