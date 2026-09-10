/**
 * ticket-diff.ts — what a tick's events make a ticket say (ARG-159, over features since ARG-164).
 *
 * A Pending bullet matched to a question, a claim and the landing that backs it, a
 * deadline, an ask with no ticket, a ticket Foundry is running, and a second pass that
 * finds nothing left to do. Then the record writes the worker makes once the edits land.
 * What is settled about a feature is its docs' business, so no fact reaches a ticket here.
 *
 *   bun test skills/sweep/scripts/marauder/ticket-diff.test.ts
 */

import { test, expect, describe } from "bun:test";
import { UNVERIFIED, bullets, claimBullet, formatPlan, heldEvent, planTicket, section, type TicketState } from "./ticket-diff.ts";
import { pairPending, recordHeld, recordTicket, resolveQuestion, type State, type Who } from "./correct.ts";
import { validate, type Milestones, type Work, type WorkEvent } from "./record.ts";

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

const ev = (over: Partial<WorkEvent> = {}): WorkEvent => ({
  at: "2026-09-09T18:00:00Z",
  kind: "answers-question",
  summary: "Foong said a Usage row shows the assignee role.",
  source: { type: "slack", ref: "1789000000.1" },
  attached: { how: "thread", confidence: "certain" },
  ticket: "ALD-24",
  ...over,
});

const w = (over: Partial<Work> = {}): Work => ({
  feature: "admin/usage",
  keys: { tickets: ["ALD-24"], prs: [], threads: [], vocab: [] },
  open_questions: [{ q: "Which roles should a Usage row show?", asked_by: "sweep", at: "2026-09-09", ticket: "ALD-24", pending_ref: "- Which roles show on a Usage row? Foong has not said." }],
  events: [],
  updated: "2026-09-09",
  ...over,
});

const plan = (work: Work, events: WorkEvent[], t = ticket()) =>
  planTicket({ work, ticket: t, events, milestones: MILESTONES });

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
    const state: State = { work: [w({ events: [answered] })], unsorted: [], milestones: MILESTONES, features: [] };
    const after = resolveQuestion(state, "admin/usage", "Which roles", "ALD-24", WHO).state;
    const body = BODY.replace("- Which roles show on a Usage row? Foong has not said.\n", "");
    expect(plan(after.work[0]!, [answered], ticket({ body })).edits).toEqual([]);
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

describe("deadlines and asks", () => {
  test("a deadline sets the due date and nothing else", () => {
    const d = ev({ kind: "deadline", summary: "Foong launches tomorrow.", ticket: undefined });
    const p = plan(w({ milestone: "launch-2026-09-10", events: [d] }), [d]);
    expect(p.edits).toEqual([{ kind: "due-date", value: "2026-09-10", why: "Foong launches tomorrow." }]);
  });

  test("an ask with no ticket anywhere on the record is one to file, titled in its own words", () => {
    const ask = ev({ kind: "new-ask", summary: "Sam asked for a client column.", ticket: undefined, source: { type: "slack", ref: "1789000000.9", url: "https://slack/x" } });
    const p = plan(w({ keys: { ...w().keys, tickets: [] }, events: [ask] }), [ask]);
    expect(p.fileAsks).toEqual([{ id: "1789000000.9", title: "Sam asked for a client column", permalink: "https://slack/x" }]);
  });

  test("an ask on a record that already has a ticket files nothing", () => {
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
    const state: State = { work: [w()], unsorted: [], milestones: MILESTONES, features: [] };
    const { state: next, changed } = recordHeld(state, "admin/usage", heldEvent(p, WHO.at));
    expect(changed).toBe(true);
    const e = next.work[0]!.events.at(-1)!;
    expect(e.kind).toBe("directed-at-person");
    expect(e.to).toEqual(["you"]);
    expect(e.action).toContain("delete-pending");
    expect(validate(next.work[0]!, "admin/usage")).toEqual([]);
    expect(recordHeld(next, "admin/usage", heldEvent(p, WHO.at)).changed).toBe(false);
  });
});

describe("what the worker writes back", () => {
  const state = (over: Partial<State> = {}): State => ({ work: [w()], unsorted: [], milestones: MILESTONES, features: [], ...over });

  test("a pairing is recorded once", () => {
    const unpaired = state({ work: [w({ open_questions: [{ ...w().open_questions[0]!, pending_ref: undefined }] })] });
    const once = pairPending(unpaired, "admin/usage", "Which roles", "- Which roles show on a Usage row? Foong has not said.");
    expect(once.changed).toBe(true);
    expect(pairPending(once.state, "admin/usage", "Which roles", "- Which roles show on a Usage row? Foong has not said.").changed).toBe(false);
  });

  test("answering drops the question and stamps the event that answered it", () => {
    const answered = ev();
    const { state: next } = resolveQuestion(state({ work: [w({ events: [answered] })] }), "admin/usage", "Which roles", "ALD-24", WHO);
    expect(next.work[0]!.open_questions).toEqual([]);
    expect(next.work[0]!.events.at(-1)!.action).toBe("pending deleted on ALD-24");
  });

  test("a filed ticket lands on the ask and on the keys, once", () => {
    const ask = ev({ kind: "new-ask", ticket: undefined, source: { type: "slack", ref: "1789000000.9" } });
    const fresh = state({ work: [w({ keys: { ...w().keys, tickets: [] }, events: [ask] })] });
    const { state: next, changed } = recordTicket(fresh, "admin/usage", "1789000000.9", "ARG-163");
    expect(changed).toBe(true);
    expect(next.work[0]!.keys.tickets).toEqual(["ARG-163"]);
    expect(next.work[0]!.events[0]!.ticket).toBe("ARG-163");
    expect(recordTicket(next, "admin/usage", "1789000000.9", "ARG-163").changed).toBe(false);
  });

  test("a feature with nothing going on has nothing to write back to", () => {
    expect(recordTicket(state({ work: [] }), "tasks", "x", "ARG-1").notes[0]).toContain("has nothing going on");
  });
});
