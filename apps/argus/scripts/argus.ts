#!/usr/bin/env bun
/**
 * argus — the CLI over the ledger. Every verb that writes goes through `write.ts` and so
 * through the validator; every verb takes `--dry-run` (report, write nothing) and `--json`
 * (a machine-readable answer on stdout, which is what Pensieve reads). A refusal prints
 * the validator's problems on stderr and exits 1; nothing is half-written.
 *
 *   argus validate [<feature>...]              every ledger, or the ones named
 *   argus write <feature> <file>|-             the next ledger from a file or stdin
 *   argus show <feature>                       the ledger, for a reader or a tool
 *
 * The run's verbs (pull, place, commit) and the click verbs (close, confirm, place,
 * ticket, file, send) are added by their own files under scripts/argus/.
 *
 * `main()` commits whatever a verb reported writing (`argus/commit.ts`'s `noteWritten`)
 * before it returns, as the person running it — unless the run is inside a sweep tick
 * (`ARGUS_SWEEP_TICK`), whose own commit carries it instead (`argus/ledger` S-17, S-18).
 */

import { providerNameFor } from "@citadel/tickets";
import { DEFAULT_APP, listFeatures, ledgerPath, projectsPath, root } from "./argus/paths.ts";
import { validateDoc, validateLedger, validateSpec, ValidationError } from "./argus/validate.ts";
import { archDocPath, isFeature, listApps, specDocPath } from "./argus/paths.ts";
import { allAreas, loadProjects, recordFeatures, repoIdsForDir, unheldFeatures, validateProjectsConfig } from "./argus/projects.ts";
import { dropRevision, fileRevision, listRevisions, newRevision, readRevision, validateRevisionDir } from "./argus/revision.ts";
import { readBatch, placedPath } from "./argus/batch.ts";
import { loadRepoConfig, reconcileAll } from "./argus/blockers.ts";
import { type Check, deployCheck, pipelineRepo } from "./argus/deploy.ts";
import { repoPath } from "./argus/pr-facts.ts";
import { commitRun, commitWrites, endTick, inTick, origin, promoteCursor, resetWritten, saveRun, startTick, sweepAuthor, writtenPaths } from "./argus/commit.ts";
import { draftFor, draftForAsk } from "./argus/file.ts";
import { applyPatch, parsePatch } from "./argus/patch.ts";
import { attributePrompt, groundPrompt, readerPrompt, sliceOf, ungroundedProposals } from "./argus/reader.ts";
import { readUnplaced } from "./argus/state.ts";
import { place as placeBatchFile } from "./argus/place.ts";
import { pullBatch } from "./argus/pull.ts";
import { seedFeature } from "./argus/seed.ts";
import { trackerCreate, trackerEdit, trackerList, trackerShow } from "./argus/tracker.ts";
import { closeAsk, confirmRequirement, dismissMessage, dropAsk, moveAsk, placeMessage, recordSent, recordTicket, recordTicketBare, recordTicketForAsk } from "./argus/verbs.ts";
import { readLedger, writeLedger } from "./argus/write.ts";

export type Flags = { dryRun: boolean; json: boolean; actor: "model" | "user"; rest: string[]; opts: Record<string, string> };

export function parseArgs(argv: string[]): Flags {
  const f: Flags = { dryRun: false, json: false, actor: "model", rest: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") f.dryRun = true;
    else if (a === "--json") f.json = true;
    else if (a === "--user") f.actor = "user";
    else if (a === "-m") f.opts.m = argv[++i] ?? "";
    else if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      const v = inline ?? (argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i] : "true");
      f.opts[k!] = v!;
    } else f.rest.push(a);
  }
  return f;
}

