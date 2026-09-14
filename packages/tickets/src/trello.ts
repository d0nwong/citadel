/**
 * The Trello adapter (CTD-199). `AP-<n>` is card `<n>` on the Alden board — "Alden SWE
 * Ticketing System" (`TRELLO_BOARD_ID`) — and its state is its list, through `TRELLO_LISTS`,
 * the board's own list map: Deployed is done, Feature not a bug is canceled, Pipeline and
 * High Priority Pipeline are unstarted, New Reports and Holding Pattern are triage, and
 * In Progress, Testing, Staging and Ready for Agent are started. A list the map does not
 * know is left `open` with that list's own name and no `stage`, reported once. `get` also
 * answers the card's parent: the one card whose checklist item names or links this card's
 * key; none, or more than one, is no parent. `listOpen` (CTD-200) answers every card not on
 * Deployed or Feature not a bug, filtered for `--mine`/`--unassigned` against `idMembers`
 * and `GET /1/members/me`; it does not compute a parent — that is `get`'s one checklist
 * read per card, not the list's.
 *
 * A card's number is `idShort` when Trello answers one, else the number its own `url` shows
 * (`/c/<short>/207-…`) — `trello-cli --get-all-cards` was seen to answer `idShort: null`, so
 * both are read and neither is assumed.
 *
 * Auth: `TRELLO_API_KEY` and `TRELLO_TOKEN` from the environment, read fresh per call, sent
 * as query parameters as Trello's own REST API expects. Without either, `states` answers
 * `unknown` for every `AP` key and names the missing variable on stderr once; `get` and
 * `listOpen` throw, naming it, since a caller asking for one ticket or the open list has
 * nothing to fall back to. Read-only: nothing here writes Trello.
 */

import { splitKey } from "./key.ts";
import type { ListOpenOptions, Stage, Ticket, TicketProvider, TicketState, TicketStates } from "./provider.ts";

export const TRELLO_API_URL = "https://api.trello.com/1";
export const TRELLO_BOARD_ID = "6a20ed52a8d9725b59ceb3bb";
export const TRELLO_BOARD_NAME = "Alden SWE Ticketing System";
export const TRELLO_PIPELINE_LIST = "Pipeline";

/** the list each state maps to, keyed by the list's own name, lowercased */
export const TRELLO_LISTS: Record<string, "done" | "canceled" | Stage> = {
  "new reports": "triage",
  "holding pattern": "triage",
  pipeline: "unstarted",
  "high priority pipeline": "unstarted",
  "in progress": "started",
  testing: "started",
  staging: "started",
  deployed: "done",
  "feature not a bug": "canceled",
  "ready for agent": "started",
};

type TrelloCard = { id: string; idShort: number | null; idList: string; idMembers: string[]; name: string; desc: string | null; shortUrl: string; url: string };
type TrelloList = { id: string; name: string };
type TrelloChecklist = { idCard: string; checkItems: { name: string }[] };

export type TrelloOptions = { fetch?: typeof fetch; trelloKey?: string | null; trelloToken?: string | null; now?: Date };

const keyOf = (opts: TrelloOptions) => (opts.trelloKey === undefined ? process.env.TRELLO_API_KEY?.trim() || null : opts.trelloKey);
const tokenOf = (opts: TrelloOptions) => (opts.trelloToken === undefined ? process.env.TRELLO_TOKEN?.trim() || null : opts.trelloToken);

/** names whichever of the two credentials is missing; null when both are set */
function missingCredential(key: string | null, token: string | null): string | null {
  const missing = [!key && "TRELLO_API_KEY", !token && "TRELLO_TOKEN"].filter((x): x is string => !!x);
  return missing.length ? `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set` : null;
}

const trelloUrl = (path: string, params: Record<string, string>, key: string, token: string) => {
  const qs = new URLSearchParams({ ...params, key, token });
  return `${TRELLO_API_URL}${path}?${qs.toString()}`;
};

async function boardCards(opts: TrelloOptions, key: string, token: string): Promise<TrelloCard[]> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl(`/boards/${TRELLO_BOARD_ID}/cards`, { fields: "idShort,idList,idMembers,name,desc,shortUrl,url" }, key, token);
  const res = await f(url);
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as TrelloCard[];
}

async function boardLists(opts: TrelloOptions, key: string, token: string): Promise<TrelloList[]> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl(`/boards/${TRELLO_BOARD_ID}/lists`, { fields: "name" }, key, token);
  const res = await f(url);
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as TrelloList[];
}

