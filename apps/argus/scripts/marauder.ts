#!/usr/bin/env bun
/**
 * marauder — the map of the work (ARG-155, over features since ARG-164).
 *
 * `accio` summons the API surface. `marauder` says where the work stands: one `work.json`
 * per feature that has something going on, beside that feature's docs and journal, and
 * the pages a person reads rendered from those records and nothing else.
 *
 *   marauder ingest --landings        merges on the base branches become events
 *   marauder ingest --slack           what the channel said becomes events
 *   marauder huddle <ts> --points     a huddle's key points, as the sweep read them, onto the record
 *   marauder attach <id> <feature>    move an unsorted item onto a feature, and learn from it
 *   marauder dismiss <id>             drop an unsorted item that goes nowhere
 *   marauder suggest <id> <feature>   leave it unsorted, but say where it probably goes
 *   marauder changed --since <ISO>    which features gained an event, and which
 *   marauder ticket-plan <feature> <ARG-nn> --body <file>
 *                                     what this run's events make that ticket say
 *   marauder board                    what needs you, then each feature that moved this week
 *   marauder show <feature>           one feature's story — the page beside its docs, printed
 *   marauder changelog [day]          what changed in the project that day
 *   marauder render                   the board, today's changelog and every feature's page, which is what a run writes
 *   marauder apply                    the decision files applied now, then render — what Pensieve runs at the click
 *
 * Every verb that writes holds `queue/.lock` for its whole run, so two never interleave.
 *
 * `new`, `split`, `stage`, `check` and `propose-split` went with the workstreams: there is
 * nothing to open, cut or advance when the feature is the unit.
 *
 * Every page is checked against `skills/sweep/style.md`'s three mechanical rules before it
 * is written, and a page that breaks one is never written — the run exits non-zero naming
 * the line. Rendering reads no network, no `.state/`, and no clock beyond `--now`, so a
 * run that changes no record writes no byte.
 */

import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { loadState, saveState, type FeatureRef, type Work } from "../skills/sweep/scripts/marauder/record.ts";
import { appRoots } from "./lib/journal.ts";
import { readStamp } from "./lib/stamps.ts";
import { attach, defaultWho, dismiss, pairPending, recordHeld, recordTicket, resolveQuestion, suggest } from "../skills/sweep/scripts/marauder/correct.ts";
import { apply, formatApplied, readDecisions } from "../skills/sweep/scripts/marauder/decisions.ts";
import { acquire } from "../skills/sweep/scripts/marauder/lock.ts";
import { applyHuddle, readNotes } from "../skills/sweep/scripts/marauder/huddle.ts";
import { formatPlan, heldEvent, planTicket, type TicketPlan } from "../skills/sweep/scripts/marauder/ticket-diff.ts";
import { checkStyle, FEATURE_PAGE, featurePagePath, featureTitle, formatStyleProblems, renderBoard, renderChangelog, renderFeature, OUT_DIR, type FeatureMetas } from "../skills/sweep/scripts/marauder/render.ts";
import { run as ingestLandings, formatChanges } from "../skills/sweep/scripts/marauder/ingest-landings.ts";
import { run as ingestSlack, formatChanges as formatSlackChanges, openList } from "../skills/sweep/scripts/marauder/ingest-slack.ts";

