/**
 * Slicing a parsed markdown document by its headings — pure, no fs, so a test can hand it
 * `parseMarkdown` output straight. Every rendered page here names itself in its own header,
 * so `dropTitle` takes the document's `# title` off; `outline` is the table of contents the
 * rail is built from.
 */

import type {
  BlockNode,
  InlineNode,
  MarkdownDocument,
  MarkdownHeading,
} from "@tanstack/markdown";

function inlineText(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    if ("value" in n && typeof n.value === "string") {
      out += n.value;
    } else if ("children" in n && Array.isArray(n.children)) {
      out += inlineText(n.children as InlineNode[]);
    }
  }
  return out;
}

/** The plain text of a heading node — `null` for any other block. */
export const headingText = (node: BlockNode): string | null =>
  node.type === "heading" ? inlineText(node.children).trim() : null;

/**
 * The document's outline, from its heading nodes. The parser fills `headings` only through
 * its docs extension, which the reader does not use — so this is where "On this page" and
 * every sliced document get theirs, and it always agrees with the body.
 */
export function outline(
  doc: Pick<MarkdownDocument, "children">
): MarkdownHeading[] {
  const out: MarkdownHeading[] = [];
  for (const n of doc.children) {
    if (n.type === "heading" && n.id) {
      out.push({
        id: n.id,
        level: n.depth,
        text: inlineText(n.children).trim(),
      });
    }
  }
  return out;
}

/** A sliced document with its outline rebuilt, so the rail always agrees with the body. */
function withHeadings(
  doc: MarkdownDocument,
  children: BlockNode[]
): MarkdownDocument {
  return { ...doc, children, headings: outline({ children }) };
}

/** The document without a leading `# title` — for a page whose header already names it. */
export function dropTitle(doc: MarkdownDocument): MarkdownDocument {
  const [first, ...rest] = doc.children;
  if (first?.type !== "heading" || first.depth !== 1) {
    return doc;
  }
  return withHeadings(doc, rest);
}
