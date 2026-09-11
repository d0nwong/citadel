/**
 * The CLI as a subprocess against a temp workspace: usage and exit codes, `validate`
 * over a directory of features, `write` with `--dry-run`, `--json` and a refusal.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./argus.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const FIX = join(ROOT, "evals/fixtures/ledger");
let ws: string;

const argus = async (...args: string[]) => {
  const p = Bun.spawn(["bun", join(ROOT, "scripts/argus.ts"), ...args], {
    env: { ...process.env, ARGUS_ROOT: ws },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
};

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-cli-"));
  for (const f of ["tasks", "admin/invoicing", "admin/usage"]) mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
  cpSync(join(FIX, "valid.json"), join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("parseArgs", () => {
  test("flags, options and positionals", () => {
    expect(parseArgs(["a", "--dry-run", "--reason", "why", "b", "--json", "--repo=fe", "--user"])).toEqual({
      dryRun: true,
      json: true,
      actor: "user",
      rest: ["a", "b"],
      opts: { reason: "why", repo: "fe" },
    });
  });
});

describe("argus", () => {
  test("no verb prints usage and exits 1; --help exits 0", async () => {
    const none = await argus();
    expect(none.code).toBe(1);
    expect(none.out).toContain("argus validate");
    expect((await argus("--help")).code).toBe(0);
    const bad = await argus("frobnicate");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('unknown verb "frobnicate"');
  });

  test("validate walks every feature, nested ones included, and checks the arch cap", async () => {
    const ok = await argus("validate");
    expect(ok.code).toBe(0);
    expect(ok.out.trim()).toBe("3 features valid");
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/docs/arch.md"), "x\n".repeat(251));
    const long = await argus("validate", "--json");
    expect(long.code).toBe(1);
    const j = JSON.parse(long.out);
    expect(j.ok).toBe(false);
    expect(j.problems[0].feature).toBe("tasks");
    expect(j.problems[0].rule).toContain("over the 250-line cap");
  });

  test("validate names a broken ledger by feature and path", async () => {
    cpSync(join(FIX, "missing-evidence.json"), join(ws, "alden/alden-portal/features/admin/usage/ledger.json"));
    const r = await argus("validate", "admin/usage");
    expect(r.code).toBe(1);
    expect(r.err).toContain("admin/usage: ledger.requirements[0].evidence: no evidence");
    expect((await argus("validate", "nope")).err).toContain("not a feature directory");
  });

  test("write from a file, dry-run first, then for real, then unchanged", async () => {
    const dry = await argus("write", "tasks", join(FIX, "valid.json"), "--dry-run");
    expect(dry.code).toBe(1);
    expect(dry.err).toContain('says feature "admin/invoicing"');
    const next = JSON.parse(await Bun.file(join(FIX, "valid.json")).text());
    next.feature = "tasks";
    const f = join(ws, "next.json");
    writeFileSync(f, JSON.stringify(next));
    const preview = await argus("write", "tasks", f, "--dry-run", "--json");
    expect(preview.code).toBe(0);
    expect(JSON.parse(preview.out)).toMatchObject({ ok: true, wrote: false });
    expect(await Bun.file(join(ws, "alden/alden-portal/features/tasks/ledger.json")).exists()).toBe(false);
    const real = await argus("write", "tasks", f);
    expect(real.code).toBe(0);
    expect(real.out).toContain("tasks: wrote");
    expect(real.out).toContain("new ledger");
    const again = await argus("write", "tasks", f, "--json");
    expect(JSON.parse(again.out)).toEqual({ ok: true, wrote: false, path: join(ws, "alden/alden-portal/features/tasks/ledger.json"), diff: [] });
  });

  test("write from stdin, and a refusal lists the problems", async () => {
    const bad = JSON.parse(await Bun.file(join(FIX, "missing-evidence.json")).text());
    const p = Bun.spawn(["bun", join(ROOT, "scripts/argus.ts"), "write", "admin/invoicing", "-", "--json"], {
      env: { ...process.env, ARGUS_ROOT: ws },
      stdin: new Response(JSON.stringify(bad)),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(p.stdout).text();
    expect(await p.exited).toBe(1);
    expect(JSON.parse(out)).toEqual({ ok: false, problems: [{ path: "ledger.requirements[0].evidence", rule: "no evidence; every claim carries at least one pointer" }] });
    const show = await argus("show", "admin/invoicing");
    expect(JSON.parse(show.out).requirements[0].evidence).toHaveLength(1);
  });
});

describe("click verbs through the CLI", () => {
  test("close, confirm and ticket answer json; a missing reason is a usage error", async () => {
    const c = await argus("close", "admin/invoicing", "A-2", "--reason", "done in standup", "--json");
    expect(JSON.parse(c.out)).toMatchObject({ ok: true, wrote: true, diff: ["A-2 asked → closed"] });
    const noReason = await argus("close", "admin/invoicing", "A-2");
    expect(noReason.code).toBe(1);
    expect(noReason.err).toContain("usage: argus close");
    const all = await argus("confirm", "admin/invoicing", "--all", "--reason", "bulk", "--json");
    expect(JSON.parse(all.out).diff).toEqual(["R-3 assumed → confirmed"]);
    const t = await argus("ticket", "admin/invoicing", "P-1", "ALD-60");
    expect(t.out).toContain("+ ALD-60 ready");
  });
  test("place needs an unplaced list", async () => {
    const r = await argus("place", "123", "tasks");
    expect(r.code).toBe(1);
    expect(r.err).toContain("not in the unplaced list");
  });
});

describe("patch and prompt", () => {
  test("patch applies a fenced reader reply and reports the diff; a bad field is refused by path", async () => {
    const f = join(ws, "patch.md");
    writeFileSync(f, 'Here you go:\n```json\n{ "asks": { "update": [ { "id": "A-2", "status": "answered", "at": "2026-09-11", "evidence": [ { "kind": "slack", "url": "https://alden-studios.slack.com/archives/C07KG06L601/p1789300000000000" } ] } ] }, "notes": ["x"] }\n```\n');
    const r = await argus("patch", "admin/invoicing", f, "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).diff).toEqual(["A-2 asked → answered"]);
    writeFileSync(f, '{ "asks": { "remove": ["A-2"] } }');
    const bad = await argus("patch", "admin/invoicing", f);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("patch.asks.remove");
  });
  test("prompt attribute says when nothing is unplaced", async () => {
    const r = await argus("prompt", "attribute");
    expect(r.out.trim()).toBe("nothing unplaced");
  });
});
