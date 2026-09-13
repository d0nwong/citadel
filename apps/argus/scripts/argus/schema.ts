/**
 * The ledger's shape, stated once. One `ledger.json` per feature is the record: the
 * requirements the business asked for and whether anyone confirmed them, the asks and what
 * happened to each, the user's tickets with their blockers, the landings that touched the
 * feature, and the proposals waiting for a click. `parseLedger` checks the shape and names
 * the first path that breaks it; the rules that need the previous ledger or the prose
 * (evidence on every claim, ids never reused, the style ceiling) are `validate.ts`'s.
 */

export const REPOS = ["fe", "be"] as const;
export type Repo = (typeof REPOS)[number];

export const REQUIREMENT_STATUSES = ["assumed", "confirmed", "contradicted", "retired"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const ASK_STATUSES = ["asked", "answered", "built", "acknowledged", "closed", "dropped"] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];
/** an ask in one of these needs nobody; it is off Needs-me */
export const ASK_DONE: readonly AskStatus[] = ["closed", "dropped"];

export const EVIDENCE_KINDS = ["slack", "pr", "commit", "file", "ticket", "assumption", "user"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const BLOCKER_KINDS = ["landing", "answer", "ticket"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export const STORY_KEYS = ["health", "gaps", "requirements", "architecture"] as const;
export type StoryKey = (typeof STORY_KEYS)[number];

/** what an ask or a proposal came from */
export const ORIGIN_KINDS = ["slack", "huddle", "ticket"] as const;

export type Evidence =
  | { kind: "slack"; url: string; quote?: string }
  | { kind: "pr"; repo: Repo; number: number; url: string }
  | { kind: "commit"; repo: Repo; sha: string; url?: string }
  | { kind: "file"; repo: Repo; sha: string; path: string; line?: number }
  | { kind: "ticket"; key: string; url?: string }
  | { kind: "assumption"; note?: string }
  /** a click in Pensieve or a CLI verb the user ran; the model never writes this kind */
  | { kind: "user"; reason: string; at: string };

export type StoryText = { text: string; evidence: Evidence[] };
export type Story = Record<StoryKey, StoryText>;

export type Requirement = {
  id: string;
  text: string;
  status: RequirementStatus;
  by?: string;
  at?: string;
  evidence: Evidence[];
  /** where the code does it, pinned to a sha */
  code?: Extract<Evidence, { kind: "file" }>[];
};

export type AskOrigin =
  | { kind: "slack"; url: string; thread: string }
  | { kind: "huddle"; url: string; thread: string }
  | { kind: "ticket"; key: string };

export type AskHistory = { at: string; status: AskStatus; evidence: Evidence[] };

export type Ask = {
  id: string;
  text: string;
  by: string;
  /** a first name, `you`, or null when aimed at nobody in particular */
  to: string | null;
  at: string;
  status: AskStatus;
  origin: AskOrigin;
  history: AskHistory[];
  requirements?: string[];
  ticket?: string | null;
  /** what the ask waits for; code clears a landing, a person answers an answer */
  blockers?: Blocker[];
  /** derived: present only with blockers; true when every one is cleared */
  ready?: boolean;
};

export type Cleared = { at: string; evidence: Evidence[] };

export type Blocker =
  | { kind: "landing"; repo: Repo; ref: string; branch: string; deployed: boolean; cleared: Cleared | null }
  | { kind: "answer"; from: string; question: string; cleared: Cleared | null }
  | { kind: "ticket"; key: string; cleared: Cleared | null };

export type Ticket = {
  key: string;
  title: string;
  asks: string[];
  blockers: Blocker[];
  /** derived: every blocker cleared. Written by `write`, never by hand or by the model. */
  ready: boolean;
  sent?: { at: string; repo: string; job?: string }[];
  /**
   * For a ticket that serves no ask: the landing that carried its key went live. Set by
   * `reconcile`, the only way such a ticket is ever done. A ticket with asks is done when
   * they are all settled, and never needs this.
   */
  done?: Cleared;
};

export type Landing = {
  at: string;
  repo: Repo;
  /** `fe#417`, or `fe@ac1caffd6` for a commit pushed straight at the branch */
  ref: string;
  number: number | null;
  sha: string;
  title: string;
  by: string;
  url: string | null;
  asks: string[];
  files: string[];
  /** ticket keys the branch or title named, so a landing can close the ask its ticket serves */
  tickets?: string[];
};

export type Proposal = {
  id: string;
  kind: "ticket";
  title: string;
  body: string;
  asks: string[];
  at: string;
};

/** the highest id ever allocated per namespace, so a removed proposal's id is never reused */
export type IdCounters = { R: number; A: number; P: number };

export type Ledger = {
  feature: string;
  as_of: string;
  summary: string;
  ids?: IdCounters;
  story: Story;
  requirements: Requirement[];
  asks: Ask[];
  tickets: Ticket[];
  landings: Landing[];
  proposals: Proposal[];
};

/** an empty ledger for a feature nothing has touched yet */
export function emptyLedger(feature: string, summary = "", as_of = new Date().toISOString()): Ledger {
  const blank = (): StoryText => ({ text: "", evidence: [] });
  return {
    feature,
    as_of,
    summary,
    story: { health: blank(), gaps: blank(), requirements: blank(), architecture: blank() },
    requirements: [],
    asks: [],
    tickets: [],
    landings: [],
    proposals: [],
  };
}

// ---------------------------------------------------------------- the parser

export class SchemaError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SchemaError";
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw new SchemaError(path, "expected an object");
  return v;
}
function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new SchemaError(`${path}.${key}`, "expected a string");
  return v;
}
function optStr(o: Obj, key: string, path: string): string | undefined {
  if (o[key] === undefined) return undefined;
  return str(o, key, path);
}
function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number") throw new SchemaError(`${path}.${key}`, "expected a number");
  return v;
}
function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new SchemaError(`${path}.${key}`, "expected a boolean");
  return v;
}
function arr(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new SchemaError(`${path}.${key}`, "expected an array");
  return v;
}
function strs(o: Obj, key: string, path: string): string[] {
  return arr(o, key, path).map((v, i) => {
    if (typeof v !== "string") throw new SchemaError(`${path}.${key}[${i}]`, "expected a string");
    return v;
  });
}
function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], path: string): T {
  const v = str(o, key, path);
  if (!(allowed as readonly string[]).includes(v))
    throw new SchemaError(`${path}.${key}`, `expected one of ${allowed.join(", ")}, got "${v}"`);
  return v as T;
}
function repo(o: Obj, path: string): Repo {
  return oneOf(o, "repo", REPOS, path);
}