const USAGE = `argus — the ledger CLI

  argus validate [<feature>...]      check every ledger and arch doc, or the ones named
  argus write <feature> <file>|-     validate and write the next ledger (--dry-run to preview)
  argus show <feature>               print the ledger

  argus tick start                   the sweep's own first step: records this tick's start, marks a terminal run as one
  argus pull [--since <date>] [--no-slack] [--no-landings] [--no-fetch] [--out <dir>]
  argus place <batch-id|path>        the deterministic joins → <batch>.placed.json + state/unplaced.json
  argus reconcile [<feature>...]     clear the blockers and settle the tickets the facts allow (records each backend landing's finished dev pipeline, asking again every run until there is one; each ticket's provider — Linear or Trello — whether it is Done or Canceled); a filed revision whose parent is Done folds into its features' specs, Canceled archives it
  argus deployed <be#N>|<sha>        whether a backend merge is live on dev, from its Bitbucket pipeline (--json for skills); exits 1 when nobody can ask
  argus prompt attribute [<batch>]   the attribution step's prompt over state/unplaced.json
  argus prompt reader <feature> <batch>   the reader's prompt for one feature's slice
  argus prompt ground [<feature> <P-n>]   the proposals whose Technical Notes name no file, or the grounding prompt for one
  argus patch <feature> <file>|-     apply a reader's patch to the ledger (validated whole)
  argus commit [-m "<message>"]      stage ledgers, state and docs, commit; in a tick, authored "argus sweep" as "sweep: <message>", and only then promotes the cursor
  argus save <path>... -m "<first line>"   commit exactly the named files, as the person running it (--dry-run to preview)

  argus close <feature> <A-n> --reason "<why>"
  argus drop <feature> <A-n> --reason "<why>"       the ask was never one, or is not wanted
  argus move <feature> <A-n> <to-feature>           the ask belongs to another feature; its thread follows
  argus confirm <feature> <R-n>|--all --reason "<why>" [--contradict] [--by "<name>"]
  argus place <message-id> <feature>
  argus dismiss <message-id>         the message belongs to no feature; its thread is dropped from now on
  argus file <feature> <P-n>|<A-n>   the ticket a proposal, or an ask, would become: title, body, and its destination
  argus ticket <feature> <P-n>|<A-n> <key> [--title "<t>"]
  argus sent <feature> <key> --repo <name> [--job <id>]   record that Pensieve sent it to Foundry
  argus seed <feature>...|--all [--force]  requirement rows from the product doc's BR table

  argus revision new <slug> --title "<t>" --feature <app>/<dir>[,…]   a draft under revisions/<slug>; the scope skill writes beside it
  argus revision show <slug|KEY>                       the record, from revisions/ or its archive
  argus revision file <slug> <KEY> --tickets K1,K2,…   the draft is filed on its parent; the directory takes the key
  argus revision drop <slug|KEY> --reason "<why>"      archived whole as dropped; nothing under revisions/ is ever deleted

  argus tracker show <KEY>                             a ticket — key, title, state, assignee, url, description, parent — from whichever provider owns it
  argus tracker list [--mine] [--unassigned] [--team <t>]   the open tickets that provider lists, across providers or narrowed to one
  argus tracker create --title "<t>" --team <t> [--body <file>|-] [--project <p>] [--assignee me|none|<id>] [--parent <KEY>] [--blocked-by K1,K2]
  argus tracker edit <KEY> [--title "<t>"] [--body <file>|-] [--project <p>] [--assignee me|none|<id>] [--parent <KEY>] [--state <name>] [--blocked-by K1,K2]

flags: --dry-run  --json  --user (the write is a person's, not the model's)
root: ${root()}`;

type Verb = (f: Flags) => Promise<number>;

