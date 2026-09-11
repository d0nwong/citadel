/**
 * What the two model steps of the sweep read. `attributePrompt` is the unplaced list with
 * the feature summaries under `skills/sweep/attribute.md`; `readerPrompt` is one feature's
 * ledger (code pointers and closed asks compacted), its slice of the batch, and the arch
 * doc's gap sections under `reader.md` and `shapes.md`. The sweep session prints these
 * with `argus prompt`, and the replay harness under evals/ builds the same text, so a
 * change here is measured before it runs.
 */

import { join } from "node:path";
import type { Batch, Placed, Slice } from "./batch.ts";
import { featureDirOf, loadManifest } from "./manifest.ts";
import { archDocPath, REPO_ROOT } from "./paths.ts";
import type { Ledger } from "./schema.ts";
import { flatten, type Msg } from "./slack-pull.ts";
import type { Unplaced } from "./state.ts";
import { readLedger } from "./write.ts";

const skill = (name: string) => Bun.file(join(REPO_ROOT, "skills/sweep", name)).text();

export function renderMessages(messages: Msg[]): string {
  return messages
    .map((m) => {
      const flags = [m.mentionsMe ? "->you" : "", m.bot ? "[bot]" : ""].filter(Boolean).join(" ");
      const where = m.thread === m.ts ? "root" : `reply in ${m.thread}`;
      const tail = [m.reactions && `reactions: ${m.reactions}`, ...m.files.map((f) => `file: ${f}`)].filter(Boolean).join("; ");
      const canvas = m.canvas ? `\n--- huddle notes ---\n${m.canvas}\n--- end ---` : "";
      return `[${m.ts}] ${m.date} ${m.time} ${m.author}${flags ? ` ${flags}` : ""} (${where}) ${m.permalink}\n${m.text}${canvas}${tail ? `\n(${tail})` : ""}`;
    })
    .join("\n\n");
}

export function renderSlice(s: Slice): string {
  const landings = s.landings
    .map((l) => {
      const files = `${l.files.slice(0, 40).join(", ")}${l.files.length > 40 ? ` (+${l.files.length - 40})` : ""}`;
      const tickets = l.ticketKeys.length ? `\ntickets: ${l.ticketKeys.join(", ")}` : "";
      const routes = l.routes.length ? `\nroutes: ${l.routes.join(", ")}` : "";
      return `[${l.ref}] ${l.date} ${l.by} ${l.url ?? ""}\n${l.title}${tickets}\nsha ${l.sha}\nfiles: ${files}${routes}`;
    })
    .join("\n\n");
  return `## Messages (${s.messages.length})\n\n${renderMessages(s.messages) || "none"}\n\n## Landings (${s.landings.length})\n\n${landings || "none"}`;
}

/** the arch doc's mismatch and gap sections, capped */
export function archExcerpt(arch: string, maxChars = 12000): string {
  const out: string[] = [];
  let keep = false;
  for (const l of arch.split("\n")) {
    if (/^##\s/.test(l)) keep = /mismatch|gap|tech debt|failure/i.test(l);
    if (keep) out.push(l);
  }
  const text = out.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text || "(the arch doc has no mismatch or gap section)";
}

/** the ledger as the reader sees it: no code pointers, no id counters, closed asks compact */
export function ledgerForReader(l: Ledger): string {
  const { ids: _ids, ...rest } = l;
  const done = (a: Ledger["asks"][number]) => a.status === "closed" || a.status === "dropped";
  return JSON.stringify({
    ...rest,
    requirements: l.requirements.map(({ code: _c, evidence: _e, ...r }) => (r.status === "retired" ? { id: r.id, status: r.status } : r)),
    asks: l.asks.map((a) => (done(a) ? { id: a.id, text: a.text, status: a.status, origin: a.origin } : a)),
    proposals: l.proposals.map(({ body: _b, ...p }) => p),
  });
}

/** one line per feature: name, routes, a few aliases, the ledger's summary and open asks */
export async function featureSummaries(features: string[]): Promise<string> {
  const manifest = await loadManifest();
  const byDir = new Map(manifest.features.map((f) => [featureDirOf(f), f]));
  const out: string[] = [];
  for (const f of features) {
    const m = byDir.get(f);
    const l = await readLedger(f);
    const head = [
      m?.name,
      m?.entry_routes.length ? `routes ${m.entry_routes.slice(0, 3).join(" ")}` : "",
      m?.aliases.length ? `also called: ${m.aliases.slice(0, 8).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    const asks = (l?.asks ?? []).filter((a) => a.status !== "closed" && a.status !== "dropped").map((a) => `    - open: ${a.text}`);
    out.push(`- ${f}${head ? ` - ${head}` : ""}${l?.summary ? `\n    ${l.summary}` : ""}${asks.length ? `\n${asks.join("\n")}` : ""}`);
  }
  return out.join("\n");
}

/** the attribution step's prompt: the skill, the features, the unplaced messages grouped by thread */
export async function attributePrompt(unplaced: Unplaced[], features: string[], batch: Batch | null): Promise<string> {
  const all = batch?.slack ? flatten(batch.slack) : [];
  const byId = new Map(all.map((m) => [m.ts, m]));
  const groups = new Map<string, string[]>();
  for (const u of unplaced) {
    const m = byId.get(u.id);
    const key = m ? m.thread : (u.thread ?? u.id);
    const text = m ? renderMessages([m]) : `[${u.id}] ${u.at} ${u.by} (${u.kind})\n${u.text}\n${u.url}`;
    groups.set(key, [...(groups.get(key) ?? []), text]);
  }
  const items = [...groups.entries()].map(([root, texts]) => `### thread ${root}\n\n${texts.join("\n\n")}`);
  return `${await skill("attribute.md")}\n\n# Features\n\n${await featureSummaries(features)}\n\n# Unplaced (${unplaced.length} messages in ${groups.size} threads)\n\n${items.join("\n\n")}\n\nAnswer with the JSON object only, one entry per message id.`;
}

/** the reader's prompt for one feature and its slice */
export async function readerPrompt(feature: string, slice: Slice, day: string): Promise<string> {
  const ledger = await readLedger(feature);
  if (!ledger) throw new Error(`${feature}: no ledger`);
  const archFile = Bun.file(archDocPath(feature));
  const arch = (await archFile.exists()) ? archExcerpt(await archFile.text()) : "(no arch doc)";
  return [
    await skill("reader.md"),
    await skill("shapes.md"),
    `# The feature: ${feature}`,
    `# ledger.json as it stands (code pointers omitted)\n\n\`\`\`json\n${ledgerForReader(ledger)}\n\`\`\``,
    `# What is new (${day})\n\n${renderSlice(slice)}`,
    `# From docs/arch.md\n\n${arch}`,
    `Today is ${day}. Return the patch as one JSON object in a \`\`\`json fence, nothing else.`,
  ].join("\n\n");
}

/** the slice for one feature out of a placed batch, or null */
export const sliceOf = (placed: Placed, feature: string): Slice | null => placed.slices.find((s) => s.feature === feature) ?? null;