async function boardChecklists(opts: TrelloOptions, key: string, token: string): Promise<TrelloChecklist[]> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl(`/boards/${TRELLO_BOARD_ID}/checklists`, { fields: "idCard", checkItems: "all", checkItem_fields: "name" }, key, token);
  const res = await f(url);
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as TrelloChecklist[];
}

async function trelloViewer(opts: TrelloOptions, key: string, token: string): Promise<{ id: string }> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl("/members/me", { fields: "id" }, key, token);
  const res = await f(url);
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as { id: string };
}

const NUMBER_IN_URL = /\/c\/[^/]+\/(\d+)(?:-|$)/;

/** `idShort` when Trello answered one, else the number its own `url` shows */
export function cardNumber(card: TrelloCard): number | null {
  if (typeof card.idShort === "number" && Number.isInteger(card.idShort)) return card.idShort;
  const m = NUMBER_IN_URL.exec(card.url ?? "");
  return m ? Number(m[1]) : null;
}

/** one card, on the list named `listName` → its state; Deployed and Feature not a bug are terminal, the rest are open */
export function cardState(card: TrelloCard, listName: string, now: Date): TicketState {
  const category = TRELLO_LISTS[listName.toLowerCase()];
  const assignee = card.idMembers[0] ? { id: card.idMembers[0] } : undefined;
  const url = card.shortUrl;
  if (category === "done") return { state: "done", at: now.toISOString(), name: listName, url, provider: "trello", assignee };
  if (category === "canceled") return { state: "canceled", at: now.toISOString(), name: listName, url, provider: "trello", assignee };
  return { state: "open", name: listName, url, provider: "trello", assignee, ...(category ? { stage: category } : {}) };
}

/**
 * The state of every `AP` key, asked of the Alden board once. Keys the board does not have
 * a card for, and every `AP` key when a credential is missing or the board could not be
 * read, answer `unknown`. A list the map does not know is reported once per run, by name.
 */
export async function trelloTicketStates(keys: string[], opts: TrelloOptions = {}): Promise<TicketStates> {
  const found = new Map<string, TicketState>();
  const answer: TicketStates = (k) => found.get(k) ?? { state: "unknown" };
  const apKeys = keys.filter((k) => splitKey(k)?.[0] === "AP");
  if (apKeys.length === 0) return answer;
  const key = keyOf(opts);
  const token = tokenOf(opts);
  const missing = missingCredential(key, token);
  if (missing) {
    console.error(`trello: ${missing}`);
    return answer;
  }
  const now = opts.now ?? new Date();
  try {
    const [cards, lists] = await Promise.all([boardCards(opts, key!, token!), boardLists(opts, key!, token!)]);
    const nameOfList = new Map(lists.map((l) => [l.id, l.name]));
    const byNumber = new Map<number, TrelloCard>();
    for (const c of cards) {
      const n = cardNumber(c);
      if (n !== null) byNumber.set(n, c);
    }
    const reportedLists = new Set<string>();
    for (const apKey of apKeys) {
      const n = splitKey(apKey)![1];
      const card = byNumber.get(n);
      if (!card) continue;
      const listName = nameOfList.get(card.idList) ?? `list ${card.idList}`;
      if (!(listName.toLowerCase() in TRELLO_LISTS) && !reportedLists.has(listName)) {
        reportedLists.add(listName);
        console.error(`trello: card on unknown list "${listName}" — left open`);
      }
      found.set(apKey, cardState(card, listName, now));
    }
  } catch (e) {
    console.error(`trello: could not read the board — ${e instanceof Error ? e.message : String(e)}`);
  }
  return answer;
}

/** the shortLink out of a card's `shortUrl` (`https://trello.com/c/<shortLink>`), for matching a checklist item that just links the card */
const shortLinkOf = (shortUrl: string) => /\/c\/([^/]+)/.exec(shortUrl)?.[1];

/** the one card whose checklist item names or links `card`; none, or more than one, is no parent */
async function parentOf(card: TrelloCard, cards: TrelloCard[], opts: TrelloOptions, key: string, token: string): Promise<string | undefined> {
  const selfNumber = cardNumber(card);
  const selfKey = `AP-${selfNumber}`;
  const selfLink = shortLinkOf(card.shortUrl);
  const nameRe = new RegExp(`\\b${selfKey}\\b`, "i");
  const checklists = await boardChecklists(opts, key, token);
  const parentIds = new Set<string>();
  for (const cl of checklists) {
    if (cl.idCard === card.id) continue;
    for (const item of cl.checkItems) {
      if (nameRe.test(item.name) || (selfLink && item.name.includes(selfLink))) {
        parentIds.add(cl.idCard);
        break;
      }
    }
  }
  if (parentIds.size !== 1) return undefined;
  const parentCard = cards.find((c) => c.id === [...parentIds][0]);
  const n = parentCard ? cardNumber(parentCard) : null;
  return n !== null ? `AP-${n}` : undefined;
}

