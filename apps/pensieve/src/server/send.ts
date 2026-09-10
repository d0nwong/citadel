/**
 * Node-only. The checks behind the two verbs the feature page has, in one place: what
 * `sendTicket` asks before it reaches Foundry, and what `verifyEvent` asks before it writes
 * a confirmation. This is `verdict.ts`'s job from the point era, re-keyed — a Send is a
 * ticket now, and a Verify is an event (LIA-162 AC2, AC3).
 *
 * One set of checks means one set of error strings: the sentence Ask reports when a
 * proposal is refused is the sentence the feature page would have shown for the same
 * click. Nothing here writes: the writers keep the write, the tool keeps nothing.
 *
 * The readers are injected (`SendSources`) rather than imported at the call site, so a test
 * can point them at a temp workspace without mutating `WORKSPACE_DIR` — `bun test` shares
 * one module registry across files, so an env override there would leak.
 */

import type { MarauderDecision } from "../lib/marauder";
import { eventKeys, needsVerify } from "../lib/marauder";
import { isSendable, isTicketKey, REPO_REQUIRED } from "../lib/send";
import type { SendDecision } from "./decisions";
import {
  DECISIONS_DIR,
  readMarauderDecision,
  readSendDecision,
} from "./decisions";
import type { FoundryConfig } from "./foundry";
import type { TeamIssue } from "./linear";
import { openIssues } from "./linear";
import type { Work, WorkEvent } from "./marauder";
import { listWork } from "./marauder";

/** Where the checks read from. Defaults to the workspace on disk and Linear. */
export interface SendSources {
  decisionsDir: string;
  foundry: () => Promise<FoundryConfig>;
  issues: () => Promise<TeamIssue[]>;
  work: () => Promise<Work[]>;
}

/**
 * Foundry is imported lazily: `foundry.ts` reads `FOUNDRY_URL` at module load, so pulling
 * it in through this chain would fix that value before a caller that sets it has run.
 */
export const workspaceSources = (): SendSources => ({
  decisionsDir: DECISIONS_DIR,
  foundry: async () => (await import("./foundry")).foundryConfig(),
  issues: async () => (await openIssues()).issues,
  work: () => listWork(),
});

/** Why the click cannot be made. `decision` is set when the blocker is a file already on disk. */
export interface Blocked {
  decision?: SendDecision;
  error: string;
  ok: false;
}

export type SendCheck =
  | { ok: true; repo: string; ticket: string; work?: Work }
  | Blocked;

export type VerifyCheck =
  | { ok: true; event: WorkEvent; id: string; work: Work }
  | { decided?: MarauderDecision; error: string; ok: false };

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/**
 * What `sendTicket` asks before it reaches Foundry (AC2).
 *
 * The Linear state is the gate the page shows the button on, and it is checked here too:
 * the server function is reachable without the UI, and handing Foundry a ticket someone is
 * already building is the one mistake this button can make. A ticket Linear could not be
 * asked about is let through with the state unknown — refusing every send whenever the key
 * is missing would make the button a liability rather than a check.
 *
 * `repoRequired: false` is the proposal's reading of the same checks: the page offers Send
 * and collects the repo in its form, and a card must be able to do the same.
 */
export async function checkSend(
  ticket: string,
  repo: string,
  sources: SendSources = workspaceSources(),
  opts: { repoRequired?: boolean } = {}
): Promise<SendCheck> {
  const key = trimmed(ticket);
  if (!isTicketKey(key)) {
    return { error: `"${ticket}" is not a ticket key`, ok: false };
  }
  const already = await readSendDecision(key, sources.decisionsDir);
  if (already) {
    return {
      decision: already,
      error: `already sent on ${when(already.at)}`,
      ok: false,
    };
  }
  const issues = await sources.issues();
  const issue = issues.find((i) => i.identifier === key);
  // An empty list is Linear not answering, not a ticket that does not exist (`openIssues`
  // never throws); only a list that has the ticket in another state is a refusal.
  if (issue && !isSendable(issue.stateType)) {
    return {
      error: `${key} is ${issue.state} — Foundry takes a ticket nobody has started`,
      ok: false,
    };
  }
  const where = trimmed(repo);
  if (!where && opts.repoRequired !== false) {
    return { error: REPO_REQUIRED, ok: false };
  }
  const foundry = await sources.foundry();
  if (!foundry.configured) {
    return { error: foundry.reason ?? "Foundry is not configured", ok: false };
  }
  const work = await sources.work();
  return {
    ok: true,
    repo: where,
    ticket: key,
    work: work.find((w) => w.keys.tickets.includes(key)),
  };
}

/** The event that key names, with the feature record carrying it, or null. */
export function locateEvent(
  records: Work[],
  id: string
): { event: WorkEvent; work: Work } | null {
  for (const w of records) {
    const i = eventKeys(w.events).indexOf(id);
    if (i !== -1) {
      const event = w.events[i];
      if (event) {
        return { event, work: w };
      }
    }
  }
  return null;
}

/**
 * What `verifyEvent` asks before it writes `action: "verified"` (AC3) — the user agreeing
 * to the one edit a `directed-at-person` event named, which licenses the next tick's ticket
 * pass to make it.
 *
 * The kind and the audience are checked here, not only on the button: the server function
 * is reachable without the UI, and a confirmation means nothing on an event that never
 * asked the user anything. An event already stamped `confirmed:` is refused with the same
 * sentence the correction gives, so a second click cannot write a second file.
 */
export async function checkVerify(
  id: string,
  sources: SendSources = workspaceSources()
): Promise<VerifyCheck> {
  const key = trimmed(id);
  if (!key) {
    return { error: "no event was named", ok: false };
  }
  const decided = await readMarauderDecision(key, sources.decisionsDir);
  if (decided) {
    return {
      decided,
      error: `already ${decided.action} on ${when(decided.at)}`,
      ok: false,
    };
  }
  const found = locateEvent(await sources.work(), key);
  if (!found) {
    return { error: `no event ${key} on any feature`, ok: false };
  }
  if (!needsVerify(found.event)) {
    return {
      error: found.event.action?.startsWith("confirmed:")
        ? `${key} is already confirmed`
        : `${key} asked you nothing — only an event aimed at you can be confirmed`,
      ok: false,
    };
  }
  return {
    event: found.event,
    id: key,
    ok: true,
    work: found.work,
  };
}
