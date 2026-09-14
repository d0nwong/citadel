/**
 * The Trello adapter (CTD-199, CTD-201). `AP-<n>` is card `<n>` on the Alden board — "Alden
 * SWE Ticketing System" (`TRELLO_BOARD_ID`) — and its state is its list, through
 * `TRELLO_LISTS`, the board's own list map: Deployed is done, Feature not a bug is
 * canceled, Pipeline and High Priority Pipeline are unstarted, New Reports and Holding
 * Pattern are triage, and In Progress, Testing, Staging and Ready for Agent are started. A
 * list the map does not know is left `open` with that list's own name and no `stage`,
 * reported once. `get` also answers the card's parent: the one card whose checklist item
 * names or links this card's key; none, or more than one, is no parent. `listOpen`
 * (CTD-200) answers every card not on Deployed or Feature not a bug, filtered for
 * `--mine`/`--unassigned` against `idMembers` and `GET /1/members/me`; it does not compute
 * a parent — that is `get`'s one checklist read per card, not the list's.
 *
 * A card's number is `idShort` when Trello answers one, else the number its own `url` shows
 * (`/c/<short>/207-…`) — `trello-cli --get-all-cards` was seen to answer `idShort: null`, so
 * both are read and neither is assumed.
 *
 * `create` (CTD-201) is `POST /1/cards` into Pipeline: a label named after `project`,
 * created on the board when it is new, `idMembers` from `"me"`/an id/none, and blockers as
 * a `Blocked by: K1, K2` line at the top of the description (spec S-14) — Trello has no
 * blocked-by relation, so the line is the whole mechanism. A `parent` gains one checklist
 * item — the new card's key, title and link, on its first checklist or one created named
 * `TRELLO_CHECKLIST_NAME` — appended at the bottom, so items stay in creation order (AC3);
 * the item text is exactly what `parentOf`'s matcher already reads a parent by. `update` is
 * `PUT /1/cards/{id}`: `state` resolves to a target list by name (AC2's list move); a
 * `project` label is added, never replacing one a person put on the card; a `parent` first
 * drops this card's item off whichever checklist already named it, so a re-parented card is
 * never listed on two (CTD-201's own S-42 requirement, for foundry's revision lookup).
 *
 * `claim` (CTD-205) is `POST /1/cards/{id}/idMembers` adding the given id, or the
 * credential's own member when none is given (the token owner, as `linearClaim`'s omitted
 * `assigneeId` assigns the key's own viewer), then `PUT /1/cards/{id}` moving it onto the
 * In Progress list. `link` (CTD-205) is `POST /1/cards/{id}/attachments` with the PR's `url`
 * and, when given, its `title` as the attachment's name — the Trello side of the Bitbucket PR
 * linker that used to call Linear's attachment API directly.
 *
 * Auth: `TRELLO_API_KEY` and `TRELLO_TOKEN` from the environment, read fresh per call, sent
 * as query parameters as Trello's own REST API expects. Without either, `states` answers
 * `unknown` for every `AP` key and names the missing variable on stderr once; every other
 * verb throws `MissingCredentialError` naming the first unset one, since a caller asking
 * for one ticket, or writing one, has nothing to fall back to.
 *
 * `trelloLabels`/`trelloMembers` (CTD-207) are the board's own labels and members, read
 * plainly (`GET /1/boards/{id}/labels`, `GET /1/boards/{id}/members`) for a caller checking
 * a project/label name before filing, or offering an assignee — throwing, by name, with no
 * credential, like every other read here.
 */

import { MissingCredentialError } from "./errors.ts";
import { splitKey } from "./key.ts";
import type { CreateTicketInput, LinkInput, ListOpenOptions, Stage, Ticket, TicketProvider, TicketState, TicketStates, UpdateTicketInput } from "./provider.ts";

