import fs from "fs";
import path from "path";

/**
 * The documents behind `/docs`.
 *
 * These are read from the repository's own markdown at build time rather than
 * copied into the app. Copying would mean two versions of every measured number
 * and one of them going quietly wrong; a template whose docs disagree with its
 * code teaches the wrong thing twice.
 *
 * It also means the docs ship with the template. Somebody who scaffolds this
 * repository gets the markdown in `docs/` on their own disk, not just a website
 * they have to stay online to read.
 */

export type Doc = {
  slug: string;
  title: string;
  blurb: string;
  /** Path from the repository root. */
  file: string;
  /** Roughly how long it takes to read, so a reader can budget. */
  minutes: number;
};

/**
 * Ordered as a path through the material, not by length.
 *
 * The first four are a sequence: get it running, make it yours, look things up,
 * work out what it costs. The last three are the reference material behind the
 * claims — longer, denser, and written for somebody who has already decided to
 * dig.
 */
export const DOCS: Doc[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    blurb: "Scaffold, deploy, arm a vault, watch it run itself.",
    file: "docs/quickstart.md",
    minutes: 6,
  },
  {
    slug: "writing-a-strategy",
    title: "Write a strategy",
    blurb: "The part you write. Four functions, two worked examples, four rules.",
    file: "docs/writing-a-strategy.md",
    minutes: 9,
  },
  {
    slug: "vault-reference",
    title: "Vault reference",
    blurb: "Every function, every event, and the ones that will surprise you.",
    file: "docs/vault-reference.md",
    minutes: 7,
  },
  {
    slug: "fuel",
    title: "Fuel and runway",
    blurb: "What a run reserves versus what it costs, and how much to fund.",
    file: "docs/fuel.md",
    minutes: 6,
  },
  {
    slug: "architecture",
    title: "Architecture",
    blurb: "Six contracts, the loop, what the vault refuses, and what is deliberately absent.",
    file: "docs/architecture.md",
    minutes: 5,
  },
  {
    slug: "landmines",
    title: "Six silent failures",
    blurb: "Every one measured on testnet, with the command that reproduces it. None report an error.",
    file: "docs/hedera-landmines.md",
    minutes: 9,
  },
  {
    slug: "dead-ends",
    title: "Dead ends",
    blurb: "What was tried and abandoned, and the thing that closed each one.",
    file: "docs/dead-ends.md",
    minutes: 6,
  },
];

/**
 * The repository root, found by walking up from the Next.js app.
 *
 * `process.cwd()` is `packages/nextjs` when the dev server or the build runs,
 * so the markdown sits two directories above it. Resolved by looking for a
 * marker rather than counting `..` segments, so moving the app one level does
 * not silently start reading the wrong files.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "ARCHITECTURE.md"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("could not find the repository root from " + process.cwd());
}

export type Heading = { depth: 2 | 3; text: string; id: string };

/**
 * GitHub's slug rules, near enough.
 *
 * It has to match what the renderer puts on each heading, or every link in the
 * contents jumps nowhere. Lowercase, strip anything that is not a word
 * character or a space, collapse spaces to hyphens.
 */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * Pull the h2s and h3s out of a document for the contents rail.
 *
 * Fenced code is skipped, because a `#` at the start of a line inside a shell
 * block is a comment, and without this every `# one settlement, in full` would
 * arrive in the table of contents.
 */
export function outline(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let fenced = false;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!match) continue;

    const text = match[2].replace(/`/g, "").trim();
    headings.push({ depth: match[1].length as 2 | 3, text, id: slugify(text) });
  }

  return headings;
}

export function getDoc(slug: string): { doc: Doc; markdown: string; headings: Heading[] } | undefined {
  const doc = DOCS.find(d => d.slug === slug);
  if (!doc) return undefined;
  const markdown = fs.readFileSync(path.join(repoRoot(), doc.file), "utf8");
  return { doc, markdown, headings: outline(markdown) };
}

/** Every document's text, for the search index. Built once, at build time. */
export function searchIndex() {
  return DOCS.map(doc => {
    const markdown = fs.readFileSync(path.join(repoRoot(), doc.file), "utf8");
    return { slug: doc.slug, title: doc.title, headings: outline(markdown) };
  });
}
