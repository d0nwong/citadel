/**
 * ticket-diff.ts — what a tick's events make a ticket say (ARG-159).
 *
 * The cases are the ticket's AC6: a Pending bullet matched to a question, a fact already
 * in the body, a fact that names what a Scope sentence names, a ticket Foundry is running,
 * and a second pass that finds nothing left to do. Then the record writes the worker makes
 * once the edits land.
 *
 *   bun test skills/sweep/scripts/marauder/ticket-diff.test.ts
 */

import { test, expect, describe } from "bun:test";
import { UNVERIFIED, bullets, claimBullet, formatPlan, heldEvent, planTicket, section, type TicketState } from "./ticket-diff.ts";
import { pairPending, recordHeld, recordTicket, resolveQuestion, type State, type Who } from "./correct.ts";
import { validate, type Milestones, type Workstream, type WorkstreamEvent } from "./record.ts";

const WHO: Who = { by: "Liam Leung", at: "2026-09-09T18:00:00Z" };
const MILESTONES: Milestones = { "launch-2026-09-10": { name: "Launch", date: "2026-09-10", owner: "Foong Leung" } };

const BODY = `## Summary

Show the role behind each Usage row.

## Background

Foong asked for it in the huddle.

## Scope / Out of Scope

In scope: render \`roleName\` on each task row of the Usage Active tab.

## Pending

- Which roles show on a Usage row? Foong has not said.

## Technical Notes

* \`use-usage-rows.ts\` maps the payload.
`;

const ticket = (over: Partial<TicketState> = {}): TicketState => ({ key: "ALD-24", body: BODY, state: "Backlog", hasJob: false, ...over });

const ev = (over: Partial<WorkstreamEvent> = {}): WorkstreamEvent => ({
  at: "2026-09-09T18:00:00Z",
  kind: "answers-question",
  summary: "Foong said a Usage row shows the assignee role.",
  source: { type: "slack", ref: "1789000000.1" },
  attached: { how: "thread", confidence: "certain" },
  ticket: "ALD-24",
  ...over,
});

const w = (over: Partial<Workstream> = {}): Workstream => ({
  slug: "usage-roles-on-rows",
  name: "Usage: the role behind each task and subtask row",
  features: ["admin/usage"],
  wants: [],
  done: "Every Usage row names the role doing the work.",
  stage: { fe: "asked" },
  overlay: null,
  parked: false,
  milestone: null,
  keys: { tickets: ["ALD-24"], prs: [], threads: [], vocab: [], people: [] },
  open_questions: [{ q: "Which roles should a Usage row show?", asked_by: "sweep", at: "2026-09-09", ticket: "ALD-24", pending_ref: "- Which roles show on a Usage row? Foong has not said." }],
  facts: [],
  events: [],
  opened: "2026-09-09",
  updated: "2026-09-09",
  ...over,
});

const plan = (workstream: Workstream, events: WorkstreamEvent[], t = ticket()) =>
  planTicket({ workstream, ticket: t, events, milestones: MILESTONES });

describe("reading the body", () => {
  test("a section is what sits under its heading and nothing else", () => {
    expect(bullets(section(BODY, "Pending"))).toEqual(["- Which roles show on a Usage row? Foong has not said."]);
    expect(section(BODY, "Technical Notes").join(" ")).toContain("use-usage-rows.ts");
    expect(section(BODY, "Nowhere")).toEqual([]);
  });
});