export function parseEvidence(v: unknown, path: string): Evidence {
  const o = obj(v, path);
  const kind = oneOf(o, "kind", EVIDENCE_KINDS, path);
  switch (kind) {
    case "slack":
      return { kind, url: str(o, "url", path), ...(o.quote !== undefined ? { quote: str(o, "quote", path) } : {}) };
    case "pr":
      return { kind, repo: repo(o, path), number: num(o, "number", path), url: str(o, "url", path) };
    case "commit":
      return { kind, repo: repo(o, path), sha: str(o, "sha", path), ...(o.url !== undefined ? { url: str(o, "url", path) } : {}) };
    case "file":
      return {
        kind,
        repo: repo(o, path),
        sha: str(o, "sha", path),
        path: str(o, "path", path),
        ...(o.line !== undefined ? { line: num(o, "line", path) } : {}),
      };
    case "ticket":
      return { kind, key: str(o, "key", path), ...(o.url !== undefined ? { url: str(o, "url", path) } : {}) };
    case "assumption":
      return { kind, ...(o.note !== undefined ? { note: str(o, "note", path) } : {}) };
    case "user":
      return { kind, reason: str(o, "reason", path), at: str(o, "at", path) };
  }
}

const evidenceList = (o: Obj, key: string, path: string): Evidence[] =>
  arr(o, key, path).map((e, i) => parseEvidence(e, `${path}.${key}[${i}]`));

