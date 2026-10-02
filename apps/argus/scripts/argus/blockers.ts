/**
 * The blockers code can clear, and the deploys code can record. A landing on a repo read by
 * pipeline carries its finished pipeline once Bitbucket has one (`recordDeploys`); until
 * then every run asks again, so a merge read while its pipeline ran is not "not deployed"
 * for good.
 *
 * A `landing` blocker clears when the landing it names is on the ledger and live, by its
 * repo's own deploy source — merged, for a repo live when merged; deployed, for one read by
 * pipeline — the same rule ticket settling uses below; a `ticket` blocker clears when every
 * ask the named ticket serves is closed. An `answer` blocker is a person's to clear, through
 * the reader or a click. `argus reconcile` runs this over every ledger after a batch is
 * placed.
 *
 * It also finishes what a ticket opened, from two facts:
 *
 * - Its provider. A ticket its provider reports Done is settled `done`, and every open ask
 *   it serves closes with the ticket as evidence; Canceled settles it `dropped` and drops
 *   them. Each provider is read once per run for every ticket still open, through the
 *   tickets package's router (`@citadel/tickets`), which routes a key to the provider its
 *   prefix names — `CTD` and `ALD` to Linear, `AP` to the Alden Trello board — and never
 *   writes; each report line names the provider the state came from.
 * - A landing. An open ask whose ticket's key is on a landing (every Foundry branch carries
 *   it) moves to `built` with the PR as evidence, and to `closed` once that landing is live:
 *   on a repo live when merged (alden-portal's `fe`, base branch `staging`), a merge is
 *   live; on one read by pipeline (alden-portal's `be`, `dev`), once the pipeline succeeded.
 *   A ticket that serves no ask (filed from a gap, not a message) has nothing to close, so
 *   the same live landing settles the ticket itself.
 *
 * Before either, a card the Slack ticket bot already made. Someone reacts :ticket: on a
 * message and the "SWE Slack To Trello" bot files a card whose description links that
 * message; an open ask with no ticket, raised by that message (its origin or a Slack
 * evidence url, matched on channel and ts), gets the card as its ticket, and its proposal
 * goes — the card is the ticket, so nothing is left to file twice (`linkSlackTickets`).
 */

import { providerLabel, ticketStates, trelloSlackSources, type SlackSourcedCard, type TicketStates } from "@citadel/tickets";
import type { Deploy } from "./deploy.ts";
import { deployedAt, pipelineRepo } from "./deploy.ts";
import { ticketKeysIn } from "./pr-facts.ts";
import { loadProjects, recordFeatures, recordRepos, type ProjectRepo } from "./projects.ts";
import type { Blocker, Evidence, Landing, Ledger, Ticket } from "./schema.ts";
import { cancelRevision, foldRevision, listRevisions, type Settled } from "./revision.ts";
import { readLedger, writeLedger, type WriteResult } from "./write.ts";

export type DeployedOf = (repo: string, sha: string) => Promise<Deploy | null>;

/** every record repo's own config, by id — repo ids are unique across every project (ledger S-21) */
export type RepoConfig = Record<string, ProjectRepo>;

export async function loadRepoConfig(): Promise<RepoConfig> {
  return Object.fromEntries(recordRepos(await loadProjects()).map((r) => [r.id, r]));
}

/** `deployed`, built from each repo's own slug and branch; unknown repos answer null, never asked */
export const defaultDeployedOf =
  (repos: RepoConfig): DeployedOf =>
  (repo, sha) => {
    const r = repos[repo];
    return r ? deployedAt(pipelineRepo(r), sha) : Promise.resolve(null);
  };

const day = (iso: string) => iso.slice(0, 10);
const unknown: TicketStates = () => ({ state: "unknown" });

export type Reconciled = { ledger: Ledger; cleared: string[] };

/** a deploy this old when first recorded is history, not news for the reader */
const NEWS_DAYS = 7;

/** true when a repo's deploy source is read by pipeline; an unlisted repo reads as live, as it always has */
const byPipeline = (repos: RepoConfig, repoId: string): boolean => repos[repoId]?.deploy.kind === "pipeline";

/** true for a landing on a repo read by pipeline whose pipeline has not been seen to finish */
export const awaitsDeploy = (repos: RepoConfig, ld: Landing): boolean => byPipeline(repos, ld.repo) && !ld.deployed;

/**
 * Mutates `l`: every landing on a repo read by pipeline still waiting gets its finished
 * pipeline, if there is one now, and one line per landing that got one. A recent one is
 * marked untold, so the next reader rewrites whatever the ledger says about it.
 */
