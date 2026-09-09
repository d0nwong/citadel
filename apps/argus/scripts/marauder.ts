#!/usr/bin/env bun
/**
 * marauder — the map of the work (LIA-155).
 *
 * `accio` summons the API surface. `marauder` says where the work stands: one JSON record
 * per workstream under `workstreams/`, and the pages a person reads rendered from those
 * records and nothing else.
 *
 *   marauder ingest --landings     merges on the base branches become events
 *   marauder ingest --slack        what the channel said becomes events
 *   marauder attach <id> <slug>    move an unsorted item onto a workstream, and learn from it
 *   marauder suggest <id> <slug>   leave it unsorted, but say where it probably goes
 *   marauder new <id> --name "…"   open a workstream from a proposal
 *   marauder split <slug> --into   cut one workstream in two
 *   marauder stage <slug> fe|be    say where a side really is, and why
 *   marauder check                 which workstreams may have stopped being one thing
 *   marauder propose-split <slug>  queue a split for a person to accept
 *   marauder board                 where every open workstream stands, right now
 *   marauder show <slug>           one workstream's story
 *   marauder changelog [day]       what changed in the project that day
 *   marauder render                all three, which is what a tick runs
 *
 * Every page is checked against `skills/sweep/style.md`'s three mechanical rules before it
 * is written, and a page that breaks one is never written — the run exits non-zero naming
 * the line. Rendering reads no network, no `.state/`, and no clock beyond `--now`, so a
 * run that changes no record writes no byte.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  MILESTONES_FILE, UNSORTED_FILE, WORKSTREAMS_DIR,
  loadMilestones, loadWorkstreams, serializeWorkstream,
  type Side, type Stage, type UnsortedItem, type Workstream,
} from "../skills/sweep/scripts/marauder/record.ts";
import { busy, formatCheck } from "../skills/sweep/scripts/marauder/coherence.ts";
import { attach, defaultWho, newFrom, proposeSplit, setStage, split, suggest, type State } from "../skills/sweep/scripts/marauder/correct.ts";
import { checkStyle, formatStyleProblems, renderBoard, renderChangelog, renderWorkstream, OUT_DIR } from "../skills/sweep/scripts/marauder/render.ts";
import { run as ingestLandings, formatChanges } from "../skills/sweep/scripts/marauder/ingest-landings.ts";
import { run as ingestSlack, formatChanges as formatSlackChanges, openList } from "../skills/sweep/scripts/marauder/ingest-slack.ts";

const HELP = `marauder — where the work stands

  marauder ingest --landings        merges on origin/staging and origin/dev become events
  marauder ingest --slack           what the channel said becomes events, or goes to Unsorted
  marauder attach <id> <slug>       move an unsorted item onto a workstream, and learn from it
  marauder suggest <id> <slug>      leave it unsorted, but say where it probably goes
  marauder new <id> --name "…"      open a workstream from a proposal
  marauder split <slug> --into <slug> --name "…" --events <id,…>
  marauder stage <slug> <fe|be> <stage>
  marauder check                    which workstreams may have stopped being one thing
  marauder propose-split <slug> --groups '<json>'
  marauder board                    marauder/board.md — the one page to read
  marauder show <slug>              marauder/<slug>.md — one workstream's story
  marauder changelog [YYYY-MM-DD]   marauder/changelog/<day>.md — what changed that day
  marauder render                   all three

  --since <day>   ingest from this day instead of the newest landing each side holds
  --canvas <file> split these huddle notes (read them with slack_read_file first)
  --reason "…"    why a correction was made; it is kept on the event the correction writes
  --auto          attach as the sweep's own reading (a guess), not as a person's decision
  --now <ISO>     render as of this instant instead of the clock (tests, back-fills)
  --root <dir>    the workspace root (default: the repo this script is in)
  --dry-run       print what would be written, write nothing

The record is \`workstreams/<slug>.json\`; every page here is rendered from it alone. If a
page needs Slack, Linear or git to draw itself, the record is incomplete and that is the
bug to fix.
`;

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

type Written = { path: string; text: string; changed: boolean };

const need = <T,>(v: T | undefined, what: string): T => {
  if (v === undefined || v === "") throw new Error(`this needs ${what}`);
  return v;
};
const list = (v: string | undefined) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

async function loadState(root: string): Promise<State> {
  const { workstreams, milestones } = await loadWorkstreams(root);
  const path = join(root, WORKSTREAMS_DIR, UNSORTED_FILE);
  const unsorted: UnsortedItem[] = (await Bun.file(path).exists()) ? await Bun.file(path).json() : [];
  return { workstreams, unsorted, milestones };
}

/** read-modify-write of the whole of `workstreams/`, so two verbs in one run agree */
async function saveState(root: string, before: State, after: State): Promise<string[]> {
  const written: string[] = [];
  const had = new Map(before.workstreams.map((w) => [w.slug, serializeWorkstream(w)]));
  for (const w of after.workstreams) {
    const text = serializeWorkstream(w);
    if (had.get(w.slug) === text) continue;
    await Bun.write(join(root, WORKSTREAMS_DIR, `${w.slug}.json`), text);
    written.push(`${WORKSTREAMS_DIR}/${w.slug}.json`);
  }
  for (const [file, value, was] of [
    [UNSORTED_FILE, after.unsorted, before.unsorted],
    [MILESTONES_FILE, after.milestones, before.milestones],
  ] as const) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (text === `${JSON.stringify(was, null, 2)}\n`) continue;
    await Bun.write(join(root, WORKSTREAMS_DIR, file), text);
    written.push(`${WORKSTREAMS_DIR}/${file}`);
  }
  return written;
}

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

