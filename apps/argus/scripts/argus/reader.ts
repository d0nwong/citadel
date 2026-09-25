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
import { loadRepoConfig } from "./blockers.ts";
import { type Check, type Deploy, deployCheck, pipelineRepo, type PipelineRepo } from "./deploy.ts";
import { isGrounded } from "./grounding.ts";
import { featureDirOf, loadManifest, type Manifest } from "./manifest.ts";
import { archDocPath, REPO_ROOT } from "./paths.ts";
import { fetchOrigin, REPOS, repoOf, repoPath } from "./pr-facts.ts";
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

export function renderSlice(s: Slice, deploys: Record<string, string> = {}): string {
  const landings = s.landings
    .map((l) => {
      const files = `${l.files.slice(0, 40).join(", ")}${l.files.length > 40 ? ` (+${l.files.length - 40})` : ""}`;
      const tickets = l.ticketKeys.length ? `\ntickets: ${l.ticketKeys.join(", ")}` : "";
      const routes = l.routes.length ? `\nroutes: ${l.routes.join(", ")}` : "";
      const deployed = deploys[l.ref] ? `\ndeployed: ${deploys[l.ref]}` : "";
      return `[${l.ref}] ${l.date} ${l.by} ${l.url ?? ""}\n${l.title}${tickets}\nsha ${l.sha}${deployed}\nfiles: ${files}${routes}`;
    })
    .join("\n\n");
  const finished = (s.deploys ?? [])
    .map((d) => `[${d.ref}] landed ${d.landed.slice(0, 10)}: ${d.title}\n${deployWords(d.deploy)}, build ${d.deploy.build} ${d.deploy.url}`)
    .join("\n\n");
  const earlier = finished ? `\n\n## Earlier landings whose deploy finished (${s.deploys!.length})\n\n${finished}` : "";
  return `## Messages (${s.messages.length})\n\n${renderMessages(s.messages) || "none"}\n\n## Landings (${s.landings.length})\n\n${landings || "none"}${earlier}`;
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

/** a cache of one app's manifest, loaded at most once per call site */
function manifestCache(): (app: string) => Promise<Manifest | null> {
  const manifests = new Map<string, Manifest | null>();
  return async (app: string) => {
    if (!manifests.has(app)) manifests.set(app, await loadManifest(app).catch(() => null));
    return manifests.get(app)!;
  };
}

/** one feature's summary: name, routes, a few aliases, the ledger's summary and open asks — no leading bullet */
async function summaryLine(app: string, feature: string, manifestFor: (app: string) => Promise<Manifest | null>): Promise<string> {
  const manifest = await manifestFor(app);
  const byDir = new Map(manifest?.features.map((mf) => [featureDirOf(mf), mf]) ?? []);
  const m = byDir.get(feature);
  const l = await readLedger(feature, app);
  const head = [
    m?.name,
    m?.entry_routes.length ? `routes ${m.entry_routes.slice(0, 3).join(" ")}` : "",
    m?.aliases.length ? `also called: ${m.aliases.slice(0, 8).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const asks = (l?.asks ?? []).filter((a) => a.status !== "closed" && a.status !== "dropped").map((a) => `    - open: ${a.text}`);
  return `${feature}${head ? ` - ${head}` : ""}${l?.summary ? `\n    ${l.summary}` : ""}${asks.length ? `\n${asks.join("\n")}` : ""}`;
}

/** one line per feature: name, routes, a few aliases, the ledger's summary and open asks */
export async function featureSummaries(features: { app: string; feature: string }[]): Promise<string> {
  const manifestFor = manifestCache();
  const out: string[] = [];
  for (const { app, feature } of features) out.push(`- ${await summaryLine(app, feature, manifestFor)}`);
  return out.join("\n");
}

/** the same per-feature summaries, structured as a suggestion Choice's options (AC2, CTD-289) */
export async function featureOptions(features: { app: string; feature: string }[]): Promise<{ feature: string; description: string }[]> {
  const manifestFor = manifestCache();
  const out: { feature: string; description: string }[] = [];
  for (const { app, feature } of features) out.push({ feature, description: await summaryLine(app, feature, manifestFor) });
  return out;
}

/**
 * The attribution step's prompt: the skill, the features (every project with the record
 * job, ledger S-27), the unplaced messages grouped by thread. With `projectsOf`, each
 * thread names the projects its channel carries, the only ones it may go to (ingest S-9).
 */
export async function attributePrompt(
  unplaced: Unplaced[],
  features: { app: string; feature: string }[],
  batch: Batch | null,
  projectsOf?: (u: Unplaced) => string[] | undefined,
): Promise<string> {
  const all = batch?.slack ? flatten(batch.slack) : [];
  const byId = new Map(all.map((m) => [m.ts, m]));
  const groups = new Map<string, string[]>();
  const bound = new Map<string, string[]>();
  for (const u of unplaced) {
    const m = byId.get(u.id);
    const key = m ? m.thread : (u.thread ?? u.id);
    const projects = projectsOf?.(u);
    if (projects) bound.set(key, projects);
    const text = m ? renderMessages([m]) : `[${u.id}] ${u.at} ${u.by} (${u.kind})\n${u.text}\n${u.url}`;
    groups.set(key, [...(groups.get(key) ?? []), text]);
  }
  const items = [...groups.entries()].map(([root, texts]) => {
    const projects = bound.get(root);
    return `### thread ${root}${projects ? ` (only features of ${projects.join(", ")})` : ""}\n\n${texts.join("\n\n")}`;
  });
  return `${await skill("attribute.md")}\n\n# Features\n\n${await featureSummaries(features)}\n\n# Unplaced (${unplaced.length} messages in ${groups.size} threads)\n\n${items.join("\n\n")}\n\nAnswer with the JSON object only, one entry per message id.`;
}