const verbs: Record<string, Verb> = {
  async validate(f) {
    const problems: { feature: string; path: string; rule: string }[] = [];
    const checkFeature = async (feature: string, app: string, repos: string[] | undefined) => {
      const label = app === DEFAULT_APP ? feature : `${app}/${feature}`;
      if (!(await isFeature(feature, app))) {
        problems.push({ feature: label, path: label, rule: "not a feature directory" });
        return;
      }
      const file = Bun.file(ledgerPath(feature, app));
      if (await file.exists()) {
        let raw: unknown;
        try {
          raw = await file.json();
        } catch (e) {
          problems.push({ feature: label, path: ledgerPath(feature, app), rule: `not JSON: ${(e as Error).message}` });
          return;
        }
        // a standalone check reads the file as it is: user evidence on disk was a click, not a model write
        for (const p of validateLedger(raw, { actor: "user", repos })) problems.push({ feature: label, ...p });
      }
      const arch = archDocPath(feature, app);
      if (await Bun.file(arch).exists()) for (const p of await validateDoc(arch)) problems.push({ feature: label, ...p });
    };

    const config = await loadProjects();
    let checked: number;
    if (f.rest.length) {
      const repos = repoIdsForDir(config, DEFAULT_APP);
      for (const feature of f.rest) await checkFeature(feature, DEFAULT_APP, repos);
      checked = f.rest.length;
    } else {
      // the config itself (ledger S-21, S-25), then every configured doc area's features, not only alden-portal's (S-24)
      for (const p of await validateProjectsConfig(config)) problems.push({ feature: "projects.json", ...p });
      if (await Bun.file(projectsPath()).exists())
        for (const u of await unheldFeatures(config)) {
          const label = `${u.app}/${u.feature}`;
          problems.push({ feature: label, path: label, rule: "not held by any doc area" });
        }

      checked = 0;
      for (const area of allAreas(config)) {
        const feats = await listFeatures(area.dir);
        checked += feats.length;
        const repos = repoIdsForDir(config, area.dir);
        for (const feature of feats) await checkFeature(feature, area.dir, repos);
      }

      // the whole checkout: every feature's spec under every app, and every revision with its specs (CTD-192)
      for (const app of await listApps())
        for (const feature of await listFeatures(app)) {
          const spec = specDocPath(feature, app);
          if (await Bun.file(spec).exists()) for (const p of await validateSpec(spec, `${app}/${feature}`)) problems.push({ feature: `${app}/${feature}`, ...p });
        }
      for (const r of await listRevisions()) {
        checked++;
        const name = `revisions/${r.archived ? "archive/" : ""}${r.rev.key ?? r.rev.slug}`;
        for (const p of await validateRevisionDir(r.dir)) problems.push({ feature: name, ...p });
      }
    }
    if (f.json) console.log(JSON.stringify({ ok: problems.length === 0, checked, problems }));
    else if (problems.length) for (const p of problems) console.error(`${p.feature}: ${p.path}: ${p.rule}`);
    else console.log(`${checked} feature${checked === 1 ? "" : "s"} valid`);
    return problems.length ? 1 : 0;
  },

  async revision(f) {
    const [sub, a, b] = f.rest;
    const usage = 'revision new <slug> --title "<t>" --feature <app>/<dir>[,…] | show <slug|KEY> | file <slug> <KEY> --tickets K1,K2,… | drop <slug|KEY> --reason "<why>"';
    const out = (r: { wrote: boolean; path: string; diff: string[] }) => {
      if (f.json) console.log(JSON.stringify({ ok: true, wrote: r.wrote, path: r.path, diff: r.diff }));
      else console.log(`${f.dryRun ? "would write" : "wrote"} ${r.path}\n  ${r.diff.join("\n  ")}`);
      return 0;
    };
    switch (sub) {
      case "new": {
        if (!a || !f.opts.title || !f.opts.feature) throw new Usage(usage);
        const features = f.opts.feature.split(",").map((s) => s.trim()).filter(Boolean);
        return out(await newRevision(a, { title: f.opts.title, features }, { dryRun: f.dryRun }));
      }
      case "show": {
        if (!a) throw new Usage(usage);
        const found = await readRevision(a);
        if (!found) {
          if (f.json) console.log(JSON.stringify({ ok: false, error: `${a}: no revision under revisions/ or revisions/archive/` }));
          else console.error(`${a}: no revision under revisions/ or revisions/archive/`);
          return 1;
        }
        console.log(f.json ? JSON.stringify({ ok: true, revision: found.rev, dir: found.dir, archived: found.archived }) : JSON.stringify(found.rev, null, 2));
        return 0;
      }
      case "file": {
        if (!a || !b || !f.opts.tickets) throw new Usage(usage);
        return out(await fileRevision(a, b, f.opts.tickets.split(","), { dryRun: f.dryRun, url: f.opts.url }));
      }
      case "drop": {
        if (!a || !f.opts.reason) throw new Usage(usage);
        return out(await dropRevision(a, f.opts.reason, { dryRun: f.dryRun }));
      }
      default:
        throw new Usage(usage);
    }
  },

  async write(f) {
    const [feature, src] = f.rest;
    if (!feature || !src) throw new Usage("write <feature> <file>|-");
    const text = src === "-" ? await Bun.stdin.text() : await Bun.file(src).text();
    const input = JSON.parse(text);
    return report(f, feature, await writeLedger(feature, input, { actor: f.actor, dryRun: f.dryRun }));
  },

  async close(f) {
    const [feature, askId] = f.rest;
    if (!feature || !askId || !f.opts.reason) throw new Usage('close <feature> <A-n> --reason "<why>"');
    return report(f, feature, await closeAsk(feature, askId, f.opts.reason, { dryRun: f.dryRun }));
  },

  async drop(f) {
    const [feature, askId] = f.rest;
    if (!feature || !askId || !f.opts.reason) throw new Usage('drop <feature> <A-n> --reason "<why>"');
    return report(f, feature, await dropAsk(feature, askId, f.opts.reason, { dryRun: f.dryRun }));
  },

  async move(f) {
    const [feature, askId, to] = f.rest;
    if (!feature || !askId || !to) throw new Usage("move <feature> <A-n> <to-feature>");
    const r = await moveAsk(feature, askId, to, { dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, id: r.id, from: r.from.diff, to: r.to.diff }));
    else console.log(`${askId} → ${to} as ${r.id || "(dry run)"}\n  ${[...r.from.diff, ...r.to.diff].join("\n  ")}`);
    return 0;
  },

  async confirm(f) {
    const [feature, reqId] = f.rest;
    const all = f.opts.all === "true";
    if (!feature || (!reqId && !all) || !f.opts.reason) throw new Usage('confirm <feature> <R-n>|--all --reason "<why>" [--contradict] [--by "<name>"]');
    const r = await confirmRequirement(feature, reqId ?? null, f.opts.reason, {
      dryRun: f.dryRun,
      all,
      contradict: f.opts.contradict === "true",
      by: f.opts.by,
    });
    return report(f, feature, r);
  },

  async pull(f) {
    const r = await pullBatch({
      since: f.opts.since,
      noSlack: f.opts["no-slack"] === "true",
      noLandings: f.opts["no-landings"] === "true",
      fetch: f.opts["no-fetch"] !== "true",
      outDir: f.opts.out,
      dryRun: f.dryRun,
    });
    if (f.json) console.log(JSON.stringify({ ok: true, batch: r.batch?.id ?? null, path: r.path, reason: r.reason, messages: r.batch?.slack ? r.batch.slack.newTopLevel.length + r.batch.slack.threads.reduce((n, t) => n + t.replies.length, 0) : 0, landings: r.batch?.landings.length ?? 0 }));
    else if (!r.batch) console.log(r.reason ?? "nothing new");
    else console.log(`${f.dryRun ? "would write" : "wrote"} ${r.path}: ${r.batch.landings.length} landing(s), slack since ${r.batch.since.slack ?? "skipped"}`);
    return 0;
  },

  async reconcile(f) {
    const r = await reconcileAll({ dryRun: f.dryRun, features: f.rest.length ? f.rest : undefined });
    const wrote = (x: (typeof r)[number]) => x.write?.wrote ?? (x.revision ? !f.dryRun : false);
    if (f.json)
      console.log(JSON.stringify({ ok: true, results: r.map((x) => ({ feature: x.feature, cleared: x.cleared, wrote: wrote(x), ...(x.revision ? { revision: x.revision } : {}), ...(x.error ? { error: x.error } : {}) })) }));
    else if (!r.length) console.log("nothing to clear");
    else for (const x of r) console.log(`${x.feature}${f.dryRun ? " (dry run)" : ""}\n  ${[...x.cleared, ...(x.error ? [x.error] : [])].join("\n  ")}`);
    return r.some((x) => x.error) ? 1 : 0;
  },

  async deployed(f) {
    const [what] = f.rest;
    if (!what) throw new Usage("deployed <be#N>|<sha>");
    const t = await resolveLanding(what);
    if (!t) throw new Error(`${what}: not a backend landing on any ledger or on origin/dev`);
    const be = (await loadRepoConfig())["be"];
    if (!be) throw new Error("no 'be' repo in projects.json");
    const c = await deployCheck(pipelineRepo(be), t.sha);
    if (f.json) console.log(JSON.stringify({ ok: c.state !== "unknown", ref: t.ref, sha: t.sha, ...c }));
    else console.log(`${t.ref ?? t.sha.slice(0, 9)}: ${checkWords(c)}`);
    return c.state === "unknown" ? 1 : 0;
  },

  async prompt(f) {
    const [what, a, b] = f.rest;
    if (what === "attribute") {
      const batch = a ? await readBatch(a) : null;
      const unplaced = await readUnplaced();
      if (!unplaced.length) { console.log("nothing unplaced"); return 0; }
      console.log(await attributePrompt(unplaced, await recordFeatures(), batch));
      return 0;
    }
    if (what === "reader" && a && b) {
      const batch = await readBatch(b);
      const placed = await Bun.file(placedPath(batch.id, b.endsWith(".json") ? b.replace(/[^/]+$/, "").replace(/\/$/, "") || undefined : undefined)).json();
      const slice = sliceOf(placed, a);
      if (!slice) { console.error(`${a}: nothing in ${batch.id}`); return 1; }
      console.log(await readerPrompt(a, slice, batch.pulled_at.slice(0, 10)));
      return 0;
    }
    if (what === "ground") {
      if (a && b) {
        console.log(await groundPrompt(a, b));
        return 0;
      }
      const list = await ungroundedProposals(await listFeatures());
      if (f.json) console.log(JSON.stringify({ ok: true, proposals: list }));
      else console.log(list.map((x) => `${x.feature} ${x.id}`).join("\n") || "every proposal is grounded");
      return 0;
    }
    throw new Usage("prompt attribute [<batch>] | prompt reader <feature> <batch> | prompt ground [<feature> <P-n>]");
  },

  async patch(f) {
    const [feature, src] = f.rest;
    if (!feature || !src) throw new Usage("patch <feature> <file>|-");
    const text = src === "-" ? await Bun.stdin.text() : await Bun.file(src).text();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const patch = parsePatch(JSON.parse((fenced ? fenced[1] : text)!.trim()));
    const current = await readLedger(feature);
    if (!current) throw new Error(`${feature}: no ledger`);
    const next = applyPatch(current, patch);
    // the reader's prompt carried every untold deploy, so they are told now
    for (const ld of next.landings) if (ld.deployed) ld.deployed.told = true;
    const r = await writeLedger(feature, next, { actor: f.actor, dryRun: f.dryRun });
    if (patch.notes?.length && !f.json) console.log(`notes:\n  ${patch.notes.join("\n  ")}`);
    return report(f, feature, r);
  },

  async tick(f) {
    const [sub] = f.rest;
    if (sub !== "start") throw new Usage("tick start");
    const r = await startTick({ dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, ...r }));
    else console.log(r.carriedOver ? "continuing a tick that never reached commit" : `recorded${r.marked ? "; marked as a tick" : ""}`);
    return 0;
  },

  async commit(f) {
    const tick = await inTick();
    const body = f.opts.m ?? f.opts.message ?? (tick ? "quiet run" : "sweep");
    const message = tick ? `sweep: ${body}` : body;
    const r = await commitRun(message, { dryRun: f.dryRun, author: tick ? sweepAuthor() : undefined });
    const cursor = tick ? await promoteCursor({ dryRun: f.dryRun }) : "none";
    if (tick) await endTick({ dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, ...r, cursor }));
    else console.log(r.committed ? `committed ${r.sha} (${r.files} files); cursor ${cursor}` : `nothing to commit (${r.files} staged); cursor ${cursor}`);
    return 0;
  },

  async save(f) {
    const paths = f.rest;
    const message = f.opts.m ?? f.opts.message;
    if (!paths.length || !message) throw new Usage('save <path>... -m "<first line>"');
    const r = await saveRun(paths, message, { dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, ...r }));
    else console.log(r.committed ? `committed ${r.sha} (${r.files} file${r.files === 1 ? "" : "s"})` : `nothing to commit (${r.files} changed)${f.dryRun ? " (dry run)" : ""}`);
    return 0;
  },

  async place(f) {
    const [id, feature] = f.rest;
    if (id && !feature) {
      const p = await placeBatchFile(id, { dryRun: f.dryRun });
      if (f.json) console.log(JSON.stringify({ ok: true, ...p }));
      else console.log(`${p.batch}: ${p.slices.map((s) => `${s.feature} (${s.messages.length} msg, ${s.landings.length} landing)`).join(", ") || "nothing placed"}; ${p.unplaced.length} unplaced${f.dryRun ? " (dry run)" : ""}`);
      return 0;
    }
    if (!id || !feature) throw new Usage("place <batch> | place <message-id> <feature>");
    const r = await placeMessage(id, feature, { dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, ...r, ledger: r.ledger ? { wrote: r.ledger.wrote, diff: r.ledger.diff } : null }));
    else console.log(`${id} → ${feature}${r.thread ? ` (thread ${r.thread} remembered)` : ""}${r.ledger ? ", ledger opened" : ""}${f.dryRun ? " (dry run)" : ""}`);
    return 0;
  },

  async file(f) {
    const [feature, proposalId] = f.rest;
    if (!feature || !proposalId) throw new Usage("file <feature> <P-n>|<A-n>");
    const d = proposalId.startsWith("A-") ? await draftForAsk(feature, proposalId) : await draftFor(feature, proposalId);
    if (f.json) console.log(JSON.stringify({ ok: true, ...d }));
    else console.log(`${d.board} · ${d.list} · ${d.label}\n# ${d.title}\n\n${d.body}`);
    return 0;
  },

  async dismiss(f) {
    const [id] = f.rest;
    if (!id) throw new Usage("dismiss <message-id>");
    const r = await dismissMessage(id, { dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, ...r }));
    else console.log(`${id}: nobody's${r.thread ? ` (thread ${r.thread} dropped from now on)` : ""}, ${r.removed} entr${r.removed === 1 ? "y" : "ies"} off the list${f.dryRun ? " (dry run)" : ""}`);
    return 0;
  },

  async ticket(f) {
    const [feature, proposalId, key] = f.rest;
    const usage = "ticket <feature> <P-n>|<A-n> <key> [--title] | ticket <feature> <key> --title <t>";
    if (feature && proposalId && !key && providerNameFor(proposalId) !== null) {
      if (!f.opts.title) throw new Usage(usage);
      return report(f, feature, await recordTicketBare(feature, proposalId, f.opts.title, { dryRun: f.dryRun }));
    }
    if (!feature || !proposalId || !key) throw new Usage(usage);
    if (proposalId.startsWith("A-")) return report(f, feature, await recordTicketForAsk(feature, proposalId, key, f.opts.title ?? key, { dryRun: f.dryRun }));
    return report(f, feature, await recordTicket(feature, proposalId, key, { dryRun: f.dryRun }));
  },

  async sent(f) {
    const [feature, key] = f.rest;
    if (!feature || !key || !f.opts.repo) throw new Usage("sent <feature> <key> --repo <name> [--job <id>]");
    return report(f, feature, await recordSent(feature, key, f.opts.repo, f.opts.job, { dryRun: f.dryRun }));
  },

  async tracker(f) {
    const [sub, a] = f.rest;
    const usage =
      'tracker show <KEY> | tracker list [--mine] [--unassigned] [--team <t>] | tracker create --title "<t>" --team <t> [--body <file>|-] [--project <p>] [--assignee me|none|<id>] [--parent <KEY>] [--blocked-by K1,K2] | tracker edit <KEY> [--title "<t>"] [--body <file>|-] [--project <p>] [--assignee me|none|<id>] [--parent <KEY>] [--state <name>] [--blocked-by K1,K2]';
    const readBody = async () => (f.opts.body ? (f.opts.body === "-" ? await Bun.stdin.text() : await Bun.file(f.opts.body).text()) : undefined);
    const blockedBy = () => (f.opts["blocked-by"] ? f.opts["blocked-by"]!.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
    const printTicket = (t: Awaited<ReturnType<typeof trackerShow>>) => {
      if (f.json) console.log(JSON.stringify({ ok: true, ticket: t }));
      else console.log(`${t.key} — ${t.title}\nurl: ${t.url}`);
    };
    switch (sub) {
      case "show": {
        if (!a) throw new Usage(usage);
        const t = await trackerShow(a);
        if (f.json) console.log(JSON.stringify({ ok: true, ticket: t }));
        else {
          const s = t.state;
          console.log(`${t.key} — ${t.title}`);
          console.log(`state: ${s.state}${s.state !== "unknown" ? ` (${s.name})` : ""}`);
          if (s.state !== "unknown" && s.assignee) console.log(`assignee: ${s.assignee.id}`);
          console.log(`url: ${t.url}`);
          if (t.parentKey) console.log(`parent: ${t.parentKey}`);
          if (t.description) console.log(`\n${t.description}`);
        }
        return 0;
      }
      case "list": {
        const tickets = await trackerList({ mine: f.opts.mine === "true", unassigned: f.opts.unassigned === "true", team: f.opts.team });
        if (f.json) console.log(JSON.stringify({ ok: true, tickets }));
        else if (!tickets.length) console.log("nothing open");
        else
          for (const t of tickets) {
            const s = t.state;
            const assignee = s.state !== "unknown" && s.assignee ? ` [${s.assignee.id}]` : "";
            console.log(`${t.key}  ${s.state === "unknown" ? s.state : s.name}${assignee}  ${t.title}`);
          }
        return 0;
      }
      case "create": {
        if (!f.opts.title || !f.opts.team) throw new Usage(usage);
        const createOpts = {
          title: f.opts.title,
          body: await readBody(),
          team: f.opts.team,
          project: f.opts.project ?? f.opts.label,
          assignee: f.opts.assignee,
          parent: f.opts.parent,
          blockedBy: blockedBy(),
        };
        if (f.dryRun) {
          if (f.json) console.log(JSON.stringify({ ok: true, dryRun: true, ...createOpts }));
          else
            console.log(
              `would create on ${createOpts.team}: ${createOpts.title}${createOpts.project ? ` [${createOpts.project}]` : ""}${createOpts.parent ? ` under ${createOpts.parent}` : ""}${createOpts.blockedBy?.length ? `, blocked by ${createOpts.blockedBy.join(", ")}` : ""}`,
            );
          return 0;
        }
        printTicket(await trackerCreate(createOpts));
        return 0;
      }
      case "edit": {
        if (!a) throw new Usage(usage);
        const editOpts = {
          title: f.opts.title,
          body: await readBody(),
          project: f.opts.project ?? f.opts.label,
          assignee: f.opts.assignee,
          parent: f.opts.parent,
          state: f.opts.state,
          blockedBy: blockedBy(),
        };
        if (f.dryRun) {
          if (f.json) console.log(JSON.stringify({ ok: true, dryRun: true, key: a, ...editOpts }));
          else console.log(`would edit ${a}: ${Object.entries(editOpts).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(", ") || "nothing"}`);
          return 0;
        }
        printTicket(await trackerEdit(a, editOpts));
        return 0;
      }
      default:
        throw new Usage(usage);
    }
  },

  async seed(f) {
    const features = f.opts.all === "true" ? await listFeatures() : f.rest;
    if (!features.length) throw new Usage("seed <feature>...|--all [--force]");
    const results = [];
    for (const feature of features) results.push(await seedFeature(feature, { dryRun: f.dryRun, force: f.opts.force === "true" }));
    if (f.json) console.log(JSON.stringify({ ok: true, results: results.map((r) => ({ ...r, write: r.write ? { wrote: r.write.wrote, diff: r.write.diff.length } : null })) }));
    else
      for (const r of results) {
        console.log(`${r.feature}: ${r.note ?? `${r.seeded} requirement(s) seeded${r.write?.wrote ? "" : f.dryRun ? " (dry run)" : ", unchanged"}`}`);
        for (const s of r.skipped) console.log(`  skipped ${s.id} (${s.why}): ${s.rule}`);
      }
    return 0;
  },

  async show(f) {
    const [feature] = f.rest;
    if (!feature) throw new Usage("show <feature>");
    const l = await readLedger(feature);
    if (!l) {
      console.error(`${feature}: no ledger`);
      return 1;
    }
    console.log(JSON.stringify(l, null, 2));
    return 0;
  },
};