export const TRELLO_API_URL = "https://api.trello.com/1";
export const TRELLO_BOARD_ID = "6a20ed52a8d9725b59ceb3bb";
export const TRELLO_BOARD_NAME = "Alden SWE Ticketing System";
export const TRELLO_PIPELINE_LIST = "Pipeline";
/** the list `claim` moves a card onto (CTD-205 AC1) */
export const TRELLO_IN_PROGRESS_LIST = "In Progress";
/** the list a Send moves a card onto before Foundry claims it (CTD-211 AC4) */
export const TRELLO_READY_FOR_AGENT_LIST = "Ready for Agent";
/** the checklist a parent card gets when it has none yet (CTD-201 AC3) */
export const TRELLO_CHECKLIST_NAME = "Tickets";

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
type TrelloChecklist = { id: string; idCard: string; checkItems: { id: string; name: string }[] };
type TrelloLabel = { id: string; name: string };

/** one member of the Alden board, as `GET /1/boards/{id}/members` answers it */
export type TrelloMember = { id: string; fullName: string; username: string };

export type TrelloOptions = { fetch?: typeof fetch; trelloKey?: string | null; trelloToken?: string | null; now?: Date };

const keyOf = (opts: TrelloOptions) => (opts.trelloKey === undefined ? process.env.TRELLO_API_KEY?.trim() || null : opts.trelloKey);
const tokenOf = (opts: TrelloOptions) => (opts.trelloToken === undefined ? process.env.TRELLO_TOKEN?.trim() || null : opts.trelloToken);

/** names whichever of the two credentials is missing; null when both are set */
function missingCredential(key: string | null, token: string | null): string | null {
  const missing = [!key && "TRELLO_API_KEY", !token && "TRELLO_TOKEN"].filter((x): x is string => !!x);
  return missing.length ? `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set` : null;
}

/** the credentials, or `MissingCredentialError` naming the first unset one — every write's guard, since a caller writing one ticket has nothing to fall back to */
function requireCredentials(opts: TrelloOptions): [key: string, token: string] {
  const key = keyOf(opts);
  if (!key) throw new MissingCredentialError("TRELLO_API_KEY");
  const token = tokenOf(opts);
  if (!token) throw new MissingCredentialError("TRELLO_TOKEN");
  return [key, token];
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

/** one card's own checklists, ids included — what `attachToParent` reads to find or make the checklist it appends to */
async function cardChecklists(cardId: string, opts: TrelloOptions, key: string, token: string): Promise<TrelloChecklist[]> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl(`/cards/${cardId}/checklists`, { fields: "idCard", checkItems: "all", checkItem_fields: "id,name" }, key, token);
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

async function boardLabels(opts: TrelloOptions, key: string, token: string): Promise<TrelloLabel[]> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl(`/boards/${TRELLO_BOARD_ID}/labels`, { fields: "name" }, key, token);
  const res = await f(url);
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as TrelloLabel[];
}

async function boardMembers(opts: TrelloOptions, key: string, token: string): Promise<TrelloMember[]> {
  const f = opts.fetch ?? fetch;
  const url = trelloUrl(`/boards/${TRELLO_BOARD_ID}/members`, { fields: "fullName,username" }, key, token);
  const res = await f(url);
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as TrelloMember[];
}

/** one authenticated write — POST or PUT or DELETE, every param (including the body) as Trello's own query-string convention expects */
async function trelloSend<T>(method: "POST" | "PUT" | "DELETE", path: string, params: Record<string, string>, opts: TrelloOptions, key: string, token: string): Promise<T> {
  const f = opts.fetch ?? fetch;
  const res = await f(trelloUrl(path, params, key, token), { method });
  if (!res.ok) throw new Error(`trello: ${res.status}`);
  return (await res.json()) as T;
}

/** the named label's id, case-insensitively; created on the board with no colour when nothing by that name exists yet */
async function labelIdFor(name: string, opts: TrelloOptions, key: string, token: string): Promise<string> {
  const labels = await boardLabels(opts, key, token);
  const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const created = await trelloSend<TrelloLabel>("POST", "/labels", { name, color: "null", idBoard: TRELLO_BOARD_ID }, opts, key, token);
  return created.id;
}

