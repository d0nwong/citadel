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
    const r = await writeLedger(feature, input, { actor: f.actor, dryRun: f.dryRun });
    if (f.json) console.log(JSON.stringify({ ok: true, wrote: r.wrote, path: r.path, diff: r.diff }));
    else if (!r.diff.length) console.log(`${feature}: unchanged`);
    else console.log(`${feature}: ${f.dryRun ? "would write" : r.wrote ? "wrote" : "unchanged"}\n  ${r.diff.join("\n  ")}`);
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
