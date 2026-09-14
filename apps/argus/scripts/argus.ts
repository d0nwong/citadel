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
 */

import { listFeatures, ledgerPath, root } from "./argus/paths.ts";
import { validateDoc, validateLedger, validateSpec, ValidationError } from "./argus/validate.ts";
import { archDocPath, isFeature, listApps, specDocPath } from "./argus/paths.ts";
import { dropRevision, fileRevision, listRevisions, newRevision, readRevision, validateRevisionDir } from "./argus/revision.ts";
import { readBatch, placedPath } from "./argus/batch.ts";
import { reconcileAll } from "./argus/blockers.ts";
import { commitRun } from "./argus/commit.ts";
import { draftFor, draftForAsk } from "./argus/file.ts";
import { applyPatch, parsePatch } from "./argus/patch.ts";
import { attributePrompt, readerPrompt, sliceOf } from "./argus/reader.ts";
import { readUnplaced } from "./argus/state.ts";
import { place as placeBatchFile } from "./argus/place.ts";
import { pullBatch } from "./argus/pull.ts";
import { seedFeature } from "./argus/seed.ts";
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

  argus pull [--since <date>] [--no-slack] [--no-landings] [--no-fetch] [--out <dir>]
  argus place <batch-id|path>        the deterministic joins → <batch>.placed.json + state/unplaced.json
  argus reconcile [<feature>...]     clear the blockers and settle the tickets the facts allow (asks Bitbucket whether a landing deployed, each ticket's provider — Linear or Trello — whether it is Done or Canceled); a filed revision whose parent is Done folds into its features' specs, Canceled archives it
  argus prompt attribute [<batch>]   the attribution step's prompt over state/unplaced.json
  argus prompt reader <feature> <batch>   the reader's prompt for one feature's slice
  argus patch <feature> <file>|-     apply a reader's patch to the ledger (validated whole)
  argus commit [-m "<message>"]      stage ledgers, state and docs, commit, promote the cursor

  argus close <feature> <A-n> --reason "<why>"
  argus drop <feature> <A-n> --reason "<why>"       the ask was never one, or is not wanted
  argus move <feature> <A-n> <to-feature>           the ask belongs to another feature; its thread follows
  argus confirm <feature> <R-n>|--all --reason "<why>" [--contradict] [--by "<name>"]
  argus place <message-id> <feature>
  argus dismiss <message-id>         the message belongs to no feature; its thread is dropped from now on
  argus file <feature> <P-n>|<A-n>   the ticket a proposal, or an ask, would become: title, body, team, project
  argus ticket <feature> <P-n>|<A-n> <ALD-key> [--title "<t>"]
  argus sent <feature> <ALD-key> --repo <name> [--job <id>]   record that Pensieve sent it to Foundry
  argus seed <feature>...|--all [--force]  requirement rows from the product doc's BR table

  argus revision new <slug> --title "<t>" --feature <app>/<dir>[,…]   a draft under revisions/<slug>; the scope skill writes beside it
  argus revision show <slug|KEY>                       the record, from revisions/ or its archive
  argus revision file <slug> <KEY> --tickets K1,K2,…   the draft is filed on its parent; the directory takes the key
  argus revision drop <slug|KEY> --reason "<why>"      archived whole as dropped; nothing under revisions/ is ever deleted

flags: --dry-run  --json  --user (the write is a person's, not the model's)
root: ${root()}`;

type Verb = (f: Flags) => Promise<number>;

const verbs: Record<string, Verb> = {
  async validate(f) {
    const features = f.rest.length ? f.rest : await listFeatures();
    const problems: { feature: string; path: string; rule: string }[] = [];
    for (const feature of features) {
      if (!(await isFeature(feature))) {
        problems.push({ feature, path: feature, rule: "not a feature directory" });
        continue;
      }
      const file = Bun.file(ledgerPath(feature));
      if (await file.exists()) {
        let raw: unknown;
        try {
          raw = await file.json();
        } catch (e) {
          problems.push({ feature, path: ledgerPath(feature), rule: `not JSON: ${(e as Error).message}` });
          continue;
        }
        // a standalone check reads the file as it is: user evidence on disk was a click, not a model write
        for (const p of validateLedger(raw, { actor: "user" })) problems.push({ feature, ...p });
      }
      const arch = archDocPath(feature);
      if (await Bun.file(arch).exists()) for (const p of await validateDoc(arch)) problems.push({ feature, ...p });
    }
    // the whole checkout: every feature's spec under every app, and every revision with its specs (CTD-192)
    let checked = features.length;
    if (!f.rest.length) {
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

  async prompt(f) {
    const [what, a, b] = f.rest;
    if (what === "attribute") {
      const batch = a ? await readBatch(a) : null;
      const unplaced = await readUnplaced();
      if (!unplaced.length) { console.log("nothing unplaced"); return 0; }
      console.log(await attributePrompt(unplaced, await listFeatures(), batch));
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
    throw new Usage("prompt attribute [<batch>] | prompt reader <feature> <batch>");
  },

  async patch(f) {
    const [feature, src] = f.rest;
    if (!feature || !src) throw new Usage("patch <feature> <file>|-");
    const text = src === "-" ? await Bun.stdin.text() : await Bun.file(src).text();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const patch = parsePatch(JSON.parse((fenced ? fenced[1] : text)!.trim()));
    const current = await readLedger(feature);
    if (!current) throw new Error(`${feature}: no ledger`);
    const r = await writeLedger(feature, applyPatch(current, patch), { actor: f.actor, dryRun: f.dryRun });
    if (patch.notes?.length && !f.json) console.log(`notes:\n  ${patch.notes.join("\n  ")}`);
    return report(f, feature, r);
  },

  async commit(f) {
    const r = await commitRun(f.opts.m ?? f.opts.message ?? "sweep", { dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, ...r }));
    else console.log(r.committed ? `committed ${r.sha} (${r.files} files); cursor ${r.cursor}` : `nothing to commit (${r.files} staged); cursor ${r.cursor}`);
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
    else console.log(`${d.team} · ${d.project}\n# ${d.title}\n\n${d.body}`);
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
    const usage = "ticket <feature> <P-n>|<A-n> <ALD-key> [--title] | ticket <feature> <ALD-key> --title <t>";
    if (feature && proposalId && !key && /^[A-Z]+-\d+$/.test(proposalId) && !/^[PA]-/.test(proposalId)) {
      if (!f.opts.title) throw new Usage(usage);
      return report(f, feature, await recordTicketBare(feature, proposalId, f.opts.title, { dryRun: f.dryRun }));
    }
    if (!feature || !proposalId || !key) throw new Usage(usage);
    if (proposalId.startsWith("A-")) return report(f, feature, await recordTicketForAsk(feature, proposalId, key, f.opts.title ?? key, { dryRun: f.dryRun }));
    return report(f, feature, await recordTicket(feature, proposalId, key, { dryRun: f.dryRun }));
  },

  async sent(f) {
    const [feature, key] = f.rest;
    if (!feature || !key || !f.opts.repo) throw new Usage("sent <feature> <ALD-key> --repo <name> [--job <id>]");
    return report(f, feature, await recordSent(feature, key, f.opts.repo, f.opts.job, { dryRun: f.dryRun }));
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

function report(f: Flags, feature: string, r: { wrote: boolean; path: string; diff: string[] }): number {
  if (f.json) console.log(JSON.stringify({ ok: true, wrote: r.wrote, path: r.path, diff: r.diff }));
  else if (!r.diff.length) console.log(`${feature}: unchanged`);
  else console.log(`${feature}: ${f.dryRun ? "would write" : "wrote"}\n  ${r.diff.join("\n  ")}`);
  return 0;
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
  try {
    return await run(flags);
  } catch (e) {
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
