/**
 * `argus place <batch>`: the deterministic joins, and nothing the model would do better.
 *
 * A landing goes to every feature its files map to (pr-facts did the mapping). A message
 * goes where its thread root went (`state/threads.json`), else to the ledger that lists a
 * ticket key or PR it names, else to the feature a landing in this batch with the same
 * ticket key went. A reply follows its root within the batch. Everything else goes to
 * `state/unplaced.json` with the features that were active in the batch as candidates.
 *
 * Which keys and PRs join comes from `projects.json` (CTD-275): a ticket key matches any
 * prefix a record project's tracker owns (ingest S-11), and a PR reference names the one
 * project that declares its repo, by `<repo id>#N` or by the PR's URL (S-12) — a join wins
 * wherever the message was posted. What no join places is bounded by its channel: its
 * candidates are the features of the projects that channel carries (S-9, S-10).
 * The same batch placed twice gives the same placed file, byte for byte.
 *
 * Every placing also records the backend deploys that finished since the last run
 * (`recordDeploys`), and a feature with one no reader has seen gets a slice carrying it,
 * with or without anything new in the batch, so its prose catches up the same sweep.
 */

import { type Batch, type Placed, placedPath, readBatch, type Slice, type SliceDeploy } from "./batch.ts";
import { defaultDeployedOf, type DeployedOf, loadRepoConfig, recordDeploys, type RepoConfig } from "./blockers.ts";
import type { Landing } from "./pr-facts.ts";
import { defaultProjectsConfig, loadProjects, type ProjectsConfig, recordAreas, recordFeatures, recordRepos } from "./projects.ts";
import type { Ledger } from "./schema.ts";
import { flatten, type Msg } from "./slack-pull.ts";
import { readThreads, readUnplaced, type ThreadMap, type Unplaced, writeThreads, writeUnplaced } from "./state.ts";
import { applyPatch } from "./patch.ts";
import { readLedger, writeLedger } from "./write.ts";

export type PlaceOptions = {
  now?: Date;
  dryRun?: boolean;
  outDir?: string;
  ledgers?: Map<string, Ledger>;
  /** which app (area) each ledger's feature belongs to; unset defaults every feature to DEFAULT_APP, as before this feature */
  appOf?: Map<string, string>;
  threads?: ThreadMap;
  deployed?: DeployedOf;
  repos?: RepoConfig;
  config?: ProjectsConfig;
};

