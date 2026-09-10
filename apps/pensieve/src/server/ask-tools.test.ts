/**
 * `propose_decision`, retargeted (LIA-162 AC5). It used to answer a verdict on a Needs-you
 * point; it now answers one of the two things a person actually does — a correction on an
 * Unsorted entry, in the four verbs the `ask` skill's Correcting section names, or a send.
 *
 * The point of every test here is the same: the tool writes nothing. It checks a draft
 * against the same functions the pages check theirs against, and answers a proposal or a
 * refusal in those pages' own words.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeDecision } from "./ask-tools.server";
import { writeSendDecision } from "./decisions";
import type { UnsortedItem, Workstream } from "./marauder";
import type { SendSources } from "./send";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pensieve-tools-"));
});
afterEach(() => rm(dir, { force: true, recursive: true }));

const item = (i: Partial<UnsortedItem> = {}): UnsortedItem => ({
  at: "2026-09-09T12:00:00.000Z",
  candidates: [],
  id: "1788949866.296519",
  kind: "slack",
  suggest: "history-asset-editing",
  summary: "Sam asks whether the subtask rows keep their own price",
  ...i,
});

const workstream = (): Workstream => ({
  events: [],
  features: [],
  keys: { people: [], prs: [], threads: [], tickets: ["LIA-133"], vocab: [] },
  milestone: null,
  name: "History asset editing",
  parked: false,
  slug: "history-asset-editing",
  stage: {},
  updated: "2026-09-09",
  wants: [],
});

const correction = { unsorted: async () => [item()] };

const send = (): SendSources => ({
  decisionsDir: dir,
  foundry: async () => ({ configured: true, url: "http://localhost:3777" }),
  issues: async () => [],
  workstreams: async () => [workstream()],
});

const sources = () => ({ correction, send: send() });

describe("AC5 — a correction, in the same three verbs the Unsorted page offers", () => {
  test("attach: the entry's own summary is what the card names", async () => {
    const out = await proposeDecision(
      {
        action: "attach",
        id: "1788949866.296519",
        reason: "Sam is describing the subtask rows",
        slug: "history-subtask-rows",
      },
      {},
      sources()
    );
    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: "attach",
        id: "1788949866.296519",
        slug: "history-subtask-rows",
        subject: "Sam asks whether the subtask rows keep their own price",
      },
    });
  });

  test("new and dismiss carry their argument, and a dismiss without one is refused", async () => {
    expect(
      await proposeDecision(
        { action: "new", id: "1788949866.296519", name: "Subtask pricing" },
        {},
        sources()
      )
    ).toMatchObject({ ok: true, proposal: { name: "Subtask pricing" } });
    const noReason = await proposeDecision(
      { action: "dismiss", id: "1788949866.296519" },
      {},
      sources()
    );
    // The Unsorted page's own sentence, not a second wording of it.
    expect(noReason).toMatchObject({ ok: false });
    expect(!noReason.ok && noReason.error).toContain("say why");
  });

  test("an entry that is not in the queue is refused, with where to find the id", async () => {
    const out = await proposeDecision(
      { action: "attach", id: "made-up", slug: "history-asset-editing" },
      {},
      sources()
    );
    expect(!out.ok && out.error).toContain("workstreams/_unsorted.json");
  });

  test("stage is about a workstream, so it needs no queue entry", async () => {
    expect(
      await proposeDecision(
        {
          action: "stage",
          id: "history-asset-editing",
          side: "fe",
          slug: "history-asset-editing",
          stage: "landed",
        },
        {},
        sources()
      )
    ).toMatchObject({
      ok: true,
      proposal: { action: "stage", stage: "landed" },
    });
  });

  test("an action the file format does not carry is refused by the schema", async () => {
    const out = await proposeDecision(
      { action: "park", id: "1788949866.296519" },
      {},
      sources()
    );
    expect(!out.ok && out.error).toContain("propose_decision:");
  });
});

describe("AC5 — a send, checked the way the workstream page's button is", () => {
  test("a ticket that may go answers a proposal naming its workstream", async () => {
    const out = await proposeDecision(
      { action: "send", ticket: "LIA-133" },
      {},
      sources()
    );
    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: "send",
        slug: "history-asset-editing",
        subject: "History asset editing",
        ticket: "LIA-133",
      },
    });
  });

  test("the repo may still be missing — the card collects it, as the form does", async () => {
    const out = await proposeDecision(
      { action: "send", ticket: "LIA-133" },
      {},
      sources()
    );
    expect(out.ok && "repo" in out.proposal).toBe(false);
  });

  test("a ticket already sent is refused in the page's own words", async () => {
    await writeSendDecision(
      {
        action: "sent",
        at: "2026-09-09T20:00:00.000Z",
        by: "Liam Leung",
        job: { id: "9f1c2d3e", url: "" },
        ticket: "LIA-133",
      },
      dir
    );
    const out = await proposeDecision(
      { action: "send", ticket: "LIA-133" },
      {},
      sources()
    );
    expect(!out.ok && out.error).toContain("already sent");
  });

  test("Foundry unconfigured refuses the proposal, so no card offers a click that cannot land", async () => {
    const out = await proposeDecision(
      { action: "send", ticket: "LIA-133" },
      {},
      {
        correction,
        send: {
          ...send(),
          foundry: async () => ({
            configured: false,
            reason: "FOUNDRY_API_TOKEN is not set",
            url: "http://localhost:3777",
          }),
        },
      }
    );
    expect(!out.ok && out.error).toContain("FOUNDRY_API_TOKEN");
  });

  test("a send naming no ticket is refused", async () => {
    expect(
      await proposeDecision({ action: "send" }, {}, sources())
    ).toMatchObject({ ok: false });
  });
});