/** the named list's id, case-insensitively; an unknown name is refused, listing what the board has */
function listIdFor(name: string, lists: TrelloList[]): string {
  const found = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`trello: no list named "${name}" — the board has ${lists.map((l) => l.name).join(", ")}`);
  return found.id;
}

/** the credential's own member id, or `null` with no credential or an unreachable board */
export async function trelloViewerId(opts: TrelloOptions = {}): Promise<string | null> {
  const key = keyOf(opts);
  const token = tokenOf(opts);
  if (missingCredential(key, token)) return null;
  try {
    return (await trelloViewer(opts, key!, token!)).id;
  } catch {
    return null;
  }
}

/**
 * The Alden board's own labels — what a `project` name is matched against before `create`
 * makes a new one. Throws, naming the missing variable, when a credential is not set: a
 * caller asking for the board's labels has nothing to fall back to.
 */
export async function trelloLabels(opts: TrelloOptions = {}): Promise<{ id: string; name: string }[]> {
  const key = keyOf(opts);
  const token = tokenOf(opts);
  const missing = missingCredential(key, token);
  if (missing) throw new Error(missing);
  return boardLabels(opts, key!, token!);
}

/**
 * The Alden board's own members — the assignee picker's read (ticket 11). Throws, naming
 * the missing variable, when a credential is not set.
 */