function storyText(v: unknown, path: string): StoryText {
  const o = obj(v, path);
  return { text: str(o, "text", path), evidence: evidenceList(o, "evidence", path) };
}

function requirement(v: unknown, path: string): Requirement {
  const o = obj(v, path);
  const r: Requirement = {
    id: str(o, "id", path),
    text: str(o, "text", path),
    status: oneOf(o, "status", REQUIREMENT_STATUSES, path),
    evidence: evidenceList(o, "evidence", path),
  };
  const by = optStr(o, "by", path);
  const at = optStr(o, "at", path);
  if (by !== undefined) r.by = by;
  if (at !== undefined) r.at = at;
  if (o.code !== undefined) {
    r.code = evidenceList(o, "code", path).map((e, i) => {
      if (e.kind !== "file") throw new SchemaError(`${path}.code[${i}]`, "code pointers are file evidence");
      return e;
    });
  }
  return r;
}

function origin(v: unknown, path: string): AskOrigin {
  const o = obj(v, path);
  const kind = oneOf(o, "kind", ORIGIN_KINDS, path);
  if (kind === "ticket") return { kind, key: str(o, "key", path) };
  return { kind, url: str(o, "url", path), thread: str(o, "thread", path) };
}

function ask(v: unknown, path: string): Ask {
  const o = obj(v, path);
  const to = o.to;
  if (to !== null && typeof to !== "string") throw new SchemaError(`${path}.to`, "expected a string or null");
  const a: Ask = {
    id: str(o, "id", path),
    text: str(o, "text", path),
    by: str(o, "by", path),
    to,
    at: str(o, "at", path),
    status: oneOf(o, "status", ASK_STATUSES, path),
    origin: origin(o.origin, `${path}.origin`),
    history: arr(o, "history", path).map((h, i) => {
      const p = `${path}.history[${i}]`;
      const ho = obj(h, p);
      return { at: str(ho, "at", p), status: oneOf(ho, "status", ASK_STATUSES, p), evidence: evidenceList(ho, "evidence", p) };
    }),
  };
  if (o.requirements !== undefined) a.requirements = strs(o, "requirements", path);
  if (o.blockers !== undefined) a.blockers = arr(o, "blockers", path).map((b, i) => blocker(b, `${path}.blockers[${i}]`));
  if (o.ready !== undefined) a.ready = bool(o, "ready", path);
  if (o.ticket !== undefined) {
    if (o.ticket !== null && typeof o.ticket !== "string") throw new SchemaError(`${path}.ticket`, "expected a string or null");
    a.ticket = o.ticket;
  }
  return a;
}

function cleared(o: Obj, path: string): Cleared | null {
  if (o.cleared === null) return null;
  const c = obj(o.cleared, `${path}.cleared`);
  return { at: str(c, "at", `${path}.cleared`), evidence: evidenceList(c, "evidence", `${path}.cleared`) };
}

function blocker(v: unknown, path: string): Blocker {
  const o = obj(v, path);
  if (o.cleared === undefined) throw new SchemaError(`${path}.cleared`, "expected an object or null");
  const kind = oneOf(o, "kind", BLOCKER_KINDS, path);
  switch (kind) {
    case "landing":
      return {
        kind,
        repo: repo(o, path),
        ref: str(o, "ref", path),
        branch: str(o, "branch", path),
        deployed: bool(o, "deployed", path),
        cleared: cleared(o, path),
      };
    case "answer":
      return { kind, from: str(o, "from", path), question: str(o, "question", path), cleared: cleared(o, path) };
    case "ticket":
      return { kind, key: str(o, "key", path), cleared: cleared(o, path) };
  }
}

