import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptySeeds } from "../lib/arcs";
import { PROPOSE_ARC } from "../lib/ask-tools";
import type { ArcSources } from "./arcs";
import { checkArcDraft, closeArc, openArc, SEEDS_MAX, TITLE_MAX } from "./arcs";
import { proposeArc, proposeArcTool } from "./ask-tools.server";
import { readArcDecision, readDecisions } from "./decisions";
import type { ArcMeta, JournalEntry } from "./workspace";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pensieve-arcs-"));
});
afterEach(() => rm(dir, { force: true, recursive: true }));

/** Every `decisions/**\/*.json` written, by path, so "wrote nothing" is a real assertion. */
const written = async (): Promise<string[]> => {
  try {
    return ((await readdir(dir, { recursive: true })) as string[])
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
};

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  affects: [],
  app: "alden",
  date: "2026-09-05",
  feature: "alden/invoicing",
  features: [],
  id: "alden/invoicing/2026-09-05-emails",
  path: "alden/features/invoicing/journal/2026-09-05-emails.md",
  slug: "2026-09-05-emails",
  tickets: [],
  ...over,
});

/**
 * The workspace an arc is checked against: two journal entries carrying between them a
 * ticket, a rule, a PR and a feature, and Linear answering with one open issue.
 */
const sources = (over: Partial<ArcSources> = {}): ArcSources => ({
  apps: () =>
    Promise.resolve([
      { app: "alden", dir: "/tmp/alden/features" },
      { app: "pensieve", dir: "/tmp/pensieve/features" },
    ]),
  arcs: () => Promise.resolve([] as ArcMeta[]),
  decisionsDir: dir,
  journal: () =>
    Promise.resolve([
      entry({
        affects: ["BR-22h"],
        features: ["invoicing"],
        pr: "alden-portal-fe#412",
        tickets: ["LIA-133"],
      }),
      entry({
        app: "pensieve",
        feature: "pensieve/ask",
        id: "pensieve/ask/2026-09-06-cards",
        slug: "2026-09-06-cards",
      }),
    ]),
  tickets: () => Promise.resolve(["LIA-133", "LIA-140"]),
  ...over,
});

const arc = (over: Partial<ArcMeta> = {}): ArcMeta => ({
  opened: "2026-09-01",
  path: "arcs/invoice-emails.md",
  seeds: emptySeeds(),
  slug: "invoice-emails",
  status: "open",
  title: "Invoice emails",
  updated: "2026-09-01",
  ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  seeds: { tickets: ["LIA-133"] },
  slug: "invoice-emails",
  title: "Invoice emails",
  ...over,
});

const refuse = async (over: Record<string, unknown>, src = sources()) => {
  const r = await checkArcDraft(draft(over), src);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
};

