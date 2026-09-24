import fs from "fs";
import path from "path";

/**
 * The documents behind `/docs`.
 *
 * These are read from the repository's own markdown at build time rather than
 * copied into the app. Copying would mean two versions of every measured number
 * and one of them going quietly wrong; a template whose docs disagree with its
 * code teaches the wrong thing twice.
 */

export type Doc = {
  slug: string;
  title: string;
  blurb: string;
  /** Path from the repository root. */
  file: string;
};

export const DOCS: Doc[] = [
  {
    slug: "landmines",
    title: "Six ways HSS automation fails silently",
    blurb:
      "Every one measured on testnet, with the command that measured it. None are in Hedera's documentation, and none of them look like a failure when they happen.",
    file: "docs/hedera-landmines.md",
  },
  {
    slug: "architecture",
    title: "Architecture",
    blurb:
      "The whole design: why the mechanism is correct, the arithmetic, the failure modes, the threat model, and every chain fact marked as measured or assumed.",
    file: "ARCHITECTURE.md",
  },
  {
    slug: "dead-ends",
    title: "Dead ends",
    blurb: "What was tried and abandoned, and what closed it. Two of these look correct right up until they are not.",
    file: "docs/dead-ends.md",
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

export function getDoc(slug: string): { doc: Doc; markdown: string } | undefined {
  const doc = DOCS.find(d => d.slug === slug);
  if (!doc) return undefined;
  return { doc, markdown: fs.readFileSync(path.join(repoRoot(), doc.file), "utf8") };
}