const HELP = `marauder — where the work stands

  marauder ingest --landings        merges on origin/staging and origin/dev become events
  marauder ingest --slack           what the channel said becomes events, or goes to Unsorted
  marauder huddle <ts> --points <file>  record a huddle's key points (read the canvas, write the points, then this)
  marauder attach <id> <feature>    move an unsorted item onto a feature, and learn from it
  marauder suggest <id> <feature>   leave it unsorted, but say where it probably goes
  marauder dismiss <id> --reason "…"  drop an unsorted item that goes nowhere
  marauder changed --since <ISO>    which features gained an event, and which
  marauder ticket-plan <feature> <ARG-nn> --body <file> [--state "In Progress"]
  marauder pending <feature> --question "…" --bullet "…"
  marauder resolved <feature> <ARG-nn> --question "…"
  marauder ticket <feature> <event-id> <ARG-nn>
  marauder held <feature> <ARG-nn>
  marauder board                    marauder/board.md — the one page to read
  marauder show <feature>           <app>/features/<feature>/board.md — one feature's story, printed
  marauder changelog [YYYY-MM-DD]   marauder/changelog/<day>.md — what changed that day, by feature
  marauder render                   the board, today's changelog, and a page beside each feature's docs
  marauder apply                    the decisions Pensieve wrote, applied now, then render

  <feature> is the feature's directory under its app's features/ — admin/usage, tasks.

  --since <day>   ingest from this day instead of the newest landing each side holds
  --points <file> the key points of a huddle, as JSON: { url, points: [{ kind, feature, summary, to, why, text }] }
  --reason "…"    why a correction was made; it is kept on the event the correction writes
  --auto          attach as the sweep's own reading (a guess), not as a person's decision
  --now <ISO>     render as of this instant instead of the clock (tests, back-fills)
  --root <dir>    the workspace root (default: the repo this script is in)
  --dry-run       print what would be written, write nothing

The record is \`<app>/features/<dir>/work.json\`; every page here is rendered from those
alone. If a page needs Slack, Linear or git to draw itself, the record is incomplete and
that is the bug to fix.
`;

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** the verbs the feature record retired, and what to do instead */
const RETIRED: Record<string, string> = {
  new: "there is nothing to open — attach the entry to the feature it is about",
  split: "a feature is not cut in two — each event already says which feature it is on",
  stage: "a feature keeps no stage — the docs say what is true, and Linear where a ticket is",
  check: "a feature cannot stop being one thing, so there is nothing to check",
  "propose-split": "a feature is not cut in two",
};

type Written = { path: string; text: string; changed: boolean };

const need = <T,>(v: T | undefined, what: string): T => {
  if (v === undefined || v === "") throw new Error(`this needs ${what}`);
  return v;
};

async function write(root: string, rel: string, text: string, dryRun: boolean): Promise<Written> {
  const problems = checkStyle(text);
  if (problems.length) throw new Error(`${rel} breaks the style rules\n${formatStyleProblems(rel, problems)}`);
  const path = join(root, rel);
  const changed = (await Bun.file(path).exists()) ? (await Bun.file(path).text()) !== text : true;
  if (changed && !dryRun) {
    await mkdir(join(path, ".."), { recursive: true });
    await Bun.write(path, text);
  }
  return { path: rel, text, changed };
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const dryRun = args.includes("--dry-run");
if (dryRun) args.splice(args.indexOf("--dry-run"), 1);
const now = flag("--now") ?? new Date().toISOString();
const root = flag("--root") ?? ROOT;
const verb = args[0];

if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
  console.log(HELP);
  process.exit(verb ? 0 : 1);
}

if (RETIRED[verb]) {
  console.error(`marauder: ${verb} went with the workstreams — ${RETIRED[verb]}`);
  process.exit(1);
}

const since = flag("--since");

/**
 * The verbs that write take the lock for the whole run, `--dry-run` included — a dry run
 * reads a record another run may be half-way through writing. The read verbs never wait.
 * Every exit path below is a `process.exit`, so the lock goes back from the exit hook.
 */