describe("an answered question", () => {
  const answered = ev();

  test("deletes the bullet it was waiting on and leaves the answer in Technical Notes", () => {
    const p = plan(w({ events: [answered] }), [answered]);
    expect(p.edits).toEqual([
      { kind: "delete-pending", old_string: "- Which roles show on a Usage row? Foong has not said.", why: "Foong said a Usage row shows the assignee role. answers it" },
      { kind: "add-note", text: "Foong said a Usage row shows the assignee role.", why: 'the answer to "Which roles should a Usage row show?"' },
    ]);
    expect(p.resolves).toEqual(["Which roles should a Usage row show?"]);
  });

  test("a question nobody paired with a bullet is a person's job, not an edit", () => {
    const unpaired = w({ open_questions: [{ ...w().open_questions[0]!, pending_ref: undefined }], events: [answered] });
    const p = plan(unpaired, [answered]);
    expect(p.edits).toEqual([]);
    expect(p.unpaired).toHaveLength(1);
    expect(p.flags[0]!.why).toContain("no Pending bullet is paired");
  });

  test("once the question is off the record, a second pass finds nothing", () => {
    const state: State = { workstreams: [w({ events: [answered] })], unsorted: [], milestones: MILESTONES };
    const after = resolveQuestion(state, "usage-roles-on-rows", "Which roles", "ALD-24", WHO).state;
    const body = BODY.replace("- Which roles show on a Usage row? Foong has not said.\n", "");
    expect(plan(after.workstreams[0]!, [answered], ticket({ body })).edits).toEqual([]);
  });
});

describe("a claim and the landing that backs it", () => {
  const claim = ev({ kind: "contract-change", side: "fe", summary: "Sam said the rows now carry roleName", ticket: undefined });

  test("an unbacked claim adds a Pending bullet saying so", () => {
    const p = plan(w({ events: [claim] }), [claim]);
    expect(p.edits).toContainEqual({ kind: "add-pending", text: claimBullet(claim), why: "nothing on the base branch backs it yet" });
    expect(claimBullet(claim)).toContain(UNVERIFIED);
  });

  test("a claim already in Pending is not added twice", () => {
    const body = BODY.replace("## Technical Notes", `${claimBullet(claim)}\n\n## Technical Notes`);
    expect(plan(w({ events: [claim] }), [claim], ticket({ body })).edits).toEqual([]);
  });

  test("a landing on the same side clears the bullet and writes the fact in", () => {
    const landing = ev({ kind: "verified-landing", side: "fe", at: "2026-09-09T19:00:00Z", summary: "You landed the role column.", source: { type: "pr", ref: "fe#420" }, ticket: undefined });
    const body = BODY.replace("## Technical Notes", `${claimBullet(claim)}\n\n## Technical Notes`);
    const p = plan(w({ events: [claim, landing] }), [claim], ticket({ body }));
    expect(p.edits).toContainEqual({ kind: "delete-pending", old_string: claimBullet(claim), why: "a landing on the base branch backs it now" });
    expect(p.edits).toContainEqual({ kind: "add-note", text: claim.summary, why: "verified against the base branch" });
  });
});

describe("facts", () => {
  test("a fact the body already says is not written again", () => {
    const f = w({ facts: [{ fact: "use-usage-rows.ts maps the payload." }] });
    expect(plan(f, []).edits).toEqual([]);
  });

  test("a fact naming what a Scope sentence names is a question for a person", () => {
    const f = w({ facts: [{ fact: "The rows publish `assigneeRoleName`, not `roleName`." }] });
    const p = plan(f, []);
    expect(p.edits).toEqual([]);
    expect(p.flags[0]!.why).toContain("is the sentence still true?");
    expect(p.flags[0]!.detail).toContain("render");
  });

  test("a settled fact the body is silent about goes into Technical Notes", () => {
    const f = w({ facts: [{ fact: "A role is resolved from the assignee at reset time." }] });
    expect(plan(f, []).edits).toEqual([{ kind: "add-note", text: "A role is resolved from the assignee at reset time.", why: "settled, and the body does not say it" }]);
  });
});

describe("deadlines and asks", () => {
  test("a deadline sets the due date and nothing else", () => {
    const d = ev({ kind: "deadline", summary: "Foong launches tomorrow.", ticket: undefined });
    const p = plan(w({ milestone: "launch-2026-09-10", events: [d] }), [d]);
    expect(p.edits).toEqual([{ kind: "due-date", value: "2026-09-10", why: "Foong launches tomorrow." }]);
  });

  test("an ask with no ticket anywhere on the workstream is one to file", () => {
    const ask = ev({ kind: "new-ask", summary: "Sam asked for a client column.", ticket: undefined, source: { type: "slack", ref: "1789000000.9", url: "https://slack/x" } });
    const p = plan(w({ keys: { ...w().keys, tickets: [] }, events: [ask] }), [ask]);
    expect(p.fileAsks).toEqual([{ id: "1789000000.9", title: w().name, permalink: "https://slack/x" }]);
  });

  test("an ask on a workstream that already has a ticket files nothing", () => {
    const ask = ev({ kind: "new-ask", ticket: undefined });
    expect(plan(w({ events: [ask] }), [ask]).fileAsks).toEqual([]);
  });
});

