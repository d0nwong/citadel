#!/usr/bin/env bun
/**
 * accio arc — the running story of one initiative, and everything behind it (LIA-145).
 *
 * `arcs/<slug>.md` is written by the sweep alone (`skills/sweep/scripts/arcs.ts`); this is
 * the read side, the same job `accio point` does for a Needs-you point. It prints the arc's
 * frontmatter and its "Where we are" paragraph, then re-derives what the arc is made of —
 * the journal entries, open points and tickets its seeds name — so a reader can check the
 * paragraph against the evidence instead of trusting it.
 *
 *   accio arc                    every arc, its status and the date it was last rewritten
 *   accio arc invoice-emails     one arc: frontmatter, Where we are, journal, points, tickets
 *
 * Read-only by construction, like `accio point`: `arcs/`, `reports/points.json` and every
 * app's `features/**\/journal` — nothing under `.state/`, no `fetch`, no `checkout`. The
 * ticket bodies are read next with the Linear MCP; argus holds no Linear key.
 */

import { join } from "node:path";
import { ROOT } from "../lib/manifest.ts";
import { loadAllJournals, type AppJournalEntry } from "../lib/journal.ts";
import { loadArcs, entrySeeds, pointSeeds, ARCS_DIR, type Arc } from "../../skills/sweep/scripts/arcs.ts";
import { SEED_KINDS, type PointsFile, type Point } from "../../skills/sweep/scripts/points.ts";

const seedLine = (arc: Arc) => SEED_KINDS.map((k) => `${k} ${arc.seeds[k].length ? arc.seeds[k].join(", ") : "—"}`).join(" · ");

const journalLine = (entry: AppJournalEntry, why: string[]) =>
  `- ${entry.rel} — ${entry.status ?? "?"} — ${entry.summary ?? "(no summary)"}  ⟵ ${why.join(", ")}`;

const pointLine = (p: Point, why: string[]) =>
  `- ${p.id} — **${p.subject}** — ${p.ask}${p.decision ? ` (${p.decision.action})` : ""}  ⟵ ${why.join(", ")}`;

async function loadPoints(root: string): Promise<PointsFile | null> {
  const f = Bun.file(join(root, "reports/points.json"));
  return (await f.exists()) ? ((await f.json()) as PointsFile) : null;
}

/** `accio arc` → every arc, newest rewrite first. Never writes. */
export async function arcList(root = ROOT): Promise<{ text: string; ok: boolean }> {
  const arcs = await loadArcs(root);
  if (!arcs.size)
    return { ok: false, text: `no ${ARCS_DIR}/ under ${root} — an arc is opened by a decisions/arc/<slug>.json the sweep then files (LIA-145)` };
  const rows = [...arcs.entries()]
    .map(([slug, { arc }]) => ({ slug, arc }))
    .sort((a, b) => (b.arc?.updated ?? "").localeCompare(a.arc?.updated ?? "") || a.slug.localeCompare(b.slug));
  const open = rows.filter((r) => r.arc?.status !== "closed").length;
  return {
    ok: true,
    text: [
      `# arcs — ${open} open, ${rows.length - open} closed`,
      "",
      ...rows.map(({ slug, arc }) =>
        arc
          ? `- **${slug}** — ${arc.title} — ${arc.status} — rewritten ${arc.updated || "—"} · ${ARCS_DIR}/${slug}.md`
          : `- **${slug}** — unreadable (no frontmatter) · ${ARCS_DIR}/${slug}.md`,
      ),
      "",
      "## Next",
      `- accio arc <slug>`,
    ].join("\n"),
  };
}

/** `accio arc <slug>` → the arc and the evidence behind it. Never writes, never calls Linear. */
export async function arcView(slug: string, root = ROOT): Promise<{ text: string; ok: boolean }> {
  const arcs = await loadArcs(root);
  const found = arcs.get(slug);
  if (!found)
    return {
      ok: false,
      text: `no ${ARCS_DIR}/${slug}.md${arcs.size ? ` — arcs here: ${[...arcs.keys()].join(", ")}` : ` (no ${ARCS_DIR}/ yet)`}`,
    };
  if (!found.arc) return { ok: false, text: `${ARCS_DIR}/${slug}.md has no frontmatter — the sweep rewrites it from decisions/arc/${slug}.json` };
  const arc = found.arc;

  const [journals, points] = await Promise.all([loadAllJournals(root), loadPoints(root)]);
  const entries = journals
    .map((e) => ({ e, why: entrySeeds(e, arc.seeds) }))
    .filter(({ why }) => why.length)
    .sort((a, b) => (a.e.date ?? "").localeCompare(b.e.date ?? ""));
  const matched = (points?.points ?? []).map((p) => ({ p, why: pointSeeds(p, arc.seeds) })).filter(({ why }) => why.length);
  const open = matched.filter(({ p }) => !p.decision);
  const decided = matched.filter(({ p }) => p.decision);

  const text = [
    `# arc/${arc.slug} — ${arc.title}`,
    "",
    `- status ${arc.status} · opened ${arc.opened || "—"} · rewritten ${arc.updated || "—"} · record: ${ARCS_DIR}/${arc.slug}.md`,
    `- seeds: ${seedLine(arc)}`,
    "",
    "## Where we are",
    ...(arc.where.length ? arc.where : ["(not written yet — the sweep writes it on the tick that opens the arc)"]),
    "",
    `## Landed — ${arc.landed.length} row${arc.landed.length === 1 ? "" : "s"} in the file`,
    ...(arc.landed.length ? arc.landed.map((r) => `- ${r.when} — ${r.what} — ${r.evidence}`) : ["(nothing yet)"]),
    "",
    `## Journal — ${entries.length} entr${entries.length === 1 ? "y" : "ies"} the seeds name`,
    ...(entries.length ? entries.map(({ e, why }) => journalLine(e, why)) : ["(no journal entry carries a seed of this arc)"]),
    "",
    `## Points — ${points ? `reports/points.json as of ${points.date}` : "reports/points.json absent"}`,
    ...(open.length ? open.map(({ p, why }) => pointLine(p, why)) : ["(no open point)"]),
    ...decided.map(({ p, why }) => pointLine(p, why)),
    "",
    `## Tickets — ${arc.seeds.tickets.length ? arc.seeds.tickets.join(", ") : "none seeded"}`,
    ...arc.seeds.tickets.map((t) => `- body: mcp__linear__get_issue ${t}`),
    "",
    "## Next",
    ...open.map(({ p }) => `- accio point ${p.id}`),
    `- git log -p ${ARCS_DIR}/${arc.slug}.md    # how the paragraph got here`,
  ];
  return { ok: true, text: text.join("\n") };
}

// ---------------------------------------------------------------- cli

if (import.meta.main) {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const { text, ok } = slug ? await arcView(slug) : await arcList();
  (ok ? console.log : console.error)(text);
  process.exit(ok ? 0 : 1);
}
