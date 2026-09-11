import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { dropTitle, headingText, outline } from "./sections";

const REPORT = `# sweep — 2026-09-07

_Tick 19:16 · staging@815a6aa31_

## Needs you

**Decide**
- **BR-157** — accept, or ticket a fix? · new

### Verify

- **LIA-112's swagger AC** — still isn't on \`origin/dev\` · new

## Done today

### 09:22
- Digest woke up.

## Audit

Clean.
`;

const parse = (md: string) => parseMarkdown(md, { headingIds: true });
const titles = (doc: ReturnType<typeof parse>) =>
  doc.children.map(headingText).filter((t): t is string => t !== null);

describe("dropTitle", () => {
  test("removes a leading h1 and only that", () => {
    const doc = dropTitle(parse(REPORT));
    expect(titles(doc)[0]).toBe("Needs you");
    expect(doc.headings?.[0]?.text).toBe("Needs you");
    expect(JSON.stringify(doc.children)).toContain("Tick 19:16");
  });

  test("leaves a document that does not start with an h1 alone", () => {
    const doc = parse("_lede_\n\n# later\n");
    expect(dropTitle(doc)).toBe(doc);
  });
});

describe("outline", () => {
  test("id, text and level from the heading nodes, whatever the parser filled in", () => {
    const doc = parse(REPORT);
    expect(doc.headings).toBeUndefined();
    expect(outline(doc)).toEqual([
      { id: "sweep-2026-09-07", level: 1, text: "sweep — 2026-09-07" },
      { id: "needs-you", level: 2, text: "Needs you" },
      { id: "verify", level: 3, text: "Verify" },
      { id: "done-today", level: 2, text: "Done today" },
      { id: "09-22", level: 3, text: "09:22" },
      { id: "audit", level: 2, text: "Audit" },
    ]);
  });
});
