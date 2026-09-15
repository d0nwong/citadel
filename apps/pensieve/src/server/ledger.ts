/**
 * Node-only. Reads every feature's `ledger.json` under the workspace and argus's
 * `state/unplaced.json`, and derives the three lists the home page shows. Everything
 * takes its roots and directories so a test can point it at a temp workspace without
 * touching `WORKSPACE_DIR`, which is fixed at module load and shared across suites.
 *
 * A ledger that will not parse is reported beside the ones that did, never thrown: one
 * bad file must not take the page down.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TicketState, TicketStates } from "@citadel/tickets";
import {
  type Ask,
  type Ledger,
  onYou,
  readyAsks,
  readyTickets,
  type Ticket,
  type Unplaced,
} from "#/lib/ledger";
import type { FiledTicketRow } from "./ask";
import { type AppRoot, listApps, WORKSPACE_DIR } from "./workspace";

export const LEDGER_FILE = "ledger.json";
export const UNPLACED_FILE = join(WORKSPACE_DIR, "state", "unplaced.json");

export interface LedgerRef {
  /** `alden/alden-portal` */
  app: string;
  /** `admin/invoicing` */
  dir: string;
  /** `alden/alden-portal/admin/invoicing`, the route param */
  feature: string;
  ledger: Ledger;
}

export interface LedgerProblem {
  app: string;
  dir: string;
  problem: string;
}

export interface Ledgers {
  ledgers: LedgerRef[];
  problems: LedgerProblem[];
}