describe("AC3 — the draft is checked, and a refusal says why", () => {
  test("a free slug with one resolvable seed of each kind passes", async () => {
    const r = await checkArcDraft(
      draft({
        seeds: {
          features: ["alden/invoicing"],
          prs: ["alden-portal-fe#412"],
          rules: ["BR-22h"],
          tickets: ["LIA-133"],
        },
      }),
      sources()
    );
    expect(r).toMatchObject({
      arc: {
        seeds: {
          features: ["alden/invoicing"],
          prs: ["alden-portal-fe#412"],
          rules: ["BR-22h"],
          tickets: ["LIA-133"],
        },
        slug: "invoice-emails",
        verified: true,
      },
      ok: true,
    });
    expect(await written()).toEqual([]);
  });

  test("a slug the sweep has already written is refused, saying where that arc is", async () => {
    const error = await refuse(
      {},
      sources({ arcs: () => Promise.resolve([arc()]) })
    );
    expect(error).toBe(
      "arcs/invoice-emails.md is already there — that arc is open"
    );
  });

  test("a closed arc's slug is refused too — reopening is not a thing", async () => {
    const error = await refuse(
      {},
      sources({ arcs: () => Promise.resolve([arc({ status: "closed" })]) })
    );
    expect(error).toContain("that arc is closed");
  });

  test("a slug with an opened file the sweep has not picked up yet is refused", async () => {
    const first = await openArc(draft(), sources());
    expect(first.ok).toBe(true);
    const error = await refuse({});
    expect(error).toContain(
      "decisions/arc/invoice-emails.json is already there"
    );
    expect(error).toContain("opened");
  });

  test.each([
    ["Invoice Emails", "is not a slug"],
    ["../etc/passwd", "is not a slug"],
    ["invoice--emails", "is not a slug"],
    ["", "the draft has no slug"],
  ])("refuses the slug %j — the point-id rule", async (slug, contains) => {
    expect(await refuse({ slug })).toContain(contains);
  });

  test("no seeds at all is refused — an arc with no keys files nothing", async () => {
    for (const seeds of [{}, undefined, { tickets: [] }, { tickets: ["  "] }]) {
      expect(await refuse({ seeds })).toContain("the draft has no seeds");
    }
  });

  test("a seed of each kind that resolves to nothing is refused, naming the key", async () => {
    expect(await refuse({ seeds: { tickets: ["LIA-999"] } })).toBe(
      'the tickets seed "LIA-999" names no open Liamai ticket and no journal entry — an arc files on keys it can resolve, never on a guess'
    );
    expect(await refuse({ seeds: { rules: ["BR-99"] } })).toContain(
      'the rules seed "BR-99" names no journal entry'
    );
    expect(await refuse({ seeds: { prs: ["alden-portal-fe#1"] } })).toContain(
      'the prs seed "alden-portal-fe#1" names no journal entry'
    );
    expect(await refuse({ seeds: { features: ["billing"] } })).toContain(
      'the features seed "billing" names no feature dir and no journal entry'
    );
    expect(await written()).toEqual([]);
  });

  test("a ticket seed on a closed ticket that a journal entry names still resolves", async () => {
    // The sweep files a landing against an arc by the key its entry carries, whether or
    // not the ticket is still open, so the check has to accept the same key.
    const r = await checkArcDraft(
      draft({ seeds: { tickets: ["LIA-133"] } }),
      sources({ tickets: () => Promise.resolve(["LIA-140"]) })
    );
    expect(r.ok).toBe(true);
  });

  test("with no open-ticket list at all a well-formed key is taken on trust, and said so", async () => {
    const src = sources({ tickets: () => Promise.resolve(null) });
    const r = await checkArcDraft(
      draft({ seeds: { tickets: ["LIA-777"] } }),
      src
    );
    expect(r).toMatchObject({ arc: { verified: false }, ok: true });
    expect(await refuse({ seeds: { tickets: ["nonsense"] } }, src)).toContain(
      'the tickets seed "nonsense"'
    );
  });

  test("the title: present, and a line rather than an essay", async () => {
    expect(await refuse({ title: "  " })).toBe("the draft has no title");
    expect(await refuse({ title: "x".repeat(TITLE_MAX + 1) })).toContain(
      `the title is ${TITLE_MAX + 1} characters`
    );
  });

  test("a catalogue of seeds is refused", async () => {
    const tickets = Array.from({ length: SEEDS_MAX + 1 }, (_, i) => `LIA-${i}`);
    expect(
      await refuse(
        { seeds: { tickets } },
        sources({ tickets: () => Promise.resolve(tickets) })
      )
    ).toContain(`the draft carries ${tickets.length} seeds`);
  });
});

describe("AC1 / AC3 — propose_arc answers a proposal and writes nothing", () => {
  test("an accepted draft carries the slug, title and every seed, and says nothing is written", async () => {
    const out = await proposeArc(
      draft({ seeds: { rules: ["BR-22h"], tickets: ["LIA-133"] } }),
      { threadId: "th1" },
      sources()
    );
    expect(out).toMatchObject({
      ok: true,
      proposal: {
        seeds: {
          features: [],
          prs: [],
          rules: ["BR-22h"],
          tickets: ["LIA-133"],
        },
        slug: "invoice-emails",
        title: "Invoice emails",
        verified: true,
      },
    });
    expect(out.ok === true && out.note).toContain("nothing is written");
    expect(await written()).toEqual([]);
  });

  test("a refusal is the check's own sentence, and no card renders from it", async () => {
    const out = await proposeArc(
      draft({ seeds: { tickets: ["LIA-999"] } }),
      {},
      sources()
    );
    expect(out).toEqual({
      error:
        'the tickets seed "LIA-999" names no open Liamai ticket and no journal entry — an arc files on keys it can resolve, never on a guess',
      ok: false,
    });
    expect(await written()).toEqual([]);
  });

  test("validates its own arguments — the bridge hands execute raw MCP JSON", async () => {
    for (const args of [
      undefined,
      {},
      { slug: "invoice-emails" },
      { seeds: { tickets: "LIA-133" }, slug: "x", title: "T" },
      { seeds: { tickets: [7] }, slug: "x", title: "T" },
    ]) {
      const out = await proposeArc(args, {}, sources());
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.error).toMatch(/^propose_arc: /);
    }
    expect(await written()).toEqual([]);
  });

  test("the tool definition the bridge advertises", () => {
    expect(proposeArcTool.name).toBe(PROPOSE_ARC);
    expect(proposeArcTool.name).toBe("propose_arc");
    expect(Object.keys(proposeArcTool.inputSchema.shape).sort()).toEqual([
      "seeds",
      "slug",
      "title",
    ]);
    // What the model reads: Open writes, this does not.
    expect(proposeArcTool.description).toMatch(/never say the arc exists/i);
    expect(proposeArcTool.description).toMatch(/It writes nothing/);
  });
});