const WRITERS = ["ingest", "apply", "render", "huddle", "attach", "suggest", "dismiss", "pending", "resolved", "ticket", "held"];
if (WRITERS.includes(verb)) {
  try {
    const release = await acquire(root);
    process.on("exit", release);
    for (const sig of ["SIGINT", "SIGTERM"] as const)
      process.on(sig, () => {
        release();
        process.exit(sig === "SIGINT" ? 130 : 143);
      });
  } catch (err) {
    console.error(`marauder: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * `decisions/marauder/*.json` — what a person decided in Pensieve — applied to the records
 * through the same correction functions the command line goes through (ARG-160 AC4). The
 * files are left where they are: they are the history of who decided what, and the entry
 * leaving the queue is what stops one being applied a second time.
 */
async function applyDecisions(root: string, dryRun: boolean) {
  const { decisions, unreadable } = await readDecisions(root);
  for (const u of unreadable) console.error(`marauder: decisions/${u.file} — ${u.error}`);
  if (!decisions.length) return { applied: 0, written: [] as string[] };
  const before = await loadState(root);
  const { state, changes } = apply(before, decisions);
  if (changes.length) console.error(formatApplied(changes));
  const written = changes.length && !dryRun ? await saveState(root, before, state) : [];
  return { applied: changes.length, written };
}

// ingest reads and writes the records, so it runs before they are loaded to be rendered
if (verb === "ingest") {
  const wantsLandings = args.includes("--landings");
  const wantsSlack = args.includes("--slack");
  if (!wantsLandings && !wantsSlack) {
    console.error("marauder: ingest needs --landings or --slack");
    process.exit(1);
  }
  try {
    let attached = 0;
    let queued = 0;
    const written: string[] = [];
    // The verdicts a person gave in Pensieve, before anything new arrives: a decision names
    // an entry in the queue as it stands now, and ingest is about to change that queue.
    const decided = await applyDecisions(root, dryRun);
    written.push(...decided.written);
    if (wantsLandings) {
      const r = await ingestLandings({ root, since, now, dryRun });
      if (r.changes.length) console.error(formatChanges(r.changes));
      attached += r.changes.filter((c) => c.kind === "attached").length;
      queued += r.changes.filter((c) => c.kind === "unsorted").length;
      written.push(...r.written);
    }
    if (wantsSlack) {
      const r = await ingestSlack({ root, since, dryRun });
      if (r.changes.length) console.error(formatSlackChanges(r.changes));
      attached += r.changes.filter((c) => c.kind === "attached").length;
      queued += r.changes.filter((c) => c.kind === "unsorted").length;
      written.push(...r.written);
      // what a reader needs beside the queue to answer it, in the run that shows the queue
      if (dryRun && queued) console.error(`\nthe features with something going on, for reading the queue against:\n${openList(r.work)}`);
    }
    console.error(
      `marauder: ${decided.applied ? `${decided.applied} decided · ` : ""}${attached} attached · ${queued} left to read · ` +
        `${written.length} file${written.length === 1 ? "" : "s"} written${dryRun ? " · (dry run)" : ""}`,
    );
    process.exit(0);
  } catch (err) {
    console.error(`marauder: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * apply — the decision files, applied and rendered now rather than at the next tick's
 * ingest (ARG-168). Pensieve runs it at the click. Nothing to apply writes no byte.
 */
let decided: { applied: number; written: string[] } | undefined;
if (verb === "apply") {
  try {
    decided = await applyDecisions(root, dryRun);
  } catch (err) {
    console.error(`marauder: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!decided.applied) {
    console.error(`marauder: nothing to apply${dryRun ? " · (dry run)" : ""}`);
    process.exit(0);
  }
  if (dryRun) {
    console.error(`marauder: ${decided.applied} decided · the board and pages would be rendered · (dry run)`);
    process.exit(0);
  }
}

const CORRECTIONS = ["huddle", "attach", "suggest", "dismiss", "pending", "resolved", "ticket", "held"];

/**
 * A `sent` decision naming this ticket means Foundry is executing it. Every group under
 * `decisions/` is scanned, so this reads both the old point-keyed files and
 * `decisions/send/<ticket>.json` — `{ ticket, action: "sent", job }`.
 */
async function sentTickets(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const file of new Bun.Glob("**/*.json").scan({ cwd: join(root, "decisions"), absolute: true, onlyFiles: true })) {
    try {
      const d = (await Bun.file(file).json()) as { action?: string; ticket?: string; subject?: string; job?: unknown };
      if (d.action !== "sent" || !d.job) continue;
      for (const m of `${d.ticket ?? ""} ${d.subject ?? ""}`.matchAll(/\b(?:ARG|ALD)-\d+\b/g)) out.add(m[0]);
    } catch { /* an unreadable decision file is the sweep's audit line, not this verb's */ }
  }
  return out;
}

/** the events a run brought a feature: everything newer than the last render */
const sinceEvents = <E extends { at: string }>(w: { events: E[] }, from?: string) =>
  from ? w.events.filter((e) => e.at >= from) : w.events;

if (verb === "changed" || verb === "ticket-plan" || CORRECTIONS.includes(verb)) {
  try {
    const before = await loadState(root);
    const who = defaultWho(flag("--reason"), now);
    const [, a, b] = args;
    if (verb === "changed") {
      const from = need(since, "--since <ISO>");
      const moved = before.work
        .map((x) => ({ w: x, events: x.events.filter((e) => e.at >= from) }))
        .filter((x) => x.events.length);
      for (const { w: x, events } of moved) {
        console.log(`## ${x.feature}`);
        console.log(`   tickets: ${x.keys.tickets.join(", ") || "none"}`);
        for (const e of events) console.log(`   ${e.kind.padEnd(20)} ${e.at}  ${e.summary}`);
        for (const q of x.open_questions) console.log(`   open question${q.ticket ? ` (${q.ticket})` : ""}: ${q.q}${q.pending_ref ? " [paired]" : ""}`);
        console.log("");
      }
      if (!moved.length) console.log("nothing gained an event in that window.");
      process.exit(0);
    }
    if (verb === "ticket-plan") {
      const w = before.work.find((x) => x.feature === need(a, "a feature"));
      if (!w) throw new Error(`${a} has nothing going on — no work.json`);
      const key = need(b, "a ticket key");
      const plan = planTicket({
        work: w,
        ticket: { key, body: await Bun.file(need(flag("--body"), "--body <file>")).text(), state: flag("--state") ?? "", hasJob: (await sentTickets(root)).has(key) },
        events: sinceEvents(w, flag("--since-event")),
        milestones: before.milestones,
      });
      console.log(args.includes("--json") ? JSON.stringify(plan, null, 2) : formatPlan(plan));
      process.exit(0);
    }
    const result =
      verb === "huddle" ? applyHuddle(before, need(a, "the huddle's Slack ts"), await readNotes(need(flag("--points"), "--points <file>")), who)
      : verb === "attach" ? attach(before, need(a, "an unsorted id"), need(b, "a feature"), { ...who, auto: args.includes("--auto"), kind: flag("--kind") as never })
      : verb === "suggest" ? suggest(before, need(a, "an unsorted id"), need(b, "a feature"))
      : verb === "dismiss" ? dismiss(before, need(a, "an unsorted id"), { ...who, reason: need(who.reason, "--reason") })
      : verb === "pending" ? pairPending(before, need(a, "a feature"), need(flag("--question"), "--question"), need(flag("--bullet"), "--bullet"))
      : verb === "resolved" ? resolveQuestion(before, need(a, "a feature"), need(flag("--question"), "--question"), need(b, "a ticket key"), who)
      : verb === "ticket" ? recordTicket(before, need(a, "a feature"), need(b, "an event id"), need(args[3], "a ticket key"))
      : recordHeld(before, need(a, "a feature"), heldEvent({ ticket: need(b, "a ticket key"), edits: [], flags: [], inFlight: true, unpaired: [], resolves: [], fileAsks: [] } as TicketPlan, now));

    for (const n of result.notes) console.error(`  ${n}`);
    const written = result.changed && !dryRun ? await saveState(root, before, result.state) : [];
    console.error(`marauder: ${result.changed ? "applied" : "nothing to do"} · ${written.length} file${written.length === 1 ? "" : "s"} written${dryRun ? " · (dry run)" : ""}`);
    process.exit(0);
  } catch (err) {
    console.error(`marauder: ${(err as Error).message}`);
    process.exit(1);
  }
}

const { work, milestones, features, problems } = await loadState(root);
for (const p of problems) console.error(`marauder: ${p.file} — ${p.problems.join("; ")}`);

/**
 * What a page says of a feature beyond its record: the manifest's name, its app, and the
 * `last_verified` stamps on its docs. Read here so rendering stays pure.
 */
async function featureMetas(refs: FeatureRef[]): Promise<FeatureMetas> {
  const out: FeatureMetas = {};
  const backend = new Map<string, boolean>();
  for (const f of refs) {
    if (!backend.has(f.app)) {
      const m = Bun.file(join(root, f.app, ".doc-workspace/feature-manifest.json"));
      backend.set(f.app, (await m.exists()) && Boolean(((await m.json()) as { be_repo?: string }).be_repo));
    }
    const docs = join(root, f.app, "features", f.feature, "docs");
    const read = async (name: string) => ((await Bun.file(join(docs, name)).exists()) ? await Bun.file(join(docs, name)).text() : null);
    const [product, arch] = [await read("product.md"), await read("arch.md")];
    const stamp = (key: string) => {
      const s = readStamp(product, key) ?? readStamp(arch, key);
      return s ? { rev: s.rev, ...(s.date ? { date: s.date } : {}) } : undefined;
    };
    out[f.feature] = {
      app: f.app,
      ...(f.name ? { name: f.name } : {}),
      docs: { product: product !== null, arch: arch !== null, fe: stamp("last_verified"), be: stamp("last_verified_be") },
      hasBackend: backend.get(f.app),
    };
  }
  return out;
}

const meta = await featureMetas(features.filter((f) => work.some((w) => w.feature === f.feature)));
const pageOf = (w: Work) => featurePagePath(meta[w.feature]?.app ?? need(undefined, `an app holding ${w.feature}`), w.feature);

const board = () => write(root, join(OUT_DIR, "board.md"), renderBoard({ work, milestones, now, meta }), dryRun);
const changelog = (day: string) => write(root, join(OUT_DIR, "changelog", `${day}.md`), renderChangelog(work, day, meta), dryRun);
const featurePage = (w: Work) => write(root, pageOf(w), renderFeature(w, milestones, now, meta), dryRun);

/** a feature page left by an earlier run for a feature that no longer has a `work.json` */
async function stalePages(): Promise<string[]> {
  const keep = new Set(work.map(pageOf));
  const out: string[] = [];
  for (const { app, dir } of await appRoots(root))
    for await (const f of new Bun.Glob(`**/${FEATURE_PAGE}`).scan({ cwd: dir, onlyFiles: true })) {
      const rel = `${app}/features/${f}`;
      if (!keep.has(rel)) out.push(rel);
    }
  return out.sort();
}

try {
  const written: Written[] = [];
  const removed: string[] = [];
  if (verb === "board") written.push(await board());
  else if (verb === "show") {
    const feature = args[1];
    const w = work.find((x) => x.feature === feature);
    if (!w) {
      const known = features.some((f) => f.feature === feature);
      throw new Error(
        `${feature ?? "(none named)"} ${known ? "has nothing going on — no work.json" : "is not a feature; the unit is the feature, its directory under features/"}` +
          `\n  features with work: ${work.map((x) => x.feature).sort().join(", ")}`,
      );
    }
    const text = renderFeature(w, milestones, now, meta);
    const bad = checkStyle(text);
    if (bad.length) throw new Error(`${featureTitle(w.feature, meta)} breaks the style rules\n${formatStyleProblems(pageOf(w), bad)}`);
    process.stdout.write(text);
    process.exit(problems.length ? 1 : 0);
  } else if (verb === "changelog") written.push(await changelog(args[1] ?? now.slice(0, 10)));
  else if (verb === "render" || verb === "apply") {
    written.push(await board());
    written.push(await changelog(now.slice(0, 10)));
    for (const w of work) written.push(await featurePage(w));
    for (const rel of await stalePages()) {
      if (!dryRun) await rm(join(root, rel));
      removed.push(rel);
    }
  } else throw new Error(`no verb ${verb}\n${HELP}`);

  if (verb === "board" || verb === "changelog") process.stdout.write(written[0]!.text);
  const changed = written.filter((w) => w.changed);
  if (decided) {
    const files = decided.written.length + changed.length + removed.length;
    console.error(`marauder: ${decided.applied} decided · ${files} file${files === 1 ? "" : "s"} written`);
    process.exit(problems.length ? 1 : 0);
  }
  console.error(
    `marauder: ${written.length} page${written.length === 1 ? "" : "s"} · ${changed.length} changed` +
      `${changed.length && verb === "render" ? ` (${changed.map((c) => c.path).join(", ")})` : ""}` +
      `${removed.length ? ` · ${removed.length} removed (${removed.join(", ")})` : ""}` +
      `${dryRun ? " · (dry run)" : ""}`,
  );
  process.exit(problems.length ? 1 : 0);
} catch (err) {
  console.error(`marauder: ${(err as Error).message}`);
  process.exit(1);
}
