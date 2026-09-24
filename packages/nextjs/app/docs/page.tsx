import Link from "next/link";
import { Search } from "./_components/Search";
import { DOCS, searchIndex } from "./_lib/documents";
import type { NextPage } from "next";

export const metadata = {
  title: "Docs",
  description: "Everything a developer needs to scaffold Nocturne, write a strategy, and ship it on Hedera.",
};

/**
 * The docs index.
 *
 * It opens by saying what the thing is, in one paragraph, the way a reference
 * site should — not with a slogan. Somebody landing here has either arrived
 * from the landing page and wants to start, or arrived from a search and has no
 * idea what this is; the paragraph serves the second without costing the first
 * anything.
 *
 * Then four capabilities, because "what can it do" is the question a judge is
 * actually holding, and answering it in a grid beats making them infer it from
 * a table of contents.
 *
 * The pages are split into two groups. The first four are a path — get it
 * running, make it yours, look things up, work out what it costs. The last
 * three are the evidence behind the claims. Seven equal cards would hide that
 * distinction and leave a reader to guess where to start, which is the most
 * common way a documentation index fails.
 */

const CAPABILITIES = [
  {
    title: "Schedule itself",
    body: "A vault books its own next execution through the Hedera Schedule Service. No keeper, no server, no cron.",
  },
  {
    title: "Choose its own cadence",
    body: "The strategy returns the interval, so a vault can check every six hours or every sixty seconds depending on what it sees.",
  },
  {
    title: "Refuse, and say why",
    body: "Two price sources must agree before it trades. When they do not, nothing moves and the reason is written on chain.",
  },
  {
    title: "Pay its own way",
    body: "The vault is the schedule's payer and funds its own gas, with a runway figure you can read at any time.",
  },
];

const DocsIndex: NextPage = () => {
  const index = searchIndex();
  const path = DOCS.slice(0, 4);
  const evidence = DOCS.slice(4);

  return (
    <div className="flex w-full grow flex-col pb-28">
      <div className="shell">
        <header className="glowfield pt-16 pb-14 sm:pt-20">
          <h1 className="display display-lit mb-0 text-[clamp(2.4rem,7vw,6rem)]">Get started.</h1>

          <p className="mb-0 mt-9 max-w-2xl text-lg leading-relaxed text-paper-dim">
            Nocturne is a Scaffold-HBAR template for contracts that run on a schedule without a keeper. A vault holds
            funds, books its own next execution through{" "}
            <span className="text-paper">Hedera&apos;s Schedule Service</span>, and pays the fee out of its own balance.
            You write a strategy; the vault does the rest.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/docs/quickstart" className="btn-signal">
              Quickstart <span aria-hidden>→</span>
            </Link>
            <div className="w-full max-w-xs sm:w-auto sm:min-w-[18rem]">
              <Search index={index} />
            </div>
          </div>
        </header>

        {/* What it can do, before what to read. */}
        <section className="mt-6">
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line p-0 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map(c => (
              <li key={c.title} className="bg-ink-raised/60 px-6 py-7">
                <p className="display mb-0 text-lg text-paper">{c.title}</p>
                <p className="mb-0 mt-3 text-sm leading-relaxed text-paper-dim">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <Group label="Start here" docs={path} offset={0} />
        <Group label="The evidence" docs={evidence} offset={path.length} />
      </div>
    </div>
  );
};

const Group = ({ label, docs, offset }: { label: string; docs: typeof DOCS; offset: number }) => (
  <section className="mt-20">
    <p className="eyebrow mb-3">{label}</p>

    <ol className="m-0 list-none border-t border-line p-0">
      {docs.map((doc, i) => (
        <li key={doc.slug}>
          <Link
            href={`/docs/${doc.slug}`}
            className="group -mx-4 grid gap-x-8 gap-y-2 border-b border-line px-4 py-7 transition-colors hover:bg-ink-raised/60 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
          >
            <span className="eyebrow self-start pt-1.5 transition-colors group-hover:text-signal">
              {String(offset + i + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="display mb-0 text-2xl transition-colors group-hover:text-signal">{doc.title}</h2>
              <p className="mb-0 mt-2.5 max-w-2xl leading-relaxed text-paper-dim">{doc.blurb}</p>
            </div>
            <span className="eyebrow hidden self-center whitespace-nowrap sm:block">{doc.minutes} min</span>
          </Link>
        </li>
      ))}
    </ol>
  </section>
);

export default DocsIndex;