describe("AC2 — Open writes one file, atomically, and only once", () => {
  test("the opened file is the shape the sweep parses", async () => {
    const r = await openArc(
      draft({ seeds: { rules: ["BR-22h"], tickets: ["LIA-133"] } }),
      sources()
    );
    expect(r.ok).toBe(true);
    expect(await written()).toEqual(["arc/invoice-emails.json"]);

    const body = JSON.parse(
      await readFile(join(dir, "arc", "invoice-emails.json"), "utf8")
    );
    expect(body).toEqual({
      action: "opened",
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      point: "arc/invoice-emails",
      seeds: {
        features: [],
        prs: [],
        rules: ["BR-22h"],
        tickets: ["LIA-133"],
      },
      subject: "Invoice emails",
    });
    // `slug` is derived from `point` by every reader, so it never goes on the wire.
    expect("slug" in body).toBe(false);
  });

  test("a second press answers the first file and writes nothing more", async () => {
    const first = await openArc(draft(), sources());
    const at = first.ok ? first.decision.at : "";

    const second = await openArc(draft({ title: "Renamed" }), sources());
    expect(second).toMatchObject({ ok: true, replay: true });
    expect(second.ok === true && second.decision.at).toBe(at);
    expect(second.ok === true && second.decision.subject).toBe(
      "Invoice emails"
    );
    expect(await written()).toEqual(["arc/invoice-emails.json"]);
  });

  test("a draft that no longer checks out is refused at the write, not written", async () => {
    const r = await openArc(
      draft({ seeds: { tickets: ["LIA-999"] } }),
      sources()
    );
    expect(r.ok).toBe(false);
    expect(await written()).toEqual([]);
  });

  test("nothing is created under arcs/ — that file is the sweep's", async () => {
    await openArc(draft(), sources());
    expect(
      ((await readdir(dir, { recursive: true })) as string[]).some((n) =>
        n.startsWith("arcs")
      )
    ).toBe(false);
  });
});

describe("AC4 — Close writes only on an arc that exists and is open", () => {
  const open = () => sources({ arcs: () => Promise.resolve([arc()]) });

  test("an open arc closes, and the file is the same path with the closed action", async () => {
    const r = await closeArc(
      "invoice-emails",
      "shipped and quiet since",
      open()
    );
    expect(r).toMatchObject({ ok: true });
    expect(await written()).toEqual(["arc/invoice-emails.json"]);

    const body = JSON.parse(
      await readFile(join(dir, "arc", "invoice-emails.json"), "utf8")
    );
    expect(body).toMatchObject({
      action: "closed",
      point: "arc/invoice-emails",
      reason: "shipped and quiet since",
      subject: "Invoice emails",
    });
  });

  test("no arcs/<slug>.md, no close — the sweep has not written the arc yet", async () => {
    const r = await closeArc("invoice-emails", "", sources());
    expect(r).toMatchObject({
      error:
        "there is no arcs/invoice-emails.md — the sweep writes it on the tick after the arc is opened",
      ok: false,
    });
    expect(await written()).toEqual([]);
  });

  test("an arc already closed is refused", async () => {
    const r = await closeArc(
      "invoice-emails",
      "",
      sources({ arcs: () => Promise.resolve([arc({ status: "closed" })]) })
    );
    expect(r).toMatchObject({ error: "that arc is already closed", ok: false });
    expect(await written()).toEqual([]);
  });

  test("a second press answers the verdict on disk and writes nothing more (LIA-149 AC3)", async () => {
    const first = await closeArc("invoice-emails", "shipped", open());
    expect(first).toMatchObject({ ok: true });
    const at = first.ok ? first.decision.at : "";

    // The arc file still says `status: open` — the sweep flips it on its next tick — so
    // nothing but the decision already there stops a second close from re-stamping it.
    const again = await closeArc("invoice-emails", "shipped again", open());
    expect(again).toMatchObject({ ok: true, replay: true });
    expect(again.ok && again.decision.at).toBe(at);
    expect(again.ok && again.decision.reason).toBe("shipped");
    expect(await written()).toEqual(["arc/invoice-emails.json"]);
  });

  test("a slug that is not a slug never reaches the writer", async () => {
    const r = await closeArc("../etc/passwd", "", open());
    expect(r).toMatchObject({ ok: false });
    expect(await written()).toEqual([]);
  });

  test("closing writes the arc's own file and touches nothing else", async () => {
    await closeArc("invoice-emails", "", open());
    const closed = await readArcDecision("invoice-emails", dir);
    expect(closed?.action).toBe("closed");
    // AC5: an arc file is not a verdict on a point, so it joins no point and is not
    // reported as a decision that could not be read.
    expect([...(await readDecisions(dir)).keys()]).toEqual([]);
  });
});

describe("AC5 — an arc file is invisible to the points join", () => {
  test("a verdict on a point and an arc file live side by side; only the verdict is a decision", async () => {
    await mkdir(join(dir, "decide"), { recursive: true });
    await writeFile(
      join(dir, "decide", "lia-71.json"),
      JSON.stringify({
        action: "ignored",
        at: "2026-09-06T09:30:00.000Z",
        point: "decide/lia-71",
        reason: "handled elsewhere",
        subject: "S",
      })
    );
    await openArc(draft(), sources());

    expect([...(await readDecisions(dir)).keys()]).toEqual(["decide/lia-71"]);
    expect((await readArcDecision("invoice-emails", dir))?.subject).toBe(
      "Invoice emails"
    );
  });
});
