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
  dir: string;
  feature: string;
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

export interface Home {
  features: FeatureSummary[];
  filed: HomeFiledTicket[];
  onYou: HomeAsk[];
  problems: LedgerProblem[];
  ready: HomeTicket[];
  /** open asks whose wait is over */
  readyAsks: HomeAsk[];
  unplaced: Unplaced[];
}

/** the home page: what is on you across features, what is ready, what nobody could place */
export async function home(
  roots?: AppRoot[],
  unplacedFile?: string,
  filed: HomeFiledTicket[] = []
): Promise<Home> {
  const { ledgers, problems } = await listLedgers(roots);
  const onYouAll: HomeAsk[] = [];
  const ready: HomeTicket[] = [];
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
    for (const t of readyTickets(ledger)) {
      ready.push({ ...t, dir, feature });
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
  const onLedger = new Set(
    ledgers.flatMap(({ ledger }) => ledger.tickets.map((t) => t.key))
  );
  return {
    features,
    filed: filed.filter((t) => !onLedger.has(t.identifier)),
    onYou: onYouAll,
    problems,
    ready,
    readyAsks: readyAsksAll,
    unplaced: await readUnplaced(unplacedFile),
  };
}
