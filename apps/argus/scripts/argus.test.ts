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
    env: { ...process.env, ARGUS_ROOT: ws, ARGUS_NO_FETCH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
};

/** as `argus`, but with every ticket-provider credential cleared, for the refusal and dry-run cases that must not depend on the machine's own `.env` */
const argusNoCreds = async (...args: string[]) => {
  const p = Bun.spawn(["bun", join(ROOT, "scripts/argus.ts"), ...args], {
    env: { ...process.env, ARGUS_ROOT: ws, LINEAR_API_KEY: "", TRELLO_API_KEY: "", TRELLO_TOKEN: "" },
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
  test("ticket accepts an AP key exactly as it does an ALD key, in both the proposal and the bare form", async () => {
    const t = await argus("ticket", "admin/invoicing", "P-1", "AP-60");
    expect(t.out).toContain("+ AP-60 ready");
    const bare = await argus("ticket", "admin/invoicing", "AP-77", "--title", "from Ask");
    expect(bare.out).toContain("+ AP-77 ready");
    const sent = await argus("sent", "admin/invoicing", "AP-77", "--repo", "alden-portal-fe", "--json");
    expect(JSON.parse(sent.out)).toMatchObject({ ok: true, wrote: true });
    const unknownTeam = await argus("ticket", "admin/invoicing", "XYZ-1", "--title", "nope");
    expect(unknownTeam.code).toBe(1);
    expect(unknownTeam.err).toContain("usage: argus ticket");
  });
  test("tracker: a missing key or sub-verb is a usage error", async () => {
    const noSub = await argus("tracker");
    expect(noSub.code).toBe(1);
    expect(noSub.err).toContain("usage: argus tracker");
    const noKey = await argus("tracker", "show");
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("usage: argus tracker");
  });
  test("tracker create/edit: missing required flags are usage errors", async () => {
    const noTitle = await argus("tracker", "create", "--team", "AP");
    expect(noTitle.code).toBe(1);
    expect(noTitle.err).toContain("usage: argus tracker");
    const noTeam = await argus("tracker", "create", "--title", "t");
    expect(noTeam.code).toBe(1);
    expect(noTeam.err).toContain("usage: argus tracker");
    const noKey = await argus("tracker", "edit");
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("usage: argus tracker");
  });
  test("tracker create/edit: --dry-run needs no credential and prints the plan without calling a provider", async () => {
    const create = await argusNoCreds("tracker", "create", "--title", "New thing", "--team", "AP", "--parent", "AP-1", "--dry-run");
    expect(create.code).toBe(0);
    expect(create.out).toContain("would create on AP: New thing");
    expect(create.out).toContain("under AP-1");
    const edit = await argusNoCreds("tracker", "edit", "CTD-1", "--title", "New title", "--dry-run");
    expect(edit.code).toBe(0);
    expect(edit.out).toContain("would edit CTD-1");
    expect(edit.out).toContain("title=New title");
  });
  test("tracker create/edit: a missing credential is refused, naming the variable (AC2)", async () => {
    const create = await argusNoCreds("tracker", "create", "--title", "t", "--team", "AP");
    expect(create.code).toBe(1);
    expect(create.err).toContain("TRELLO_API_KEY");
    const edit = await argusNoCreds("tracker", "edit", "CTD-1", "--title", "t");
    expect(edit.code).toBe(1);
    expect(edit.err).toContain("LINEAR_API_KEY");
  });
  test("dismiss needs an unplaced list too", async () => {
    const r = await argus("dismiss", "123");
    expect(r.code).toBe(1);
    expect(r.err).toContain("not in the unplaced list");
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
  test("patch marks every recorded deploy told, since the reader's prompt carried them", async () => {
    const path = join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json");
    const l = await Bun.file(path).json();
    l.landings[0].deployed = { result: "SUCCESSFUL", at: "2026-09-11T09:30:00Z", build: 2142, url: "u", told: false };
    writeFileSync(path, JSON.stringify(l));
    const f = join(ws, "patch.json");
    writeFileSync(f, '{ "summary": "Sam\'s credit email fix is live on dev." }');
    expect((await argus("patch", "admin/invoicing", f)).code).toBe(0);
    expect((await Bun.file(path).json()).landings[0].deployed.told).toBe(true);
  });
  test("prompt ground lists the proposals whose notes name no file, and prints one's prompt", async () => {
    const list = await argus("prompt", "ground", "--json");
    expect(JSON.parse(list.out).proposals).toEqual([{ feature: "admin/invoicing", id: "P-1" }]);
    const one = await argus("prompt", "ground", "admin/invoicing", "P-1");
    expect(one.code).toBe(0);
    expect(one.out).toContain("# ground — point a proposal's Technical Notes at code");
    expect(one.out).toContain("# The proposal: admin/invoicing P-1");
    expect(one.out).toContain("Payment term on the billing profile");
    expect(one.out).toContain('"update": [ { "id": "P-1"');
    expect((await argus("prompt", "ground", "admin/invoicing", "P-9")).code).toBe(1);
  });
  test("prompt attribute says when nothing is unplaced", async () => {
    const r = await argus("prompt", "attribute");
    expect(r.out.trim()).toBe("nothing unplaced");
  });
});

describe("deployed", () => {
  const run = (...args: string[]) => {
    const p = Bun.spawn(["bun", join(ROOT, "scripts/argus.ts"), "deployed", ...args], {
      env: { ...process.env, ARGUS_ROOT: ws, BITBUCKET_CONFIG: join(ws, "no-bb.json"), BE_REPO: ws },
      stdout: "pipe",
      stderr: "pipe",
    });
    return Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]).then(([code, out, err]) => ({ code, out, err }));
  };
  test("answers from the cache by PR ref or sha, and says so when nobody can ask", async () => {
    mkdirSync(join(ws, "state"), { recursive: true });
    const noCache = await run("be#771");
    expect(noCache.code).toBe(1);
    expect(noCache.out.trim()).toBe("be#771: unknown: no Bitbucket credentials");
    writeFileSync(join(ws, "state/deploys.json"), JSON.stringify({ "be@0fa428a1": { result: "SUCCESSFUL", at: "2026-09-16T10:02:11Z", build: 2142, url: "https://bb/2142" } }));
    const byRef = await run("be#771");
    expect(byRef.code).toBe(0);
    expect(byRef.out.trim()).toBe("be#771: deployed to dev 2026-09-16 10:02 UTC, build 2142 https://bb/2142");
    const bySha = await run("0fa428a", "--json");
    expect(JSON.parse(bySha.out)).toMatchObject({ ok: true, ref: "be#771", sha: "0fa428a1", state: "done", deploy: { build: 2142 } });
  });
  test("refuses what is not a backend landing", async () => {
    expect((await run("be#99999")).code).toBe(1);
    expect((await run("nope")).code).toBe(1);
    expect((await run()).code).toBe(1);
  });
});