export async function recordDeploys(l: Ledger, deployed: DeployedOf, repos: RepoConfig, now = new Date()): Promise<string[]> {
  const out: string[] = [];
  const recent = new Date(now.getTime() - NEWS_DAYS * 86_400_000).toISOString();
  for (const ld of l.landings) {
    if (!awaitsDeploy(repos, ld)) continue;
    const d = await deployed(ld.repo, ld.sha);
    if (!d) continue;
    ld.deployed = { ...d, told: ld.at < recent };
    const branch = repos[ld.repo]?.baseBranch ?? ld.repo;
    out.push(d.result === "SUCCESSFUL" ? `${ld.ref}: deployed to ${branch} (${day(d.at)}, build ${d.build})` : `${ld.ref}: ${branch} pipeline ${d.result.toLowerCase()} (build ${d.build})`);
  }
  return out;
}

/** `<channel>/<ts>` out of a Slack permalink, whatever its host or query; null for anything else */
export function slackMessageOf(url: string): string | null {
  const m = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(url);
  return m ? `${m[1]}/${m[2]}.${m[3]}` : null;
}

/**
 * Mutates `l`: every open ask with no ticket whose Slack message a card names gets that
 * card as its ticket — one ticket per card, however many asks it raised — and leaves every
 * proposal; a proposal it was the last ask of is dropped. One line per card linked.
 */
export function linkSlackTickets(l: Ledger, sources: SlackSourcedCard[]): string[] {
  if (!sources.length) return [];
  const byMessage = new Map(sources.map((c) => [`${c.channel}/${c.ts}`, c]));
  const linked = new Map<string, { card: SlackSourcedCard; asks: string[] }>();
  for (const a of l.asks) {
    if (a.ticket || a.status === "closed" || a.status === "dropped") continue;
    const urls = [
      ...("url" in a.origin ? [a.origin.url] : []),
      ...a.history.flatMap((h) => h.evidence.flatMap((e) => (e.kind === "slack" ? [e.url] : []))),
    ];
    const card = urls.map((u) => byMessage.get(slackMessageOf(u) ?? "")).find((c) => c);
    if (!card) continue;
    a.ticket = card.key;
    const entry = linked.get(card.key) ?? { card, asks: [] };
    entry.asks.push(a.id);
    linked.set(card.key, entry);
  }
  const out: string[] = [];
  for (const { card, asks } of linked.values()) {
    const t = l.tickets.find((x) => x.key === card.key);
    if (t) {
      t.asks = [...new Set([...t.asks, ...asks])];
    } else {
      const seen = new Set<string>();
      const blockers = l.asks
        .filter((a) => asks.includes(a.id))
        .flatMap((a) => (a.blockers ?? []).filter((b) => !b.cleared))
        .filter((b) => !seen.has(JSON.stringify(b)) && !!seen.add(JSON.stringify(b)))
        .map((b) => structuredClone(b));
      l.tickets.push({ key: card.key, title: card.title, asks, blockers, ready: blockers.length === 0 });
    }
    out.push(`${card.key}: ${asks.join(", ")} filed from Slack by the ticket bot, linked`);
  }
  const all = [...linked.values()].flatMap((x) => x.asks);
  if (all.length) {
    l.proposals = l.proposals.flatMap((p) => {
      if (!p.asks.some((id) => all.includes(id))) return [p];
      const asks = p.asks.filter((id) => !all.includes(id));
      if (!asks.length) {
        out.push(`${p.id}: dropped, its asks already have a card`);
        return [];
      }
      return [{ ...p, asks }];
    });
  }
  return out;
}