function ticket(v: unknown, path: string): Ticket {
  const o = obj(v, path);
  const t: Ticket = {
    key: str(o, "key", path),
    title: str(o, "title", path),
    asks: strs(o, "asks", path),
    blockers: arr(o, "blockers", path).map((b, i) => blocker(b, `${path}.blockers[${i}]`)),
    ready: bool(o, "ready", path),
  };
  if (o.sent !== undefined) {
    t.sent = arr(o, "sent", path).map((s, i) => {
      const p = `${path}.sent[${i}]`;
      const so = obj(s, p);
      const job = optStr(so, "job", p);
      return { at: str(so, "at", p), repo: str(so, "repo", p), ...(job !== undefined ? { job } : {}) };
    });
  }
  if (o.done !== undefined) {
    const d = obj(o.done, `${path}.done`);
    t.done = { at: str(d, "at", `${path}.done`), evidence: evidenceList(d, "evidence", `${path}.done`) };
  }
  return t;
}

function landing(v: unknown, path: string): Landing {
  const o = obj(v, path);
  if (o.number !== null && typeof o.number !== "number") throw new SchemaError(`${path}.number`, "expected a number or null");
  if (o.url !== null && typeof o.url !== "string") throw new SchemaError(`${path}.url`, "expected a string or null");
  return {
    at: str(o, "at", path),
    repo: repo(o, path),
    ref: str(o, "ref", path),
    number: o.number as number | null,
    sha: str(o, "sha", path),
    title: str(o, "title", path),
    by: str(o, "by", path),
    url: o.url as string | null,
    asks: strs(o, "asks", path),
    files: strs(o, "files", path),
    ...(o.tickets !== undefined ? { tickets: strs(o, "tickets", path) } : {}),
  };
}

function proposal(v: unknown, path: string): Proposal {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    kind: oneOf(o, "kind", ["ticket"] as const, path),
    title: str(o, "title", path),
    body: str(o, "body", path),
    asks: strs(o, "asks", path),
    at: str(o, "at", path),
  };
}

/** Check the shape of a parsed JSON value and return it typed, or throw the first broken path. */
export function parseLedger(v: unknown): Ledger {
  const o = obj(v, "ledger");
  if ("on_you" in obj(o.story ?? {}, "ledger.story"))
    throw new SchemaError("ledger.story.on_you", "on_you is derived from asks, never written");
  const story = obj(o.story, "ledger.story");
  const l: Ledger = {
    feature: str(o, "feature", "ledger"),
    as_of: str(o, "as_of", "ledger"),
    summary: str(o, "summary", "ledger"),
    story: Object.fromEntries(STORY_KEYS.map((k) => [k, storyText(story[k], `ledger.story.${k}`)])) as Story,
    requirements: arr(o, "requirements", "ledger").map((r, i) => requirement(r, `ledger.requirements[${i}]`)),
    asks: arr(o, "asks", "ledger").map((a, i) => ask(a, `ledger.asks[${i}]`)),
    tickets: arr(o, "tickets", "ledger").map((t, i) => ticket(t, `ledger.tickets[${i}]`)),
    landings: arr(o, "landings", "ledger").map((l, i) => landing(l, `ledger.landings[${i}]`)),
    proposals: arr(o, "proposals", "ledger").map((p, i) => proposal(p, `ledger.proposals[${i}]`)),
  };
  if (o.ids !== undefined) {
    const ids = obj(o.ids, "ledger.ids");
    l.ids = { R: num(ids, "R", "ledger.ids"), A: num(ids, "A", "ledger.ids"), P: num(ids, "P", "ledger.ids") };
  }
  return l;
}

/** One serializer so every writer produces the same bytes and a `git diff` stays readable. */
export const serializeLedger = (l: Ledger): string => JSON.stringify(l, null, 2) + "\n";