const dirsIn = async (p: string): Promise<string[]> =>
  (await readdir(p, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

/** every ledger under every app's `features/`, nested one level, sorted by feature */
export async function listLedgers(roots?: AppRoot[]): Promise<Ledgers> {
  const apps = roots ?? (await listApps());
  const out: Ledgers = { ledgers: [], problems: [] };
  for (const { app, dir } of apps) {
    const candidates: string[] = [];
    for (const a of await dirsIn(dir)) {
      candidates.push(a);
      for (const b of await dirsIn(join(dir, a))) {
        candidates.push(`${a}/${b}`);
      }
    }
    for (const fdir of candidates) {
      const path = join(dir, fdir, LEDGER_FILE);
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        continue;
      }
      try {
        const ledger = JSON.parse(text) as Ledger;
        if (typeof ledger.feature !== "string" || !Array.isArray(ledger.asks)) {
          throw new Error("not a ledger");
        }
        out.ledgers.push({ app, dir: fdir, feature: `${app}/${fdir}`, ledger });
      } catch (e) {
        out.problems.push({ app, dir: fdir, problem: (e as Error).message });
      }
    }
  }
  out.ledgers.sort((a, b) => a.feature.localeCompare(b.feature));
  return out;
}

/** one ledger by its route param, or a bare dir when unique across apps */
export async function readLedger(
  feature: string,
  roots?: AppRoot[]
): Promise<LedgerRef | null> {
  const { ledgers } = await listLedgers(roots);
  return (
    ledgers.find((l) => l.feature === feature) ??
    (() => {
      const bare = ledgers.filter((l) => l.dir === feature);
      return bare.length === 1 ? bare[0] : null;
    })() ??
    null
  );
}

export async function readUnplaced(file = UNPLACED_FILE): Promise<Unplaced[]> {
  try {
    const list = JSON.parse(await readFile(file, "utf8")) as Unplaced[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export interface HomeAsk extends Ask {
  dir: string;
  feature: string;
}
export interface HomeTicket extends Ticket {
  /** set only when its provider could not say who it is assigned to (AC4) */
  assignee?: "unknown";
  dir: string;
  feature: string;
  /** the provider's own url, read alongside its state; unset when that read failed */
  url?: string;
}

/** Liam's own id on each provider — whose tickets and Pipeline cards are his to work on. */
export interface LiamIds {
  linear?: string | null;
  trello?: string | null;
}

/** one card on the Alden board's Pipeline or High Priority Pipeline list */
export interface PipelineCard {
  highPriority: boolean;
  key: string;
  state: TicketState;
  title: string;
}

const PROVIDER_LIAM_ID = (
  state: TicketState,
  liam: LiamIds
): string | null | undefined => {
  if (state.state === "unknown") {
    return;
  }
  if (state.provider === "linear") {
    return liam.linear;
  }
  if (state.provider === "trello") {
    return liam.trello;
  }
};

/**
 * Liam's or nobody's is `"keep"`; someone else's is `"drop"` (AC2); a state its provider
 * could not answer for, or whose owner we could not confirm, is `"unknown"` — kept, but
 * shown as unknown rather than hidden on a guess (AC4).
 */
/** the provider's own url, read alongside its state; unset when that read failed (AC3) */
const stateUrl = (state: TicketState): string | undefined =>
  state.state === "unknown" ? undefined : state.url;

function assigneeVerdict(
  state: TicketState,
  liam: LiamIds
): "keep" | "drop" | "unknown" {
  if (state.state === "unknown") {
    return "unknown";
  }
  if (!state.assignee) {
    return "keep";
  }
  const mine = PROVIDER_LIAM_ID(state, liam);
  if (!mine) {
    return "unknown";
  }
  return state.assignee.id === mine ? "keep" : "drop";
}

export interface FeatureSummary {
  as_of: string;
  dir: string;
  feature: string;
  health: string;
  onYou: number;
  open: number;
  proposals: number;
  ready: number;
  summary: string;
}

/** a ticket filed from Ask with no ledger, still open on Linear */
export type HomeFiledTicket = FiledTicketRow;

export interface HomeShell {
  features: FeatureSummary[];
  onYou: HomeAsk[];
  problems: LedgerProblem[];
  /** open asks whose wait is over */
  readyAsks: HomeAsk[];
  unplaced: Unplaced[];
}

export interface Home extends HomeShell {
  filed: HomeFiledTicket[];
  ready: HomeTicket[];
}

/**
 * The home page's shell: what is on you, what nobody could place, and one line per
 * feature — everything the ledgers alone can answer, no live ticket state. Fast, so the
 * page can paint this immediately while `home`'s ready/filed lists (below) are still out
 * asking Linear and Trello.
 */
export async function homeShell(
  roots?: AppRoot[],
  unplacedFile?: string
): Promise<HomeShell> {
  const { ledgers, problems } = await listLedgers(roots);
  const onYouAll: HomeAsk[] = [];
  const readyAsksAll: HomeAsk[] = [];
  const features: FeatureSummary[] = [];
  for (const { feature, dir, ledger } of ledgers) {
    const mine = onYou(ledger);
    for (const a of mine) {
      onYouAll.push({ ...a, dir, feature });
    }
    for (const a of readyAsks(ledger)) {
      readyAsksAll.push({ ...a, dir, feature });
    }
    features.push({
      as_of: ledger.as_of,
      dir,
      feature,
      health: ledger.story.health.text,
      onYou: mine.length,
      open: ledger.asks.filter(
        (a) => a.status !== "closed" && a.status !== "dropped"
      ).length,
      proposals: ledger.proposals.length,
      ready: readyTickets(ledger).length,
      summary: ledger.summary,
    });
  }
  onYouAll.sort((a, b) => a.at.localeCompare(b.at));
  return {
    features,
    onYou: onYouAll,
    problems,
    readyAsks: readyAsksAll,
    unplaced: await readUnplaced(unplacedFile),
  };
}

/**
 * The home page's ready/filed lists: `states` is every ready ticket's and every filed
 * ticket's live state and assignee, read once by the caller through the tickets package
 * (AC1, AC2, AC4); `liam` is his own id on each provider, so a ticket assigned to someone
 * else is left off Ready to work on; a revision's parent card has already been left out
 * of `pipelineCards` by the caller (AC3) — this just de-duplicates by key and orders High
 * Priority Pipeline first. Walks the ledgers a second time rather than sharing `homeShell`'s
 * pass — a second local disk read is nothing next to the live calls this waits on.
 */
export async function home(
  roots?: AppRoot[],
  unplacedFile?: string,
  filed: HomeFiledTicket[] = [],
  states: TicketStates = () => ({ state: "unknown" }),
  liam: LiamIds = {},
  pipelineCards: PipelineCard[] = []
): Promise<Home> {
  const shell = await homeShell(roots, unplacedFile);
  const { ledgers } = await listLedgers(roots);
  const ready: HomeTicket[] = [];
  for (const { feature, dir, ledger } of ledgers) {
    for (const t of readyTickets(ledger)) {
      const state = states(t.key);
      const verdict = assigneeVerdict(state, liam);
      if (verdict === "drop") {
        continue;
      }
      ready.push({
        ...t,
        dir,
        feature,
        url: stateUrl(state),
        ...(verdict === "unknown" ? { assignee: "unknown" as const } : {}),
      });
    }
  }
  const onLedger = new Set(
    ledgers.flatMap(({ ledger }) => ledger.tickets.map((t) => t.key))
  );
  const readyKeys = new Set(ready.map((t) => t.key));
  const orderedCards = [...pipelineCards].sort(
    (a, b) => Number(b.highPriority) - Number(a.highPriority)
  );
  for (const card of orderedCards) {
    if (readyKeys.has(card.key)) {
      continue;
    }
    const verdict = assigneeVerdict(card.state, liam);
    if (verdict === "drop") {
      continue;
    }
    readyKeys.add(card.key);
    ready.push({
      asks: [],
      blockers: [],
      dir: "",
      feature: "",
      key: card.key,
      ready: true,
      title: card.title,
      url: stateUrl(card.state),
      ...(verdict === "unknown" ? { assignee: "unknown" as const } : {}),
    });
  }
  return {
    ...shell,
    filed: filed.filter((t) => !onLedger.has(t.identifier)),
    ready,
  };
}