/** what the joins and the candidates read from `projects.json` */
export type PlaceContext = {
  /** every ticket key prefix a record project's tracker owns */
  prefixes: string[];
  /** every record repo: its id, its project, and the `<owner>/<repo>` its clone URL names */
  repos: { id: string; project: string; slug: string | null }[];
  /** the projects each configured channel carries */
  channels: Record<string, string[]>;
  /** each record feature's project */
  projectOf: Map<string, string>;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slugOf = (url: string) => url.match(/(?:bitbucket\.org|github\.com)[/:]([^/\s]+\/[^/\s.]+)/i)?.[1]?.toLowerCase() ?? null;

export function placeContext(config: ProjectsConfig, features: { app: string; feature: string }[]): PlaceContext {
  const projectOfApp = new Map(recordAreas(config).map((a) => [a.dir, a.project]));
  return {
    prefixes: [...new Set(config.projects.filter((p) => p.jobs.includes("record")).flatMap((p) => p.trackers.flatMap((t) => t.prefixes)))],
    repos: recordRepos(config).map((r) => ({ id: r.id, project: r.project, slug: slugOf(r.cloneUrl) })),
    channels: Object.fromEntries(config.channels.map((c) => [c.id, c.projects])),
    projectOf: new Map(features.map((f) => [f.feature, projectOfApp.get(f.app) ?? ""])),
  };
}

/** alden-portal's own context, for a caller that names no config: every feature is its */
const defaultContext = (features: string[]): PlaceContext => ({
  ...placeContext(defaultProjectsConfig(), []),
  projectOf: new Map(features.map((f) => [f, "alden-portal"])),
});

/** the features a message from `channel` may be placed on by the model; null when its channel names no projects */
export function featuresOfChannel(ctx: PlaceContext, channel: string | undefined, features: string[]): string[] | null {
  const projects = channel ? ctx.channels[channel] : undefined;
  if (!projects) return null;
  return features.filter((f) => projects.includes(ctx.projectOf.get(f) ?? ""));
}

export type Keys = { tickets: Map<string, string>; prs: Map<string, string> };

/** ticket keys and PR refs → the feature whose ledger lists them */
export function keysOf(ledgers: Map<string, Ledger>): Keys {
  const tickets = new Map<string, string>();
  const prs = new Map<string, string>();
  for (const [feature, l] of ledgers) {
    for (const t of l.tickets) tickets.set(t.key, feature);
    for (const a of l.asks) {
      if (a.ticket) tickets.set(a.ticket, feature);
      for (const h of a.history) for (const e of h.evidence) if (e.kind === "pr") prs.set(`${e.repo}#${e.number}`, feature);
    }
    for (const t of l.tickets) for (const b of t.blockers) if (b.kind === "landing") prs.set(b.ref, feature);
    for (const ld of l.landings) prs.set(ld.ref, feature);
  }
  return { tickets, prs };
}

/**
 * The feature a message's own words point at through a key, or null. A ticket key is any
 * configured prefix (ingest S-11). A PR is `<repo id>#N`, a PR URL whose repo a project
 * declares, or a bare `PR #N` / unknown URL tried against the repos of the projects the
 * message's channel carries, else every record repo (S-12).
 */
export function featureByKey(text: string, keys: Keys, landingsByKey: Map<string, string[]>, ctx: PlaceContext = defaultContext([]), channel?: string): string | null {
  const lookup = (k: string) => keys.prs.get(k) ?? landingsByKey.get(k)?.[0] ?? null;
  if (ctx.prefixes.length) {
    const ticketRe = new RegExp(`\\b(${ctx.prefixes.map(escapeRe).join("|")})-\\d+\\b`, "g");
    for (const m of text.toUpperCase().matchAll(ticketRe)) {
      const hit = keys.tickets.get(m[0]) ?? landingsByKey.get(m[0])?.[0];
      if (hit) return hit;
    }
  }
  const carried = channel ? ctx.channels[channel] : undefined;
  const fallback = ctx.repos.filter((r) => !carried || carried.includes(r.project)).map((r) => r.id);
  // with no repos the id group matches nothing, so the groups below keep their numbers
  const ids = ctx.repos.map((r) => escapeRe(r.id)).join("|") || "(?!)";
  const prRe = new RegExp(`\\b(${ids})#(\\d+)\\b|https?:\\/\\/(?:www\\.)?(?:bitbucket\\.org|github\\.com)\\/([^/\\s]+\\/[^/\\s]+)\\/(?:pull-requests|pull)\\/(\\d+)|pull-requests\\/(\\d+)\\b|\\bPR\\s*#?(\\d+)\\b`, "gi");
  for (const m of text.matchAll(prRe)) {
    let candidates: string[];
    let n: string;
    if (m[1]) {
      candidates = [ctx.repos.find((r) => r.id.toLowerCase() === m[1]!.toLowerCase())!.id];
      n = m[2]!;
    } else if (m[3]) {
      const repo = ctx.repos.find((r) => r.slug === m[3]!.toLowerCase());
      candidates = repo ? [repo.id] : fallback;
      n = m[4]!;
    } else {
      candidates = fallback;
      n = (m[5] ?? m[6])!;
    }
    for (const id of candidates) {
      const hit = lookup(`${id}#${n}`);
      if (hit) return hit;
    }
  }
  return null;
}

export type Placement = { slices: Map<string, Slice>; unplaced: Unplaced[]; threads: ThreadMap };

/** pure: a batch, the ledgers and the thread map → slices, unplaced entries and new thread learnings */
export function placeBatch(batch: Batch, ledgers: Map<string, Ledger>, threads: ThreadMap, features: string[], now: Date, ctx: PlaceContext = defaultContext(features)): Placement {
  const slices = new Map<string, Slice>();
  const slice = (f: string) => {
    if (!slices.has(f)) slices.set(f, { feature: f, messages: [], landings: [] });
    return slices.get(f)!;
  };
  const keys = keysOf(ledgers);
  const learned: ThreadMap = {};
  const at = now.toISOString();

  // landings first: they seed the keys a message may name
  const landingsByKey = new Map<string, string[]>();
  for (const l of batch.landings) {
    for (const f of l.features) slice(f).landings.push(l);
    if (l.features.length) {
      landingsByKey.set(l.ref, l.features);
      for (const k of l.ticketKeys) if (!landingsByKey.has(k)) landingsByKey.set(k, l.features);
    }
  }

  const unplaced: Unplaced[] = [];
  const messages = batch.slack ? flatten(batch.slack) : [];
  const placedThread = new Map<string, string>();
  /**
   * Huddle notes are their own thread. Slackbot posts them as a reply under its "huddle
   * started" message, which is chat a reader dismisses before the notes exist; and a
   * meeting covers several features, so it never follows the root's placement either.
   */
  const threadOf = (m: Msg) => (m.canvas ? m.ts : m.thread);
  const resolveThread = (m: Msg) => threads[threadOf(m)]?.feature ?? learned[threadOf(m)]?.feature ?? placedThread.get(threadOf(m)) ?? null;
  /** the user said this thread belongs to no feature: its messages are neither sliced nor unplaced */
  const nobodys = (m: Msg) => threadOf(m) in threads && threads[threadOf(m)]!.feature === null;

  for (const m of messages) {
    if (nobodys(m)) continue;
    const byThread = resolveThread(m);
    const feature = byThread ?? featureByKey(m.text, keys, landingsByKey, ctx, m.channel);
    if (feature) {
      slice(feature).messages.push(m);
      if (!byThread) {
        placedThread.set(threadOf(m), feature);
        if (!threads[threadOf(m)]) learned[threadOf(m)] = { feature, by: "sweep", at };
      }
    } else {
      unplaced.push({
        id: m.ts,
        kind: "message",
        ...(threadOf(m) !== m.ts ? { thread: threadOf(m) } : {}),
        ...(m.channel ? { channel: m.channel } : {}),
        by: m.author,
        at: m.date,
        text: m.canvas ? `${m.text}\n\n${m.canvas}` : m.text,
        url: m.permalink,
        candidates: [],
        batch: batch.id,
      });
    }
  }
  // a reply placed by key after its root was unplaced: pull the root along
  for (const u of [...unplaced]) {
    const f = u.kind === "message" ? placedThread.get(u.thread ?? u.id) : undefined;
    if (f) {
      const m = messages.find((x) => x.ts === u.id)!;
      slice(f).messages.push(m);
      unplaced.splice(unplaced.indexOf(u), 1);
      if (u.id === (u.thread ?? u.id) && !threads[u.id]) learned[u.id] = { feature: f, by: "sweep", at };
    }
  }
  // an unmapped landing the user placed or dismissed is remembered under its ref
  for (const l of batch.landings) {
    if (l.features.length) continue;
    const told = threads[l.ref];
    if (told?.feature) slice(told.feature).landings.push(l);
    else if (!told)
      unplaced.push({ id: l.ref, kind: "landing", by: l.by, at: l.date, text: `${l.title}\n${l.files.join("\n")}`, url: l.url ?? "", candidates: [], batch: batch.id });
  }

  const active = [...slices.keys()].sort();
  for (const u of unplaced) {
    // a message is bounded by its channel's projects; a landing, or a channel naming none, by every feature
    const allowed = featuresOfChannel(ctx, u.channel, features) ?? features;
    const live = active.filter((f) => allowed.includes(f));
    u.candidates = live.length ? live : allowed;
  }
  for (const s of slices.values()) {
    s.messages.sort((a, b) => Number(a.ts) - Number(b.ts));
    s.landings.sort((a, b) => a.at.localeCompare(b.at));
  }
  return { slices: new Map([...slices].sort(([a], [b]) => a.localeCompare(b))), unplaced, threads: learned };
}

async function loadLedgers(): Promise<{ ledgers: Map<string, Ledger>; appOf: Map<string, string> }> {
  const ledgers = new Map<string, Ledger>();
  const appOf = new Map<string, string>();
  for (const { app, feature } of await recordFeatures()) {
    const l = await readLedger(feature, app);
    if (l) {
      ledgers.set(feature, l);
      appOf.set(feature, app);
    }
  }
  return { ledgers, appOf };
}

export async function place(idOrPath: string, opts: PlaceOptions = {}): Promise<Placed> {
  const now = opts.now ?? new Date();
  const batch = await readBatch(idOrPath);
  const loaded = opts.ledgers ? { ledgers: opts.ledgers, appOf: opts.appOf ?? new Map<string, string>() } : await loadLedgers();
  const { ledgers, appOf } = loaded;
  const threads = opts.threads ?? (await readThreads());
  const config = opts.config ?? (await loadProjects());
  const recorded = await recordFeatures(config);
  const features = recorded.map((x) => x.feature);
  const p = placeBatch(batch, ledgers, threads, features, now, placeContext(config, recorded));
  const repos = opts.repos ?? (await loadRepoConfig());
  const deployed = opts.deployed ?? defaultDeployedOf(repos);
  const current = new Map(ledgers);
  const writes: [string, Ledger][] = [];
  // code owns the landings: every slice's new landings go onto its ledger now, so the
  // reader only ever links them to asks; a deploy recorded for one is told by the slice
  for (const s of p.slices.values()) {
    const l = current.get(s.feature) ?? (await readLedger(s.feature, appOf.get(s.feature)));
    if (!l || !s.landings.length) continue;
    const fresh = s.landings
      .filter((ld) => !l.landings.some((x) => x.ref === ld.ref))
      .map((ld) => ({ at: ld.at, repo: ld.repo, ref: ld.ref, number: ld.number, sha: ld.sha, title: ld.title, by: ld.by, url: ld.url, asks: [], files: ld.files, tickets: ld.ticketKeys }));
    current.set(s.feature, fresh.length ? applyPatch(l, { landings: { add: fresh } }) : l);
  }
  for (const [feature, l] of current) {
    const next = structuredClone(l);
    await recordDeploys(next, deployed, repos, now);
    const inSlice = new Set(p.slices.get(feature)?.landings.map((ld) => ld.ref));
    const deploys: SliceDeploy[] = [];
    for (const ld of next.landings) {
      if (!ld.deployed || ld.deployed.told) continue;
      if (inSlice.has(ld.ref)) ld.deployed.told = true;
      else {
        const { told: _t, ...deploy } = ld.deployed;
        deploys.push({ ref: ld.ref, title: ld.title, landed: ld.at, deploy });
      }
    }
    if (deploys.length) {
      if (!p.slices.has(feature)) p.slices.set(feature, { feature, messages: [], landings: [] });
      p.slices.get(feature)!.deploys = deploys;
    }
    if (JSON.stringify(next) !== JSON.stringify(ledgers.get(feature))) writes.push([feature, next]);
  }
  const slices = [...p.slices.values()].sort((a, b) => a.feature.localeCompare(b.feature));
  const placed: Placed = { batch: batch.id, placed_at: now.toISOString(), slices, unplaced: p.unplaced.map((u) => u.id) };
  if (!opts.dryRun) {
    for (const [feature, next] of writes) await writeLedger(feature, next, { actor: "model", now, app: appOf.get(feature) });
    await Bun.write(placedPath(batch.id, opts.outDir ?? (idOrPath.endsWith(".json") ? idOrPath.replace(/[^/]+$/, "").replace(/\/$/, "") : undefined)), JSON.stringify(placed, null, 2) + "\n");
    if (Object.keys(p.threads).length) await writeThreads({ ...threads, ...p.threads });
    const existing = await readUnplaced();
    const ids = new Set(existing.map((u) => u.id));
    const merged = [...existing.filter((u) => !isNobodys(u, threads) && (!p.slices.size || !isPlacedNow(u, p))), ...p.unplaced.filter((u) => !ids.has(u.id))];
    await writeUnplaced(merged);
  }
  return placed;
}

/** an older unplaced message whose thread this batch taught is placed too */
const isPlacedNow = (u: Unplaced, p: Placement) => u.kind === "message" && (u.thread ?? u.id) in p.threads;

/** an older unplaced message whose thread the user has since dismissed leaves the list too */
const isNobodys = (u: Unplaced, threads: ThreadMap) => u.kind === "message" && (u.thread ?? u.id) in threads && threads[u.thread ?? u.id]!.feature === null;
