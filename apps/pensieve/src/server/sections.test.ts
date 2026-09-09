import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { dropSection, dropTitle, dropTldr, headingText, outline } from "./sections";

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

describe("dropSection", () => {
  test("removes the section and everything under it, up to the next h2", () => {
    const doc = dropSection(parse(REPORT), "Needs you");
    expect(titles(doc)).toEqual([
      "sweep — 2026-09-07",
      "Done today",
      "09:22",
      "Audit",
    ]);
    const text = JSON.stringify(doc.children);
    expect(text).not.toContain("BR-157");
    expect(text).not.toContain("swagger");
    expect(text).toContain("Digest woke up");
    expect(text).toContain("Tick 19:16");
  });

  test("the outline follows the body", () => {
    const doc = dropSection(parse(REPORT), "Needs you");
    expect(doc.headings?.map((h) => h.text)).toEqual([
      "sweep — 2026-09-07",
      "Done today",
      "09:22",
      "Audit",
    ]);
  });

  test("is case-insensitive on the title", () => {
    expect(titles(dropSection(parse(REPORT), "needs YOU"))).not.toContain(
      "Needs you"
    );
  });

  test("answers the same document when the section is absent", () => {
    const doc = parse(REPORT);
    expect(dropSection(doc, "Linear today")).toBe(doc);
  });

  test("a section at the end of the document is dropped whole", () => {
    const doc = dropSection(parse(REPORT), "Audit");
    expect(titles(doc)).toEqual([
      "sweep — 2026-09-07",
      "Needs you",
      "Verify",
      "Done today",
      "09:22",
    ]);
    expect(JSON.stringify(doc.children)).not.toContain("Clean.");
  });
});

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

describe("dropTldr", () => {
  const WITH_TLDR = `# sweep — 2026-09-07

_Seven landings journaled; nine points need you._

_Tick 19:16 · staging@815a6aa31_

> **TL;DR**
> - Decide: BR-157's read-only rows.
> - Verify: LIA-112's swagger AC.

## Needs you

**Decide**
- **BR-157** — accept, or ticket a fix? · new

## Done today

> **Watch out:** a live break, kept.

### 09:22
- Digest woke up.
`;

  test("removes the TL;DR callout and keeps the summary, the stamp and later blockquotes", () => {
    const doc = dropTldr(parse(WITH_TLDR));
    const text = JSON.stringify(doc.children);
    expect(text).not.toContain("TL;DR");
    expect(text).not.toContain("read-only rows");
    expect(text).toContain("Seven landings journaled");
    expect(text).toContain("Tick 19:16");
    expect(text).toContain("Watch out");
    expect(doc.headings?.map((h) => h.text)).toEqual([
      "sweep — 2026-09-07",
      "Needs you",
      "Done today",
      "09:22",
    ]);
  });

  test("composes with dropSection for the home page", () => {
    const doc = dropTldr(dropSection(parse(WITH_TLDR), "Needs you"));
    const text = JSON.stringify(doc.children);
    expect(text).not.toContain("TL;DR");
    expect(text).not.toContain("BR-157");
    expect(text).toContain("Digest woke up");
  });

  test("answers the same document when there is no TL;DR before the first h2", () => {
    const doc = parse(REPORT);
    expect(dropTldr(doc)).toBe(doc);
    const later = parse("_lede_\n\n## Done today\n\n> **TL;DR** not at the top\n");
    expect(dropTldr(later)).toBe(later);
  });

  test("leaves a leading blockquote that is not a TL;DR alone", () => {
    const doc = parse("_lede_\n\n> **Watch out:** first\n\n## Done today\n");
    expect(dropTldr(doc)).toBe(doc);
  });
});
