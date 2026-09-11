import { describe, expect, test } from "bun:test";
import { parseRules, parseSources, parseStamps, refuse, summaryOf, toRequirements } from "./seed.ts";

const doc = `---
id: admin-invoicings
last_verified: staging@a1e4d8839
last_verified_be: dev@06d27c81
---

# Admin Invoicings

> **TL;DR:** An owner-only workspace where the bookkeeper reviews the day's invoice picture. More words here.

## Business Rules

| # | Rule | Condition | Outcome | Source |
| - | - | - | - | - |
| BR-1 | Invoicing page is owner-only in the UI | \`user.userType\` on \`beforeLoad\` | Redirect | \`src/routes/_authenticated/admin/invoicings.tsx\`, \`src/lib/roles.ts\` (\`hasOwnerOnlyAdminAccess\`) |
| BR-2 | Server accepts studio-lead and above on every invoice endpoint | any request | pass | \`be:src/routers/v1/invoiceRouter.ts\`, \`be:src/middlewares/auth/jwtCheck.ts\` |
| BR-3 | Paid is derived from amounts, **not** just status \\| ever | x | y | \`src/hooks/invoicings/map-all-invoices.ts\` (\`resolveUiStatus\`) |
| BR-4 | Editing a payment moves \`amountPaid\` by a delta because the server does not re-sum | x | y | \`be:src/services/invoiceService.ts\` |
| BR-5 | The register defaults to all time and a date range is opt in and the export follows the range and the filters and the sort and the search too | x | y | \`src/x.ts\` |
| BR-6 | resolveUiStatus() decides the chip | x | y | \`src/x.ts\` |
`;

describe("seed", () => {
  test("parses rows, stamps and sources", () => {
    const rows = parseRules(doc);
    expect(rows.map((r) => r.id)).toEqual(["BR-1", "BR-2", "BR-3", "BR-4", "BR-5", "BR-6"]);
    expect(parseStamps(doc)).toEqual({ fe: "a1e4d8839", be: "06d27c81" });
    expect(parseSources(rows[0]!.source, parseStamps(doc))).toEqual([
      { kind: "file", repo: "fe", sha: "a1e4d8839", path: "src/routes/_authenticated/admin/invoicings.tsx" },
      { kind: "file", repo: "fe", sha: "a1e4d8839", path: "src/lib/roles.ts" },
    ]);
    expect(parseSources(rows[1]!.source, parseStamps(doc))[0]).toMatchObject({ repo: "be", sha: "06d27c81", path: "src/routers/v1/invoiceRouter.ts" });
  });

  test("seeds the clean rows, skips the ones a reader would stumble on, and says why", () => {
    const { requirements, skipped } = toRequirements(parseRules(doc), parseStamps(doc));
    expect(requirements.map((r) => r.text)).toEqual([
      "Invoicing page is owner-only in the UI.",
      "Server accepts studio-lead and above on every invoice endpoint.",
      "Paid is derived from amounts, not just status or ever.",
    ]);
    expect(requirements[0]?.status).toBe("assumed");
    expect(requirements[0]?.evidence).toEqual([{ kind: "assumption", note: "seeded from the product doc's BR-1" }]);
    expect(requirements[0]?.code).toHaveLength(2);
    expect(skipped.map((s) => [s.id, s.why])).toEqual([
      ["BR-4", "explains the mechanism"],
      ["BR-5", "29 words, over the 25-word ceiling"],
      ["BR-6", "names code"],
    ]);
  });

  test("refuse", () => {
    expect(refuse("A closed cycle that used more than its base credits is flagged")).toBeNull();
    expect(refuse("The amountDue guard applies")).toBe("names code");
    expect(refuse("The /admin/usage route is owner-only")).toBeNull();
    expect(refuse("Lives in roles.ts")).toBe("names code");
  });

  test("summary is the TL;DR's first sentence when it fits, else the name", () => {
    expect(summaryOf(doc, "Admin Invoicings")).toBe("An owner-only workspace where the bookkeeper reviews the day's invoice picture.");
    expect(summaryOf("no tldr", "Tasks")).toBe("Tasks.");
  });
});