describe("a ticket Foundry is running", () => {
  const answered = ev();

  test("the plan is computed, marked held, and nothing is applied", () => {
    const p = plan(w({ events: [answered] }), [answered], ticket({ state: "In Progress", hasJob: true }));
    expect(p.inFlight).toBe(true);
    expect(p.edits.length).toBe(2);
    expect(p.flags.some((f) => f.why.includes("being executed"))).toBe(true);
    expect(formatPlan(p)).toContain("held, Foundry is running it");
  });

  test("In Progress without a job is not held — nobody is executing it", () => {
    expect(plan(w({ events: [answered] }), [answered], ticket({ state: "In Progress" })).inFlight).toBe(false);
  });

  test("the diff reaches the reader as an event aimed at them", () => {
    const p = plan(w({ events: [answered] }), [answered], ticket({ state: "In Progress", hasJob: true }));
    const state: State = { workstreams: [w()], unsorted: [], milestones: MILESTONES };
    const { state: next, changed } = recordHeld(state, "usage-roles-on-rows", heldEvent(p, WHO.at));
    expect(changed).toBe(true);
    const e = next.workstreams[0]!.events.at(-1)!;
    expect(e.kind).toBe("directed-at-person");
    expect(e.to).toEqual(["you"]);
    expect(e.action).toContain("delete-pending");
    expect(validate(next.workstreams[0]!, "usage-roles-on-rows")).toEqual([]);
    expect(recordHeld(next, "usage-roles-on-rows", heldEvent(p, WHO.at)).changed).toBe(false);
  });
});

describe("what the worker writes back", () => {
  const state = (over: Partial<State> = {}): State => ({ workstreams: [w()], unsorted: [], milestones: MILESTONES, ...over });

  test("a pairing is recorded once", () => {
    const unpaired = state({ workstreams: [w({ open_questions: [{ ...w().open_questions[0]!, pending_ref: undefined }] })] });
    const once = pairPending(unpaired, "usage-roles-on-rows", "Which roles", "- Which roles show on a Usage row? Foong has not said.");
    expect(once.changed).toBe(true);
    expect(pairPending(once.state, "usage-roles-on-rows", "Which roles", "- Which roles show on a Usage row? Foong has not said.").changed).toBe(false);
  });

  test("answering drops the question and stamps the event that answered it", () => {
    const answered = ev();
    const { state: next } = resolveQuestion(state({ workstreams: [w({ events: [answered] })] }), "usage-roles-on-rows", "Which roles", "ALD-24", WHO);
    expect(next.workstreams[0]!.open_questions).toEqual([]);
    expect(next.workstreams[0]!.events.at(-1)!.action).toBe("pending deleted on ALD-24");
  });

  test("a filed ticket lands on the ask and on the keys, once", () => {
    const ask = ev({ kind: "new-ask", ticket: undefined, source: { type: "slack", ref: "1789000000.9" } });
    const fresh = state({ workstreams: [w({ keys: { ...w().keys, tickets: [] }, events: [ask] })] });
    const { state: next, changed } = recordTicket(fresh, "usage-roles-on-rows", "1789000000.9", "ARG-163");
    expect(changed).toBe(true);
    expect(next.workstreams[0]!.keys.tickets).toEqual(["ARG-163"]);
    expect(next.workstreams[0]!.events[0]!.ticket).toBe("ARG-163");
    expect(recordTicket(next, "usage-roles-on-rows", "1789000000.9", "ARG-163").changed).toBe(false);
  });
});