class Usage extends Error {}

/** `be#N` or a sha → the merge commit on the backend's dev: a ledger's landing first, then the checkout's history */
async function resolveLanding(what: string): Promise<{ ref: string | null; sha: string } | null> {
  const pr = what.match(/^be#(\d+)$/i);
  if (!pr && !/^[0-9a-f]{7,40}$/i.test(what)) return null;
  for (const feature of await listFeatures()) {
    const l = await readLedger(feature);
    const ld = l?.landings.find((x) => x.repo === "be" && (pr ? x.ref === `be#${pr[1]}` : x.sha.startsWith(what.toLowerCase())));
    if (ld) return { ref: ld.ref, sha: ld.sha };
  }
  if (!pr) return { ref: null, sha: what.toLowerCase() };
  const git = Bun.spawnSync(["git", "-C", repoPath("be"), "log", "origin/dev", "-1", "--format=%H", `--grep=(pull request #${pr[1]})`]);
  const sha = git.stdout.toString().trim();
  return sha ? { ref: `be#${pr[1]}`, sha } : null;
}

function checkWords(c: Check): string {
  if (c.state === "running") return "not deployed yet, the dev pipeline is running";
  if (c.state === "not-found") return "not deployed, no dev pipeline among Bitbucket's newest 100";
  if (c.state === "unknown") return `unknown: ${c.why}`;
  const d = c.deploy;
  const at = `${d.at.slice(0, 10)} ${d.at.slice(11, 16)} UTC`;
  return d.result === "SUCCESSFUL" ? `deployed to dev ${at}, build ${d.build} ${d.url}` : `not deployed, the dev pipeline ${d.result.toLowerCase()} ${at}, build ${d.build} ${d.url}`;
}

function report(f: Flags, feature: string, r: { wrote: boolean; path: string; diff: string[] }): number {
  if (f.json) console.log(JSON.stringify({ ok: true, wrote: r.wrote, path: r.path, diff: r.diff }));
  else if (!r.diff.length) console.log(`${feature}: unchanged`);
  else console.log(`${feature}: ${f.dryRun ? "would write" : "wrote"}\n  ${r.diff.join("\n  ")}`);
  return 0;
}

/** a commit's first line: the Pensieve conversation it came from when one is set, otherwise the verb and its first argument (`argus/ledger` S-16) */
function firstLine(verb: string, rest: string[]): string {
  const o = origin();
  if (o) return `${o}: `;
  return `argus ${verb}${rest[0] ? ` ${rest[0]}` : ""}: `;
}

/** the post-verb commit (`argus/ledger` S-17): whatever the verb reported writing, as the person running it — skipped inside a sweep tick, whose own commit carries it (S-18) */
async function commitVerb(verb: string, rest: string[], flags: Flags): Promise<void> {
  if (await inTick()) return;
  await commitWrites(writtenPaths(), firstLine(verb, rest), { dryRun: flags.dryRun });
}

export async function main(argv: string[]): Promise<number> {
  const [verb, ...rest] = argv;
  if (!verb || verb === "--help" || verb === "-h") {
    console.log(USAGE);
    return verb ? 0 : 1;
  }
  const run = verbs[verb];
  if (!run) {
    console.error(`argus: unknown verb "${verb}"\n\n${USAGE}`);
    return 1;
  }
  const flags = parseArgs(rest);
  resetWritten();
  try {
    const code = await run(flags);
    await commitVerb(verb, rest, flags);
    return code;
  } catch (e) {
    // whatever landed on disk before the throw still gets committed; the throw itself is reported below
    await commitVerb(verb, rest, flags).catch(() => {});
    if (e instanceof ValidationError) {
      if (flags.json) console.log(JSON.stringify({ ok: false, problems: e.problems }));
      else console.error(`argus ${verb}: refused\n${e.problems.map((p) => `  ${p.path}: ${p.rule}`).join("\n")}`);
      return 1;
    }
    if (e instanceof Usage) {
      console.error(`usage: argus ${e.message}`);
      return 1;
    }
    const msg = (e as Error).message ?? String(e);
    if (flags.json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`argus ${verb}: ${msg}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
