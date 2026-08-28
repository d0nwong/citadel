#!/usr/bin/env bun
/**
 * accio journal — the day view over per-landing entries, generated, never stored.
 *
 * The journal keeps one file per landing so tickets and diffs stay greppable; anyone
 * wanting "what happened that day" gets it consolidated here from frontmatter alone.
 * Read-only by construction: a stored day file would be a second copy of facts the
 * entries own, and stored copies drift.
 *
 *   accio journal                    today
 *   accio journal 2026-08-28         one day
 *   accio journal --since 2026-08-21 every day since, newest first
 */

import { relative } from "node:path";
import { FEATURES_DIR } from "../lib/manifest.ts";

type Entry = {
  path: string; date: string; feature: string;
  pr?: string; merge?: string; ticket?: string; status?: string; hold?: string; summary?: string;
};

export async function journalView(day?: string, since?: string, dir = FEATURES_DIR): Promise<string> {
  const entries: Entry[] = [];
  for await (const path of new Bun.Glob("**/journal/**/*.md").scan({ cwd: dir, absolute: true })) {
    const text = await Bun.file(path).text();
    const field = (k: string) => text.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim()
      ?.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    const date = field("date")?.slice(0, 10);
    if (!date) continue;
    if (day && date !== day) continue;
    if (since && date < since) continue;
    entries.push({
      path: relative(dir, path), date,
      feature: relative(dir, path).replace(/\/journal\/.*$/, ""),
      pr: field("pr"), merge: field("merge"), ticket: field("ticket"),
      status: field("status"), hold: field("hold"), summary: field("summary"),
    });
  }
  if (!entries.length) return `no journal entries${day ? ` for ${day}` : since ? ` since ${since}` : ""}`;

  entries.sort((a, b) => b.date.localeCompare(a.date) || a.feature.localeCompare(b.feature));
  const out: string[] = [];
  let current = "";
  for (const e of entries) {
    if (e.date !== current) {
      current = e.date;
      const n = entries.filter(x => x.date === e.date).length;
      out.push(`${out.length ? "\n" : ""}${e.date} — ${n} ${n === 1 ? "entry" : "entries"}`);
    }
    const head = [e.pr, e.merge, e.ticket, e.status].filter(x => x && x !== "null").join(" · ");
    out.push(`  ${e.feature}  ${head}${e.hold ? `  (hold: ${e.hold})` : ""}`);
    if (e.summary) out.push(`    ${e.summary}`);
    out.push(`    → ${e.path}`);
  }
  return out.join("\n");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const sinceFlag = argv.indexOf("--since");
  const since = sinceFlag >= 0 ? argv[sinceFlag + 1] : undefined;
  const positional = argv.find((a, i) => !a.startsWith("--") && i !== sinceFlag + 1);
  const day = positional ?? (since ? undefined : new Date().toISOString().slice(0, 10));
  for (const d of [day, since]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    console.error(`error: \`${d}\` is not a YYYY-MM-DD date`);
    process.exit(1);
  }
  console.log(await journalView(day, since));
}
