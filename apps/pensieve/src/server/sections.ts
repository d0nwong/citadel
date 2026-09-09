/**
 * Slicing a parsed markdown document by its headings — pure, no fs, so a test can hand it
 * `parseMarkdown` output straight. The home page uses it to show the sweep report without
 * its `## Needs you` section: that section is what `reports/points.json` is derived from,
 * and the queue above the report is the copy with buttons (one item, one place).
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

function withHeadings(
  doc: MarkdownDocument,
  children: BlockNode[]
): MarkdownDocument {
  return { ...doc, children, headings: outline({ children }) };
}

/**
 * The document without the `## <title>` section: that heading and every block up to the
 * next heading of depth 2 or less. Case-insensitive on the title; the document itself
 * comes back when no such section exists.
 */
export function dropSection(
  doc: MarkdownDocument,
  title: string
): MarkdownDocument {
  const want = title.trim().toLowerCase();
  const out: BlockNode[] = [];
  let dropping = false;
  let found = false;
  for (const node of doc.children) {
    if (node.type === "heading" && node.depth <= 2) {
      dropping =
        node.depth === 2 &&
        inlineText(node.children).trim().toLowerCase() === want;
      found ||= dropping;
    }
    if (!dropping) {
      out.push(node);
    }
  }
  return found ? withHeadings(doc, out) : doc;
}

/**
 * The document without its TL;DR callout: the first blockquote before the first `##`,
 * when its opening text is "TL;DR". The sweep writes one at the top of every report
 * (argus `skills/sweep/style.md`, "Summary first"); on the home page its Decide / Verify /
 * Confirm lines restate the queue rendered directly above, so the home page drops it and
 * keeps the summary sentence. The document itself comes back when there is none.
 */
export function dropTldr(doc: MarkdownDocument): MarkdownDocument {
  for (let i = 0; i < doc.children.length; i++) {
    const node = doc.children[i]!;
    if (node.type === "heading" && node.depth === 2) {
      break;
    }
    if (node.type !== "blockquote") {
      continue;
    }
    const first = node.children[0];
    const text =
      first && "children" in first && Array.isArray(first.children)
        ? inlineText(first.children as InlineNode[]).trim()
        : "";
    if (/^TL;DR\b/i.test(text)) {
      return withHeadings(doc, [
        ...doc.children.slice(0, i),
        ...doc.children.slice(i + 1),
      ]);
    }
    break;
  }
  return doc;
}

/** The document without a leading `# title` — for a page whose header already names it. */
export function dropTitle(doc: MarkdownDocument): MarkdownDocument {
  const [first, ...rest] = doc.children;
  if (first?.type !== "heading" || first.depth !== 1) {
    return doc;
  }
  return withHeadings(doc, rest);
}