const deployWords = (d: Deploy) => (d.result === "SUCCESSFUL" ? `deployed to dev ${d.at.slice(0, 10)}` : `not deployed: the dev pipeline ${d.result.toLowerCase()}`);

/** each backend landing's deploy, in words the reader can act on; the cache answers first */
export async function deploysFor(slice: Slice, lookup: (repo: PipelineRepo, sha: string) => Promise<Check> = deployCheck): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const be = (await loadRepoConfig())["be"];
  for (const l of slice.landings) {
    if (l.repo !== "be" || !be) continue;
    const repo = pipelineRepo(be);
    try {
      const c = await lookup(repo, l.sha);
      out[l.ref] =
        c.state === "done"
          ? c.deploy.result === "SUCCESSFUL"
            ? `yes, ${c.deploy.at.slice(0, 10)} (on ${be.baseBranch})`
            : `no, the pipeline ${c.deploy.result.toLowerCase()}`
          : c.state === "running"
            ? "not yet, the pipeline is running; argus reports when it finishes"
            : c.state === "not-found"
              ? "not yet, no pipeline has started; argus reports when one finishes"
              : `unknown (${c.why})`;
    } catch {
      out[l.ref] = "unknown";
    }
  }
  return out;
}

/** the reader's prompt for one feature and its slice */
export async function readerPrompt(feature: string, slice: Slice, day: string, deploys?: Record<string, string>): Promise<string> {
  const ledger = await readLedger(feature);
  if (!ledger) throw new Error(`${feature}: no ledger`);
  const archFile = Bun.file(archDocPath(feature));
  const arch = (await archFile.exists()) ? archExcerpt(await archFile.text()) : "(no arch doc)";
  return [
    await skill("reader.md"),
    await skill("shapes.md"),
    `# The feature: ${feature}`,
    `# ledger.json as it stands (code pointers omitted)\n\n\`\`\`json\n${ledgerForReader(ledger)}\n\`\`\``,
    `# What is new (${day})\n\n${renderSlice(slice, deploys ?? (await deploysFor(slice)))}`,
    `# From docs/arch.md\n\n${arch}`,
    `Today is ${day}. Return the patch as one JSON object in a \`\`\`json fence, nothing else.`,
  ].join("\n\n");
}

/** every proposal on the named ledgers whose Technical Notes do not yet point at code */
export async function ungroundedProposals(features: string[]): Promise<{ feature: string; id: string }[]> {
  const out: { feature: string; id: string }[] = [];
  for (const feature of features) for (const p of (await readLedger(feature))?.proposals ?? []) if (!isGrounded(p.body)) out.push({ feature, id: p.id });
  return out;
}

/** a fresh pin: the checkouts are shared and their remote refs go stale between pulls */
const head = (kind: "fe" | "be") => {
  // offline, the fetch fails quietly and the stale ref is still a pin the Verified line names
  if (process.env.ARGUS_NO_FETCH !== "1") fetchOrigin(repoOf(kind));
  const r = Bun.spawnSync(["git", "-C", repoPath(kind), "rev-parse", "--short=9", REPOS[kind].ref]);
  return r.success ? r.stdout.toString().trim() : "unknown";
};

/** the grounding step's prompt: one proposal, what the ledger knows about where its asks live in code, and the pins */
export async function groundPrompt(feature: string, id: string): Promise<string> {
  const ledger = await readLedger(feature);
  if (!ledger) throw new Error(`${feature}: no ledger`);
  const p = ledger.proposals.find((x) => x.id === id);
  if (!p) throw new Error(`${feature}: no proposal ${id}`);
  const asks = ledger.asks.filter((a) => p.asks.includes(a.id));
  const reqIds = new Set(asks.flatMap((a) => a.requirements ?? []));
  const pointers = ledger.requirements
    .filter((r) => reqIds.has(r.id) && r.code?.length)
    .map((r) => `- ${r.id} ${r.text}\n${r.code!.map((c) => `  - ${c.repo} ${c.path}${c.line ? `:${c.line}` : ""} @ ${c.sha}`).join("\n")}`);
  return [
    await skill("ground.md"),
    `# FORMAT.md\n\n${await Bun.file(join(REPO_ROOT, "skills/linear-ticket/FORMAT.md")).text()}`,
    `# The proposal: ${feature} ${p.id}\n\nTitle: ${p.title}\n\n${p.body}`,
    `# The asks it serves\n\n${asks.map((a) => `- ${a.id} (${a.status}) ${a.text}`).join("\n") || "none"}`,
    `# Where the ledger already says the code is\n\n${pointers.join("\n") || "nothing recorded; find it with accio"}`,
    `# Pins\n\nfrontend ${repoPath("fe")} ${REPOS.fe.ref}@${head("fe")}\nbackend ${repoPath("be")} ${REPOS.be.ref}@${head("be")}\narch doc ${archDocPath(feature)}`,
    `Return the patch as one JSON object in a \`\`\`json fence, nothing else: { "proposals": { "update": [ { "id": "${p.id}", "body": "<the whole body>" } ] } }`,
  ].join("\n\n");
}

/** the slice for one feature out of a placed batch, or null */
export const sliceOf = (placed: Placed, feature: string): Slice | null => placed.slices.find((s) => s.feature === feature) ?? null;