/** pure: the ledger with every clearable blocker cleared, and one line per clearance */
export async function reconcileLedger(l: Ledger, deployed: DeployedOf, repos: RepoConfig, now = new Date(), states: TicketStates = unknown): Promise<Reconciled> {
  const next: Ledger = structuredClone(l);
  const cleared: string[] = await recordDeploys(next, deployed, repos, now);
  /** the ledger's fact first; Bitbucket only for a landing still waiting on a repo read by pipeline */
  const deployOf = async (ld: Landing): Promise<Deploy | null> => ld.deployed ?? (byPipeline(repos, ld.repo) ? deployed(ld.repo, ld.sha) : null);
  const settledAsk = (id: string) => {
    const a = next.asks.find((x) => x.id === id);
    return !!a && (a.status === "closed" || a.status === "dropped");
  };
  const ticketDone = (key: string) => {
    const t = next.tickets.find((x) => x.key === key);
    return !!t && (t.settled?.outcome === "done" || (t.asks.length > 0 && t.asks.every(settledAsk)));
  };
  /** the asks a ticket serves: named on it, or pointing at it */
  const asksOf = (t: Ticket) => next.asks.filter((a) => t.asks.includes(a.id) || a.ticket === t.key);
  const keysOf = (ld: Landing) => ld.tickets ?? ticketKeysIn(ld.title);
  const evidenceOf = (ld: Landing): Evidence[] =>
    ld.url && ld.number ? [{ kind: "pr", repo: ld.repo, number: ld.number, url: ld.url }] : [{ kind: "commit", repo: ld.repo, sha: ld.sha }];
  const liveAt = async (ld: Landing): Promise<string | null> => {
    if (!byPipeline(repos, ld.repo)) return ld.at;
    const d = await deployOf(ld);
    return d?.result === "SUCCESSFUL" ? d.at : null;
  };
  const day0 = day(now.toISOString());
  /** a date that cannot precede the thing it follows is today */
  const notBefore = (at: string, floor: string) => (day(at) < day(floor) ? day0 : day(at));

  // its provider: Done settles the ticket and closes its asks; Canceled drops both
  for (const t of next.tickets) {
    if (t.settled) continue;
    const s = states(t.key);
    if (s.state !== "done" && s.state !== "canceled") continue;
    const outcome = s.state === "done" ? "done" : "dropped";
    const status = s.state === "done" ? "closed" : "dropped";
    const evidence: Evidence[] = [{ kind: "ticket", key: t.key, url: s.url }];
    t.settled = { outcome, at: day(s.at), evidence };
    cleared.push(`${t.key}: ${s.name} in ${providerLabel(s.provider)}, ${outcome}`);
    for (const a of asksOf(t)) {
      if (a.status === "closed" || a.status === "dropped") continue;
      a.status = status;
      a.history.push({ at: notBefore(s.at, a.at), status, evidence });
      cleared.push(`${a.id}: ${t.key} is ${s.name}, ${status}`);
    }
  }

  // a landing: an ask-less ticket is done once the landing carrying its key is live
  for (const t of next.tickets) {
    if (t.settled || asksOf(t).length > 0) continue;
    const ld = next.landings.find((x) => keysOf(x).includes(t.key));
    if (!ld) continue;
    const at = await liveAt(ld);
    if (!at) continue;
    t.settled = { outcome: "done", at: notBefore(at, ld.at), evidence: evidenceOf(ld) };
    cleared.push(`${t.key}: landed as ${ld.ref} and is live, done`);
  }

  const clear = async (b: Blocker, owner: string): Promise<void> => {
    if (b.cleared) return;
    if (b.kind === "landing") {
      const ld = next.landings.find((x) => x.ref === b.ref);
      if (!ld) return;
      const at = await liveAt(ld);
      if (!at) return;
      const pipeline = byPipeline(repos, ld.repo);
      if (pipeline) b.deployed = true;
      b.cleared = { at: day(at), evidence: evidenceOf(ld) };
      cleared.push(`${owner}: ${b.ref} is on ${b.branch} and ${pipeline ? "deployed" : "merged"} (${day(at)})`);
      return;
    }
    if (b.kind === "ticket" && ticketDone(b.key)) {
      b.cleared = { at: day0, evidence: [{ kind: "ticket", key: b.key }] };
      cleared.push(`${owner}: ${b.key} is done`);
    }
  };
  for (const t of next.tickets) for (const b of t.blockers) await clear(b, t.key);
  for (const a of next.asks) for (const b of a.blockers ?? []) await clear(b, a.id);

  // a landing: an ask whose ticket landed is built, and closed once the landing is live
  for (const a of next.asks) {
    if (!a.ticket || a.status === "closed" || a.status === "dropped") continue;
    const ld = next.landings.find((x) => keysOf(x).includes(a.ticket!));
    if (!ld) continue;
    const evidence = evidenceOf(ld);
    if (!ld.asks.includes(a.id)) ld.asks.push(a.id);
    if (a.status !== "built" && a.status !== "acknowledged") {
      a.status = "built";
      a.history.push({ at: day(ld.at), status: "built", evidence });
      cleared.push(`${a.id}: ${a.ticket} landed as ${ld.ref}`);
    }
    const live = await liveAt(ld);
    if (live) {
      a.status = "closed";
      a.history.push({ at: notBefore(live, ld.at), status: "closed", evidence });
      cleared.push(`${a.id}: ${a.ticket} is live, closed`);
    }
  }
  return { ledger: next, cleared };
}

/** one ledger reconciled, or one revision settled (`feature` is then `revisions/<KEY>`) */
export type ReconcileResult = { feature: string; cleared: string[]; write: WriteResult | null; revision?: Settled; error?: string };

