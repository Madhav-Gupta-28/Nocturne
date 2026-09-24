import { redirect } from "next/navigation";
import { DOCS } from "./_lib/documents";

/**
 * `/docs` is the first document, not a menu.
 *
 * The rail beside every page is already a complete table of contents, so an
 * index page was showing the same list twice and charging a click for it.
 * Somebody who clicks "Docs" wants to read documentation; landing them on a
 * page of links to documentation is a step that exists only because the site
 * has a folder.
 *
 * What the index carried that was worth keeping — the paragraph saying what
 * Nocturne is, and the four capabilities — moved into the quickstart's own
 * opening, where it is read by everybody rather than by whoever happened to
 * arrive through the index.
 */
const DocsIndex = () => redirect(`/docs/${DOCS[0].slug}`);

export default DocsIndex;
