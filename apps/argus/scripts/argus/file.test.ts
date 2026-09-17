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
  test("the draft carries the proposal's title and body, and the Alden board's destination", async () => {
    const d = await draftFor("admin/invoicing", "P-1");
    expect(d).toMatchObject({ provider: "trello", board: "Alden SWE Ticketing System", list: "Pipeline", label: "Admin - Invoicing", title: "[FE] Payment term on the billing profile", asks: ["A-2"] });
    expect(d.assignee).toBeUndefined();
    expect(d.body.startsWith("## Summary")).toBe(true);
    // the fixture's body has no Technical Notes: the grounding step has not run
    expect(d.grounded).toBe(false);
  });
  test("an unknown proposal is refused", async () => {
    await expect(draftFor("admin/invoicing", "P-9")).rejects.toThrow("no proposal P-9");
  });
});

describe("a draft from an ask", () => {
  test("carries the proposal covering the ask, refused when the ask already has a ticket", async () => {
    const d = await draftForAsk("admin/invoicing", "A-2");
    expect(d).toMatchObject({ proposal: "A-2", title: "[FE] Payment term on the billing profile", asks: ["A-2"] });
    expect(d.body.startsWith("## Summary")).toBe(true);
    await expect(draftForAsk("admin/invoicing", "A-1")).rejects.toThrow("already has ALD-41");
  });
  test("an ask no proposal covers is refused rather than filed as a stub", async () => {
    const path = join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json");
    await Bun.write(path, JSON.stringify({ ...(await Bun.file(path).json()), proposals: [] }));
    await expect(draftForAsk("admin/invoicing", "A-2")).rejects.toThrow("A-2 has no proposal yet");
  });
});