export type ReconcileOptions = {
  deployed?: DeployedOf;
  /** every record repo's own config, by id; default reads it from `projects.json` */
  repos?: RepoConfig;
  /** the tickets router; default asks each ticket's provider once for every open ticket across the run */
  states?: (keys: string[]) => Promise<TicketStates>;
  /** the cards the Slack ticket bot made; default reads them off the Alden Trello board once per run */
  sources?: () => Promise<SlackSourcedCard[]>;
  dryRun?: boolean;
  now?: Date;
  features?: string[];
};

/** true when the ledger holds anything reconcile could move */
export function needsReconcile(l: Ledger, repos: RepoConfig): boolean {
  const open = (bs: Blocker[]) => bs.some((b) => !b.cleared);
  return (
    l.landings.some((ld) => awaitsDeploy(repos, ld)) ||
    l.tickets.some((t) => !t.settled) ||
    l.asks.some((a) => a.ticket && a.status !== "closed" && a.status !== "dropped") ||
    l.tickets.some((t) => open(t.blockers)) ||
    l.asks.some((a) => open(a.blockers ?? []))
  );
}

/** every ledger, blockers cleared and tickets settled where the facts allow, written when something changed */
export async function reconcileAll(opts: ReconcileOptions = {}): Promise<ReconcileResult[]> {
  const config = await loadProjects();
  const repos = opts.repos ?? Object.fromEntries(recordRepos(config).map((r) => [r.id, r]));
  const deployed = opts.deployed ?? defaultDeployedOf(repos);
  // named features are the caller's own (DEFAULT_APP, as `argus reconcile <feature>...` takes them); with none
  // named, every project with the record job, each on its own area (ledger S-27)
  const targets = opts.features ? opts.features.map((feature) => ({ app: undefined, feature })) : await recordFeatures(config);
  /** read once, and only when some ledger has an ask a card could be the ticket of */
  let sources: SlackSourcedCard[] | undefined;
  const sourcesFor = async (l: Ledger) =>
    l.asks.some((a) => !a.ticket && a.status !== "closed" && a.status !== "dropped") ? (sources ??= await (opts.sources ?? (() => trelloSlackSources()))()) : [];
  const ledgers: [string, string | undefined, Ledger][] = [];
  /** the lines linking a bot's card wrote, by feature — they go out with that ledger's reconcile */
  const linkedLines = new Map<string, string[]>();
  for (const { app, feature } of targets) {
    const l = await readLedger(feature, app);
    if (!l) continue;
    const linked = linkSlackTickets(l, await sourcesFor(l));
    if (linked.length) linkedLines.set(`${app ?? ""}:${feature}`, linked);
    if (linked.length || needsReconcile(l, repos)) ledgers.push([feature, app, l]);
  }
  // the filed revisions, whose parents settle them — only on a whole run, never one scoped to named features
  const filed = opts.features ? [] : (await listRevisions()).filter((r) => !r.archived && r.rev.status === "filed" && r.rev.key);
  const openKeys = [
    ...new Set([...ledgers.flatMap(([, , l]) => l.tickets.filter((t) => !t.settled).map((t) => t.key)), ...filed.map((r) => r.rev.key!)]),
  ];
  const states = await (opts.states ?? ((keys) => ticketStates(keys, { now: opts.now })))(openKeys);
  const out: ReconcileResult[] = [];
  for (const [feature, app, l] of ledgers) {
    const r = await reconcileLedger(l, deployed, repos, opts.now, states);
    r.cleared.unshift(...(linkedLines.get(`${app ?? ""}:${feature}`) ?? []));
    if (!r.cleared.length) continue;
    const write = await writeLedger(feature, r.ledger, { actor: "model", now: opts.now, dryRun: opts.dryRun, app });
    out.push({ feature, cleared: r.cleared, write });
  }
  // a revision follows its parent: Done folds its specs into the features and archives it; Canceled archives it
  for (const r of filed) {
    const key = r.rev.key!;
    const s = states(key);
    if (s.state !== "done" && s.state !== "canceled") continue;
    const feature = `revisions/${key}`;
    try {
      const o = { now: opts.now, dryRun: opts.dryRun, url: s.url };
      const settled = s.state === "done" ? await foldRevision(r, o) : await cancelRevision(r, o);
      const retired = settled.retired.length ? `; ${settled.retired.length} product doc(s) retired` : "";
      const label = providerLabel(s.provider);
      const line =
        settled.to === "done"
          ? `${key}: ${s.name} in ${label} — folded into ${settled.features.join(", ") || "no spec"}${retired}; archived as done`
          : `${key}: ${s.name} in ${label} — archived as dropped`;
      out.push({ feature, cleared: [line], write: null, revision: settled });
    } catch (e) {
      out.push({ feature, cleared: [], write: null, error: `${key}: not settled — ${(e as Error).message}` });
    }
  }
  return out;
}
