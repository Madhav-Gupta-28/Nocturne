import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "../_components/Markdown";
import { DOCS, getDoc } from "../_lib/documents";

/** Every document is known at build time, so all of them are prerendered. */
export function generateStaticParams() {
  return DOCS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = getDoc((await params).slug);
  return { title: found ? found.doc.title : "Docs" };
}

const DocPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const found = getDoc((await params).slug);
  if (!found) notFound();

  const { doc, markdown } = found;
  const repo = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main";

  return (
    <div className="flex flex-col items-center grow w-full px-4 pt-10 pb-20">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/docs" className="link text-sm no-underline opacity-70">
            ← all docs
          </Link>
          {/* The source, because a document about verifying things should be verifiable. */}
          <a
            className="link text-sm no-underline opacity-70"
            href={`${repo}/${doc.file}`}
            target="_blank"
            rel="noreferrer"
          >
            {doc.file} on GitHub →
          </a>
        </div>

        <div className="bg-base-100 rounded-2xl p-6 sm:p-8 shadow-sm">
          <Markdown>{markdown}</Markdown>
        </div>
      </div>
    </div>
  );
};

export default DocPage;