const since = flag("--since");
const canvas = flag("--canvas");

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
    if (wantsLandings) {
      const r = await ingestLandings({ root, since, now, dryRun });
      if (r.changes.length) console.error(formatChanges(r.changes));
      attached += r.changes.filter((c) => c.kind === "attached").length;
      queued += r.changes.filter((c) => c.kind === "unsorted").length;
      written.push(...r.written);
    }
    if (wantsSlack) {
      const r = await ingestSlack({ root, since, canvas, dryRun });
      if (r.changes.length) console.error(formatSlackChanges(r.changes));
      attached += r.changes.filter((c) => c.kind === "attached").length;
      queued += r.changes.filter((c) => c.kind === "unsorted" || c.kind === "proposed").length;
      written.push(...r.written);
      // what a reader needs beside the queue to answer it, in the run that shows the queue
      if (dryRun && queued) console.error(`\nthe open list, for reading the queue against:\n${openList(r.workstreams)}`);
    }
    console.error(
      `marauder: ${attached} attached · ${queued} left to read · ` +
        `${written.length} file${written.length === 1 ? "" : "s"} written${dryRun ? " · (dry run)" : ""}`,
    );
    process.exit(0);
  } catch (err) {
    console.error(`marauder: ${(err as Error).message}`);
    process.exit(1);
  }
}

const CORRECTIONS = ["attach", "suggest", "new", "split", "stage", "propose-split"];

if (verb === "check" || CORRECTIONS.includes(verb)) {
  try {
    const before = await loadState(root);
    const who = defaultWho(flag("--reason"), now);
    if (verb === "check") {
      console.log(formatCheck(busy(before.workstreams, before.unsorted, now)));
      process.exit(0);
    }
    const [, a, b] = args;
    const result =
      verb === "attach" ? attach(before, need(a, "an unsorted id"), need(b, "a workstream slug"), { ...who, auto: args.includes("--auto"), kind: flag("--kind") as never })
      : verb === "suggest" ? suggest(before, need(a, "an unsorted id"), need(b, "a workstream slug"))
      : verb === "new" ? newFrom(before, need(a, "an unsorted id"), { ...who, name: need(flag("--name"), "--name"), features: list(flag("--features")), driver: flag("--driver") })
      : verb === "split" ? split(before, need(a, "a workstream slug"), { ...who, into: need(flag("--into"), "--into"), name: need(flag("--name"), "--name"), events: list(flag("--events")) })
      : verb === "stage" ? setStage(before, need(a, "a workstream slug"), need(b, "fe or be") as Side, need(args[3], "a stage") as Stage, who)
      : proposeSplit(before, need(a, "a workstream slug"), JSON.parse(need(flag("--groups"), "--groups")), who);

    for (const n of result.notes) console.error(`  ${n}`);
    const written = result.changed && !dryRun ? await saveState(root, before, result.state) : [];
    console.error(`marauder: ${result.changed ? "applied" : "nothing to do"} · ${written.length} file${written.length === 1 ? "" : "s"} written${dryRun ? " · (dry run)" : ""}`);
    process.exit(0);
  } catch (err) {
    console.error(`marauder: ${(err as Error).message}`);
    process.exit(1);
  }
}

const { workstreams, milestones, problems } = await loadWorkstreams(root);
for (const p of problems) console.error(`marauder: workstreams/${p.file} — ${p.problems.join("; ")}`);

const board = () => write(root, join(OUT_DIR, "board.md"), renderBoard({ workstreams, milestones, now }), dryRun);
const show = (w: Workstream) => write(root, join(OUT_DIR, `${w.slug}.md`), renderWorkstream(w, milestones, now), dryRun);
const changelog = (day: string) => write(root, join(OUT_DIR, "changelog", `${day}.md`), renderChangelog(workstreams, day), dryRun);

try {
  const written: Written[] = [];
  if (verb === "board") written.push(await board());
  else if (verb === "show") {
    const slug = args[1];
    const w = workstreams.find((x) => x.slug === slug);
    if (!w) throw new Error(`no workstream ${slug ?? "(none named)"} — ${workstreams.map((x) => x.slug).join(", ")}`);
    written.push(await show(w));
  } else if (verb === "changelog") written.push(await changelog(args[1] ?? now.slice(0, 10)));
  else if (verb === "render") {
    written.push(await board());
    for (const w of workstreams) written.push(await show(w));
    written.push(await changelog(now.slice(0, 10)));
  } else throw new Error(`no verb ${verb}\n${HELP}`);

  if (verb === "board" || verb === "show" || verb === "changelog") process.stdout.write(written[0]!.text);
  const changed = written.filter((w) => w.changed);
  console.error(
    `marauder: ${written.length} page${written.length === 1 ? "" : "s"} · ${changed.length} changed` +
      `${changed.length && verb === "render" ? ` (${changed.map((c) => c.path).join(", ")})` : ""}` +
      `${dryRun ? " · (dry run)" : ""}`,
  );
  process.exit(problems.length ? 1 : 0);
} catch (err) {
  console.error(`marauder: ${(err as Error).message}`);
  process.exit(1);
}
