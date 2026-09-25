import Link from "next/link";

/** A wrong turn, in the site's own voice, with one way back. */
export default function NotFound() {
  return (
    <div className="shell flex w-full flex-1 flex-col justify-center pb-28 pt-16 sm:pt-24">
      <p className="eyebrow m-0 text-signal">404</p>
      <h1 className="display display-lit mb-0 mt-5 text-[clamp(2.4rem,7vw,5.5rem)]">
        Nothing scheduled <span className="marker">here.</span>
      </h1>
      <p className="mb-0 mt-8 max-w-md text-lg leading-relaxed text-paper-dim">This page doesn&apos;t exist.</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/" className="btn-signal">
          Home <span aria-hidden>→</span>
        </Link>
        <Link href="/docs" className="btn-line">
          Docs
        </Link>
      </div>
    </div>
  );
}