export async function trelloMembers(opts: TrelloOptions = {}): Promise<TrelloMember[]> {
  const key = keyOf(opts);
  const token = tokenOf(opts);
  const missing = missingCredential(key, token);
  if (missing) throw new Error(missing);
  return boardMembers(opts, key!, token!);
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

const BLOCKED_BY_RE = /^Blocked by: ([^\n]*)\n?/;

/** the keys a description's own `Blocked by:` line already names, when it has one */
function currentBlockedBy(desc: string): string[] {
  const m = BLOCKED_BY_RE.exec(desc);
  return m ? m[1]!.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** `desc` with its `Blocked by:` line replaced by `keys` (spec S-14) — Trello has no blocked-by relation, so this is the whole mechanism */
function withBlockedBy(desc: string, keys: string[]): string {
  const stripped = desc.replace(BLOCKED_BY_RE, "");
  return keys.length ? `Blocked by: ${keys.join(", ")}\n${stripped}` : stripped;
}

/** a parent checklist item's text — the key, title and link `parentOf`'s matcher already reads a parent by */
const checkItemText = (ticket: { key: string; title: string; url: string }) => `${ticket.key} — ${ticket.title} — ${ticket.url}`;

/** the child's item on the parent card's checklist — its first, or one created named `TRELLO_CHECKLIST_NAME` — appended at the bottom so items stay in creation order (AC3) */
async function attachToParent(parentKey: string, child: { key: string; title: string; url: string }, opts: TrelloOptions, key: string, token: string): Promise<void> {
  const split = splitKey(parentKey);
  if (!split || split[0] !== "AP") throw new Error(`trello: ${parentKey} is not an AP card`);
  const cards = await boardCards(opts, key, token);
  const parentCard = cards.find((c) => cardNumber(c) === split[1]);
  if (!parentCard) throw new Error(`trello: no such card ${parentKey}`);
  const checklists = await cardChecklists(parentCard.id, opts, key, token);
  const checklist = checklists[0] ?? (await trelloSend<TrelloChecklist>("POST", "/checklists", { idCard: parentCard.id, name: TRELLO_CHECKLIST_NAME }, opts, key, token));
  await trelloSend("POST", `/checklists/${checklist.id}/checkItems`, { name: checkItemText(child), pos: "bottom" }, opts, key, token);
}

/** drops `card`'s item off whichever checklist already named it — a re-parented card is never listed on two (S-42) */
async function removeFromAnyParent(card: { key: string; shortUrl: string }, opts: TrelloOptions, key: string, token: string): Promise<void> {
  const nameRe = new RegExp(`\\b${card.key}\\b`, "i");
  const selfLink = shortLinkOf(card.shortUrl);
  const checklists = await boardChecklists(opts, key, token);
  for (const cl of checklists)
    for (const item of cl.checkItems)
      if (nameRe.test(item.name) || (selfLink && item.name.includes(selfLink))) await trelloSend("DELETE", `/checklists/${cl.id}/checkItems/${item.id}`, {}, opts, key, token);
}

/**
 * One card, into Pipeline (CTD-201 AC1). `project` is a label, created on the board when
 * it is new; `assigneeId` is `"me"` for the credential's own member, an id, or left off
 * unassigned; `blockedBy` becomes the description's `Blocked by:` line; `parent` adds one
 * checklist item on the parent card (AC3). Throws `MissingCredentialError` naming the
 * first unset credential, and by name when `team` is not the Alden board or a card comes
 * back with no readable number.
 */
export async function trelloCreate(input: CreateTicketInput, opts: TrelloOptions = {}): Promise<Ticket> {
  const [key, token] = requireCredentials(opts);
  if (input.team.toUpperCase() !== "AP") throw new Error(`trello: ${input.team} is not the Alden board`);
  const now = opts.now ?? new Date();
  const lists = await boardLists(opts, key, token);
  const idList = listIdFor(TRELLO_PIPELINE_LIST, lists);
  let memberId: string | undefined;
  if (input.assigneeId === "me") memberId = (await trelloViewer(opts, key, token)).id;
  else if (input.assigneeId) memberId = input.assigneeId;
  const labelId = input.project ? await labelIdFor(input.project, opts, key, token) : undefined;
  const desc = withBlockedBy(input.description, input.blockedBy ?? []);
  const created = await trelloSend<TrelloCard>(
    "POST",
    "/cards",
    { idList, name: input.title, desc, ...(labelId ? { idLabels: labelId } : {}), ...(memberId ? { idMembers: memberId } : {}) },
    opts,
    key,
    token,
  );
  const n = cardNumber(created);
  if (n === null) throw new Error("trello: card created with no readable number");
  const ticket: Ticket = {
    key: `AP-${n}`,
    title: created.name,
    url: created.shortUrl,
    description: created.desc ?? "",
    state: cardState(created, TRELLO_PIPELINE_LIST, now),
    ...(input.parent ? { parentKey: input.parent } : {}),
  };
  if (input.parent) await attachToParent(input.parent, ticket, opts, key, token);
  return ticket;
}

/**
 * One `PUT /1/cards/{id}`, carrying only the fields given. `state` resolves to a target
 * list by name (AC2's list move); `project` adds a label without touching one already on
 * the card; `parent` re-attaches the card's checklist item, first dropping it off any
 * checklist it was already on. Throws `MissingCredentialError` naming the first unset
 * credential, and by name on an unknown card, list or parent.
 */
export async function trelloUpdate(cardKey: string, input: UpdateTicketInput, opts: TrelloOptions = {}): Promise<Ticket> {
  const [key, token] = requireCredentials(opts);
  const split = splitKey(cardKey);
  if (!split || split[0] !== "AP") throw new Error(`trello: ${cardKey} is not an AP card`);
  const now = opts.now ?? new Date();
  const [cards, lists] = await Promise.all([boardCards(opts, key, token), boardLists(opts, key, token)]);
  const card = cards.find((c) => cardNumber(c) === split[1]);
  if (!card) throw new Error(`trello: no such card ${cardKey}`);
  const nameOfList = new Map(lists.map((l) => [l.id, l.name]));

  const idList = input.state !== undefined ? listIdFor(input.state, lists) : undefined;
  let memberId: string | undefined;
  if (input.assigneeId === "me") memberId = (await trelloViewer(opts, key, token)).id;
  else if (input.assigneeId === null) memberId = "";
  else if (input.assigneeId !== undefined) memberId = input.assigneeId;
  const nextDesc =
    input.description !== undefined || input.blockedBy !== undefined
      ? withBlockedBy(input.description ?? card.desc ?? "", input.blockedBy ?? currentBlockedBy(card.desc ?? ""))
      : undefined;

  const params: Record<string, string> = {};
  if (input.title !== undefined) params.name = input.title;
  if (nextDesc !== undefined) params.desc = nextDesc;
  if (idList !== undefined) params.idList = idList;
  if (memberId !== undefined) params.idMembers = memberId;
  const updated = Object.keys(params).length ? await trelloSend<TrelloCard>("PUT", `/cards/${card.id}`, params, opts, key, token) : card;

  if (input.project !== undefined) {
    const labelId = await labelIdFor(input.project, opts, key, token);
    await trelloSend("POST", `/cards/${card.id}/idLabels`, { value: labelId }, opts, key, token);
  }
  if (input.parent !== undefined) {
    await removeFromAnyParent({ key: cardKey, shortUrl: card.shortUrl }, opts, key, token);
    await attachToParent(input.parent, { key: cardKey, title: updated.name, url: updated.shortUrl }, opts, key, token);
  }

  const listName = nameOfList.get(updated.idList) ?? `list ${updated.idList}`;
  return {
    key: cardKey,
    title: updated.name,
    url: updated.shortUrl,
    description: updated.desc ?? "",
    state: cardState(updated, listName, now),
    ...(input.parent ? { parentKey: input.parent } : {}),
  };
}

/** one card, by its `AP-<n>` key; throws by name when the key is not `AP` or the board has no such card */
async function cardByKey(key: string, opts: TrelloOptions, apiKey: string, token: string): Promise<TrelloCard> {
  const split = splitKey(key);
  if (!split || split[0] !== "AP") throw new Error(`trello: ${key} is not an AP card`);
  const cards = await boardCards(opts, apiKey, token);
  const card = cards.find((c) => cardNumber(c) === split[1]);
  if (!card) throw new Error(`trello: no such card ${key}`);
  return card;
}

/**
 * Adds the given member (or, with none, the credential's own) to the card, then moves it onto
 * In Progress (CTD-205 AC1). Throws `MissingCredentialError` naming the first unset
 * credential, and by name when the key is not `AP` or the board has no such card.
 */
export async function trelloClaim(key: string, assigneeId: string | undefined, opts: TrelloOptions = {}): Promise<void> {
  const [apiKey, token] = requireCredentials(opts);
  const [card, lists] = await Promise.all([cardByKey(key, opts, apiKey, token), boardLists(opts, apiKey, token)]);
  const memberId = assigneeId ?? (await trelloViewer(opts, apiKey, token)).id;
  const idList = listIdFor(TRELLO_IN_PROGRESS_LIST, lists);
  await trelloSend("POST", `/cards/${card.id}/idMembers`, { value: memberId }, opts, apiKey, token);
  await trelloSend("PUT", `/cards/${card.id}`, { idList }, opts, apiKey, token);
}

/**
 * One `POST /1/cards/{id}/attachments` carrying the PR's `url` (CTD-205 AC2) — Trello has no
 * relation API, so an attachment is the whole mechanism, as a `Blocked by:` line is for a
 * blocker. Throws `MissingCredentialError` naming the first unset credential, and by name
 * when the key is not `AP` or the board has no such card.
 */
export async function trelloLink(key: string, input: LinkInput, opts: TrelloOptions = {}): Promise<void> {
  const [apiKey, token] = requireCredentials(opts);
  const card = await cardByKey(key, opts, apiKey, token);
  await trelloSend("POST", `/cards/${card.id}/attachments`, { url: input.url, ...(input.title ? { name: input.title } : {}) }, opts, apiKey, token);
}

/** the Trello adapter as a `TicketProvider`; every verb is implemented (CTD-198, CTD-199, CTD-200, CTD-201, CTD-205) */
export function trelloProvider(opts: TrelloOptions = {}): TicketProvider {
  return {
    name: "trello",
    get: (key) => trelloGet(key, opts),
    states: (keys) => trelloTicketStates(keys, opts),
    listOpen: (listOpts) => trelloListOpen({ ...opts, ...listOpts }),
    create: (input) => trelloCreate(input, opts),
    update: (key, input) => trelloUpdate(key, input, opts),
    claim: (key, assigneeId) => trelloClaim(key, assigneeId, opts),
    link: (key, input) => trelloLink(key, input, opts),
  };
}
