import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "../_components/Markdown";
import { Sidebar } from "../_components/Sidebar";
import { DOCS, getDoc } from "../_lib/documents";

/** Every document is known at build time, so all of them are prerendered. */
export function generateStaticParams() {
  return DOCS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = getDoc((await params).slug);
  return { title: found ? found.doc.title : "Docs" };
}

const REPO = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main";

const DocPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const found = getDoc((await params).slug);
  if (!found) notFound();

  const { doc, markdown } = found;

  return (
    <div className="w-full px-5 sm:px-8 pb-32">
      <div className="mx-auto w-full max-w-6xl grid lg:grid-cols-[15rem_1fr] gap-x-14 pt-14">
        <Sidebar />

        <main className="min-w-0">
          {/*
            The source, because a document whose whole argument is "check this
            yourself" should be checkable at the level of the document too.
          */}
          <div className="flex items-center justify-between gap-4 border-b border-line pb-4 mb-12">
            <Link href="/docs" className="eyebrow hover:text-paper transition-colors">
              ← All docs
            </Link>
            <a
              className="eyebrow hover:text-paper transition-colors"
              href={`${REPO}/${doc.file}`}
              target="_blank"
              rel="noreferrer"
            >
              {doc.file} ↗
            </a>
          </div>

          <Markdown>{markdown}</Markdown>
        </main>
      </div>
    </div>
  );
};

export default DocPage;
