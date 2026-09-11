import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftFor, draftForAsk, projectNameFor } from "./file.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-file-"));
  process.env.ARGUS_ROOT = ws;
  mkdirSync(join(ws, "alden/alden-portal/features/admin/invoicing/docs"), { recursive: true });
  cpSync(`${FIX}valid.json`, join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(ws, { recursive: true, force: true });
});

describe("file", () => {
  test("project names follow the feature directory", () => {
    expect(projectNameFor("admin/usage")).toBe("Admin - Usage");
    expect(projectNameFor("meetings")).toBe("Meetings");
    expect(projectNameFor("entities-meetings")).toBe("Entities Meetings");
  });
  test("the draft carries the proposal's title and body, the team and the project", async () => {
    const d = await draftFor("admin/invoicing", "P-1");
    expect(d).toMatchObject({ team: "ALD", project: "Admin - Invoicing", title: "[FE] Payment term on the billing profile", asks: ["A-2"] });
    expect(d.body.startsWith("## Summary")).toBe(true);
  });
  test("an unknown proposal is refused", async () => {
    await expect(draftFor("admin/invoicing", "P-9")).rejects.toThrow("no proposal P-9");
  });
});

describe("a draft from an ask", () => {
  test("title from the ask with a tag, body in the house format, refused when the ask already has a ticket", async () => {
    const d = await draftForAsk("admin/invoicing", "A-2");
    expect(d.title).toBe("[FE] Sam asked you and Carlos who takes the front end for his three new billing…");
    expect(d.title.length).toBeLessThanOrEqual(80);
    expect(d.body).toContain("## Summary");
    expect(d.body).toContain("## Acceptance Criteria");
    expect(d.body).toContain("Sam O asked on 2026-09-10");
    expect(d.asks).toEqual(["A-2"]);
    await expect(draftForAsk("admin/invoicing", "A-1")).rejects.toThrow("already has ALD-41");
  });
});
