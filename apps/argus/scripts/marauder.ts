#!/usr/bin/env bun
/**
 * marauder — the map of the work (LIA-155).
 *
 * `accio` summons the API surface. `marauder` says where the work stands: one JSON record
 * per workstream under `workstreams/`, and the pages a person reads rendered from those
 * records and nothing else.
 *
 *   marauder ingest --landings     merges on the base branches become events
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
import { loadWorkstreams, type Workstream } from "../skills/sweep/scripts/marauder/record.ts";
import { checkStyle, formatStyleProblems, renderBoard, renderChangelog, renderWorkstream, OUT_DIR } from "../skills/sweep/scripts/marauder/render.ts";
import { run as ingestLandings, formatChanges } from "../skills/sweep/scripts/marauder/ingest-landings.ts";

const HELP = `marauder — where the work stands

  marauder ingest --landings        merges on origin/staging and origin/dev become events
  marauder board                    marauder/board.md — the one page to read
  marauder show <slug>              marauder/<slug>.md — one workstream's story
  marauder changelog [YYYY-MM-DD]   marauder/changelog/<day>.md — what changed that day
  marauder render                   all three

  --since <day>   ingest from this day instead of the newest landing each side holds
  --now <ISO>     render as of this instant instead of the clock (tests, back-fills)
  --root <dir>    the workspace root (default: the repo this script is in)
  --dry-run       print what would be written, write nothing

The record is \`workstreams/<slug>.json\`; every page here is rendered from it alone. If a
page needs Slack, Linear or git to draw itself, the record is incomplete and that is the
bug to fix.
`;

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

type Written = { path: string; text: string; changed: boolean };

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

// ingest reads and writes the records, so it runs before they are loaded to be rendered
if (verb === "ingest") {
  if (!args.includes("--landings")) {
    console.error("marauder: ingest needs --landings (Slack is the other half, and is not here yet)");
    process.exit(1);
  }
  try {
    const result = await ingestLandings({ root, since, now, dryRun });
    if (result.changes.length) console.error(formatChanges(result.changes));
    const attached = result.changes.filter((c) => c.kind === "attached").length;
    const unsorted = result.changes.filter((c) => c.kind === "unsorted").length;
    console.error(
      `marauder: ${attached} landing${attached === 1 ? "" : "s"} attached · ${unsorted} unsorted · ` +
        `${result.written.length} file${result.written.length === 1 ? "" : "s"} written${dryRun ? " · (dry run)" : ""}`,
    );
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