/**
 * One ticket, from card `<n>` on the Alden board. `null` when the board has no such number;
 * throws, naming the missing variable, when a credential is not set.
 */
export async function trelloGet(key: string, opts: TrelloOptions = {}): Promise<Ticket | null> {
  const split = splitKey(key);
  if (!split || split[0] !== "AP") return null;
  const apiKey = keyOf(opts);
  const token = tokenOf(opts);
  const missing = missingCredential(apiKey, token);
  if (missing) throw new Error(missing);
  const now = opts.now ?? new Date();
  const [cards, lists] = await Promise.all([boardCards(opts, apiKey!, token!), boardLists(opts, apiKey!, token!)]);
  const card = cards.find((c) => cardNumber(c) === split[1]);
  if (!card) return null;
  const nameOfList = new Map(lists.map((l) => [l.id, l.name]));
  const listName = nameOfList.get(card.idList) ?? `list ${card.idList}`;
  const parentKey = await parentOf(card, cards, opts, apiKey!, token!).catch((e) => {
    console.error(`trello: could not read checklists — ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  });
  return {
    key: `AP-${cardNumber(card)}`,
    title: card.name,
    url: card.shortUrl,
    description: card.desc ?? "",
    state: cardState(card, listName, now),
    ...(parentKey ? { parentKey } : {}),
  };
}

/**
 * The Alden board's open cards (Deployed and Feature not a bug excluded) as `Ticket`s
 * (CTD-200). `--team` is the router's own business — only `AP` ever reaches here, and the
 * board is Trello's only "team" — so it is otherwise ignored. `--unassigned` and `--mine`
 * filter on `idMembers` against `GET /1/members/me`, read only when `--mine` is asked for.
 * No parent is computed here (that is one checklist read per card, and `get` already
 * answers it) — this is the list, not the detail. Throws, naming the missing variable,
 * when a credential is not set: a caller asking for the open list has nothing to fall
 * back to.
 */
export async function trelloListOpen(opts: TrelloOptions & ListOpenOptions = {}): Promise<Ticket[]> {
  const apiKey = keyOf(opts);
  const token = tokenOf(opts);
  const missing = missingCredential(apiKey, token);
  if (missing) throw new Error(missing);
  const now = opts.now ?? new Date();
  const [cards, lists, viewer] = await Promise.all([
    boardCards(opts, apiKey!, token!),
    boardLists(opts, apiKey!, token!),
    opts.mine ? trelloViewer(opts, apiKey!, token!) : Promise.resolve(null),
  ]);
  const nameOfList = new Map(lists.map((l) => [l.id, l.name]));
  const out: Ticket[] = [];
  for (const card of cards) {
    const n = cardNumber(card);
    if (n === null) continue;
    const listName = nameOfList.get(card.idList) ?? `list ${card.idList}`;
    const state = cardState(card, listName, now);
    if (state.state !== "open") continue;
    if (opts.unassigned && card.idMembers.length > 0) continue;
    if (opts.mine && !card.idMembers.includes(viewer!.id)) continue;
    out.push({ key: `AP-${n}`, title: card.name, url: card.shortUrl, description: card.desc ?? "", state });
  }
  return out;
}

const notImplemented = (verb: string): never => {
  throw new Error(`tickets: Trello's "${verb}" is not implemented yet`);
};

/** the Trello adapter as a `TicketProvider`; `get`, `states` and `listOpen` are implemented (CTD-198, CTD-199, CTD-200) */
export function trelloProvider(opts: TrelloOptions = {}): TicketProvider {
  return {
    name: "trello",
    get: (key) => trelloGet(key, opts),
    states: (keys) => trelloTicketStates(keys, opts),
    listOpen: (listOpts) => trelloListOpen({ ...opts, ...listOpts }),
    create: () => notImplemented("create"),
    update: () => notImplemented("update"),
    claim: () => notImplemented("claim"),
    link: () => notImplemented("link"),
  };
}
