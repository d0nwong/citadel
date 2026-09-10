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
import { validateDoc, validateLedger, ValidationError } from "./argus/validate.ts";
import { archDocPath, isFeature } from "./argus/paths.ts";
import { place as placeBatchFile } from "./argus/place.ts";
import { pullBatch } from "./argus/pull.ts";
import { closeAsk, confirmRequirement, placeMessage, recordTicket } from "./argus/verbs.ts";
import { readLedger, writeLedger } from "./argus/write.ts";

export type Flags = { dryRun: boolean; json: boolean; actor: "model" | "user"; rest: string[]; opts: Record<string, string> };

export function parseArgs(argv: string[]): Flags {
  const f: Flags = { dryRun: false, json: false, actor: "model", rest: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") f.dryRun = true;
    else if (a === "--json") f.json = true;
    else if (a === "--user") f.actor = "user";
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

  argus close <feature> <A-n> --reason "<why>"
  argus confirm <feature> <R-n>|--all --reason "<why>" [--contradict] [--by "<name>"]
  argus place <message-id> <feature>
  argus ticket <feature> <P-n> <ALD-key>

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
        for (const p of validateLedger(raw)) problems.push({ feature, ...p });
      }
      const arch = archDocPath(feature);
      if (await Bun.file(arch).exists()) for (const p of await validateDoc(arch)) problems.push({ feature, ...p });
    }
    if (f.json) console.log(JSON.stringify({ ok: problems.length === 0, checked: features.length, problems }));
    else if (problems.length) for (const p of problems) console.error(`${p.feature}: ${p.path}: ${p.rule}`);
    else console.log(`${features.length} feature${features.length === 1 ? "" : "s"} valid`);
    return problems.length ? 1 : 0;
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

  async ticket(f) {
    const [feature, proposalId, key] = f.rest;
    if (!feature || !proposalId || !key) throw new Usage("ticket <feature> <P-n> <ALD-key>");
    return report(f, feature, await recordTicket(feature, proposalId, key, { dryRun: f.dryRun }));
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
