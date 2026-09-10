/**
 * Server functions — the only bridge between the client and the workspace on disk.
 * Each handler lazy-imports the fs reader so nothing node-only reaches the client bundle.
 *
 * Everything here reads, except three writers: `sendTicket` and `verifyEvent` on a
 * feature page and `decideUnsorted` on the triage queue, each of which writes one file
 * under `decisions/` through server/decisions.ts — the app's only writer into the
 * blackboard; `fileTicket`, which creates one Linear issue (LIA-113) and is the app's only
 * writer outside it; and Argus, which writes its conversations under `PENSIEVE_HOME`
 * (server/ask.ts) and nowhere else. Nothing here is a public API — TanStack Start RPC,
 * same as the rest of the app.
 */

import type { UIMessage } from "@tanstack/ai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MarauderDecision } from "#/lib/marauder";
import {
  checkDraft,
  eventKeys,
  isFeature,
  needsVerify,
  PENSIEVE_USER,
} from "#/lib/marauder";
import { isSendable } from "#/lib/send";
import type {
  AskStatus,
  Conversation,
  ConversationSummary,
  FiledTicket,
} from "#/server/ask";
import type { SendDecision } from "#/server/decisions";
import type {
  FoundryConfig,
  FoundryJob,
  FoundryRepo,
  JobStatus,
} from "#/server/foundry";
import type { LinearConfig } from "#/server/linear";
import type { Milestone, UnsortedItem, Work } from "#/server/marauder";
import type { DayFile, Json, Rendered } from "#/server/workspace";

/** The sidebar's docs tree and the top bar's workspace path — what the shell shows on every page. */
export interface Navigation {
  docs: Array<{
    app: string;
    features: Array<{ feature: string; label: string }>;
  }>;
  /** Entries waiting to be triaged, so the nav says when there is triage to do (AC5). */
  unsorted: number;
  workspace: string;
}

export const getNavigation = createServerFn({ method: "GET" }).handler(
  async (): Promise<Navigation> => {
    const ws = await import("#/server/workspace");
    const mr = await import("#/server/marauder");
    const dec = await import("#/server/decisions");
    const [docs, unsorted, decided] = await Promise.all([
      ws.listDocs(),
      mr.readUnsorted(),
      dec.readMarauderDecisions(),
    ]);
    const byApp = new Map<string, Map<string, string>>();
    for (const d of docs) {
      const short = d.feature.startsWith("/")
        ? d.feature.slice(d.app.length + 1)
        : d.feature;
      const features = byApp.get(d.app) ?? new Map<string, string>();
      // Both tiers name the feature; the first row with a name wins, else the key.
      if (
        !features.has(d.feature) ||
        (d.name && features.get(d.feature) === short)
      ) {
        features.set(d.feature, d.name ?? short);
      }
      byApp.set(d.app, features);
    }
    return {
      docs: Array.from(byApp.entries()).map(([app, features]) => ({
        app,
        features: Array.from(features.entries()).map(([feature, label]) => ({
          feature,
          label,
        })),
      })),
      // Decided rows are still in the file until the next ingest run drops them; the count
      // is what is left to do, not what is left in the file.
      unsorted: unsorted.filter((u) => !decided.has(u.id)).length,
      workspace: ws.WORKSPACE_DIR,
    };
  }
);

/**
 * The archive (/archive): every report and every digest the loop wrote before the board
 * replaced them on 2026-09-09 (LIA-161). Nothing writes these files any more, so the page
 * is a list of days and nothing else — the state of the work is the board's.
 */
export const getArchive = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ digests: DayFile[]; reports: DayFile[] }> => {
    const ws = await import("#/server/workspace");
    const [reports, digests] = await Promise.all([
      ws.listReports(),
      ws.listDigests(),
    ]);
    return { digests, reports };
  }
);

export const listJournal = createServerFn({ method: "GET" }).handler(
  async () => {
    const ws = await import("#/server/workspace");
    return ws.listJournal();
  }
);

export const getJournalEntry = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const ws = await import("#/server/workspace");
    return ws.readJournalEntry(data);
  });

export const listDigests = createServerFn({ method: "GET" }).handler(
  async () => {
    const ws = await import("#/server/workspace");
    return ws.listDigests();
  }
);

export const getDigest = createServerFn({ method: "GET" })
  .validator((day: string) => day)
  .handler(async ({ data }) => {
    const ws = await import("#/server/workspace");
    return ws.readDigest(data);
  });

export const getReport = createServerFn({ method: "GET" })
  .validator((day: string) => day)
  .handler(async ({ data }) => {
    const ws = await import("#/server/workspace");
    return ws.readReport(data);
  });

export const listDocs = createServerFn({ method: "GET" }).handler(async () => {
  const ws = await import("#/server/workspace");
  return ws.listDocs();
});

export const getDoc = createServerFn({ method: "GET" })
  .validator((input: { feature: string; tier: "product" | "arch" }) => input)
  .handler(async ({ data }) => {
    const ws = await import("#/server/workspace");
    return ws.readDoc(data.feature, data.tier);
  });

// ── sending a ticket, and confirming an event: the one write path ──────────────

export type SendResult =
  | { ok: true; decision: SendDecision; replay?: boolean }
  | {
      ok: false;
      status?: number;
      error: string;
      job?: { id: string; status: JobStatus };
    };

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * One send at a time per ticket, in this process: a double click reaches Foundry once and
 * writes once. Across processes the idempotency key — the ticket key — does the same job.
 */
const inFlight = new Map<string, Promise<SendResult>>();

/**
 * Hand a ticket to Foundry (LIA-162 AC2). Exactly one `POST /api/jobs` with
 * `{ ticketId, repo }` and `Idempotency-Key: <ticket key>`; on 202 or 200 the decision file
 * is written with the job. A Foundry error writes nothing and comes back with its `error`
 * text (and on 409, the holding job).
 *
 * A second click is a replay: the file already on disk is the earlier answer, so a retry
 * after a timeout that did in fact land asks Foundry nothing and writes nothing.
 */
export const sendTicket = createServerFn({ method: "POST" })
  .validator((input: { repo: string; ticket: string }) => ({
    repo: trimmed(input.repo),
    ticket: trimmed(input.ticket),
  }))
  .handler(async ({ data }): Promise<SendResult> => {
    const s = await import("#/server/send");
    const check = await s.checkSend(data.ticket, data.repo);
    if (!check.ok) {
      return check.decision
        ? { decision: check.decision, ok: true, replay: true }
        : { error: check.error, ok: false };
    }
    const running = inFlight.get(data.ticket);
    if (running) {
      return running;
    }
    const { repo, ticket } = check;
    const task = (async (): Promise<SendResult> => {
      const dec = await import("#/server/decisions");
      const fd = await import("#/server/foundry");
      let job: FoundryJob;
      let replay: boolean;
      try {
        ({ job, replay } = await fd.createJob({
          idempotencyKey: ticket,
          repo,
          ticketId: ticket,
        }));
      } catch (e) {
        if (e instanceof fd.FoundryError) {
          return { error: e.message, job: e.job, ok: false, status: e.status };
        }
        throw e;
      }
      const decision: SendDecision = {
        action: "sent",
        at: new Date().toISOString(),
        by: PENSIEVE_USER,
        job: { id: job.id, url: fd.jobUrl(job.id) },
        ticket,
      };
      await dec.writeSendDecision(decision);
      return { decision, ok: true, replay };
    })().finally(() => inFlight.delete(data.ticket));
    inFlight.set(data.ticket, task);
    return task;
  });

export type VerifyResult =
  | { ok: true; decision: MarauderDecision; replay?: boolean }
  | { ok: false; error: string };

/**
 * Confirm what a `directed-at-person` event asked (LIA-162 AC3) — the user's go-ahead for
 * the one edit that event named. Writes `decisions/marauder/<event>.json` with
 * `action: "verified"`; the next ingest stamps the event `confirmed:` and the ticket pass
 * then makes the edit. No `work.json` is touched here.
 */
export const verifyEvent = createServerFn({ method: "POST" })
  .validator((input: { event: string; note?: string }) => ({
    event: trimmed(input.event),
    note: trimmed(input.note),
  }))
  .handler(async ({ data }): Promise<VerifyResult> => {
    const dec = await import("#/server/decisions");
    const s = await import("#/server/send");
    const check = await s.checkVerify(data.event);
    if (!check.ok) {
      return check.decided
        ? { decision: check.decided, ok: true, replay: true }
        : { error: check.error, ok: false };
    }
    const decision: MarauderDecision = {
      action: "verified",
      at: new Date().toISOString(),
      by: PENSIEVE_USER,
      id: check.id,
      ...(data.note ? { reason: data.note } : {}),
    };
    await dec.writeMarauderDecision(decision);
    return { decision, ok: true };
  });

export type JobLookup =
  | { ok: true; job: FoundryJob }
  | { ok: false; status?: number; error: string };

/** `GET /api/jobs/:id` — the page polls this while the job is queued or running. */
export const jobStatus = createServerFn({ method: "GET" })
  .validator((id: string) => trimmed(id))
  .handler(async ({ data }): Promise<JobLookup> => {
    const fd = await import("#/server/foundry");
    try {
      return { job: await fd.getJob(data), ok: true };
    } catch (e) {
      if (e instanceof fd.FoundryError) {
        return { error: e.message, ok: false, status: e.status };
      }
      throw e;
    }
  });

// ── ask: Claude Code over the checkout, one conversation per file ──────────────

/** Thread ids the file store accepts — see server/ask.ts `THREAD_ID_RE`. */
const threadId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, "not a thread id");

/**
 * Run one Ask turn and stream it back as SSE. `messages` is the full transcript (what
 * `useChat` holds) or `[]` to continue the stored one; the stored Claude session id is
 * read on the server, so the client never carries it. The handler returns a raw
 * `Response`, which Start hands to the caller untouched, so `useChat({ fetcher })` can
 * parse the event stream itself. With no credential it answers a RUN_ERROR chunk.
 */
export const askChat = createServerFn({ method: "POST" })
  .validator(
    z.object({
      /** The feature the conversation was opened on; stored on the thread's first run. */
      feature: z.string().refine(isFeature, "not a feature").optional(),
      messages: z.array(
        z.custom<UIMessage>(
          (v) =>
            typeof v === "object" && v !== null && "role" in v && "parts" in v
        )
      ),
      runId: z.string().max(128).optional(),
      threadId,
    })
  )
  .handler(async ({ data }) => {
    const ask = await import("#/server/ask");
    const { toServerSentEventsResponse } = await import("@tanstack/ai");
    const { getRequest } = await import("@tanstack/react-start/server");
    // Stop on the page (or a closed tab) aborts the request; that must kill the claude process.
    const abortController = new AbortController();
    getRequest().signal.addEventListener(
      "abort",
      () => abortController.abort(),
      { once: true }
    );
    return toServerSentEventsResponse(
      ask.askStream(data, { abortController }),
      { abortController }
    );
  });

/** Is a credential available for a run — the machine's `claude login`, or `ANTHROPIC_API_KEY`? */
export const askStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<AskStatus> => {
    const ask = await import("#/server/ask");
    return ask.askStatus();
  }
);

/** Every stored conversation, newest first, titled by its first user turn. */
export const listConversations = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConversationSummary[]> => {
    const ask = await import("#/server/ask");
    return ask.listConversations();
  }
);

/**
 * A stored conversation on the wire. `messages` are `UIMessage`s — what `useChat` takes
 * as `initialMessages` — typed as JSON here because Start's serialisability check balks
 * at the `unknown` inside `UIMessage`'s structured-output part; the bytes are the same.
 */
export type ConversationWire = Omit<Conversation, "messages"> & {
  messages: Json[];
};

export const getConversation = createServerFn({ method: "GET" })
  .validator(threadId)
  .handler(async ({ data }): Promise<ConversationWire | null> => {
    const ask = await import("#/server/ask");
    return (await ask.getConversation(data)) as ConversationWire | null;
  });

/** Remove that one file under `PENSIEVE_HOME/conversations/`; answers the remaining list. */
export const deleteConversation = createServerFn({ method: "POST" })
  .validator(threadId)
  .handler(async ({ data }): Promise<ConversationSummary[]> => {
    const ask = await import("#/server/ask");
    return ask.deleteConversation(data);
  });

// ── filing a ticket: the other write path ──────────────────────────────────────

/** The card's two questions in one read: may File be pressed, and was it already? */
export interface TicketPage {
  config: LinearConfig;
  issue: FiledTicket | null;
}

const toolCallId = z.string().min(1).max(256);

/**
 * What the ticket card asks on mount. It never trusts its own replayed tool output for
 * whether the issue exists: a tool part is stored with the conversation and replayed on
 * every reload, so the record in the thread's metadata is the truth (AC3), and
 * `config.configured` is the one branch behind File's disabled state (AC5).
 */
export const getFiledTicket = createServerFn({ method: "GET" })
  .validator(z.object({ threadId, toolCallId }))
  .handler(async ({ data }): Promise<TicketPage> => {
    const ask = await import("#/server/ask");
    const linear = await import("#/server/linear");
    const [config, issue] = await Promise.all([
      linear.linearConfig(),
      ask.readFiledTicket(ask.askStore, data.threadId, data.toolCallId),
    ]);
    return { config, issue: issue ?? null };
  });

export type FileTicketResult =
  | { ok: true; issue: FiledTicket; replay?: boolean }
  | { ok: false; status?: number; error: string };

/**
 * One File press at a time per card, in this process: a double click reaches Linear once
 * and records once. Across processes the metadata record does the same job, since a reload
 * reads it back before offering File again.
 */
const filing = new Map<string, Promise<FileTicketResult>>();

const trimmedText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * File the drafted issue the card is showing. Exactly one `issueCreate` on team Liamai, in
 * the card's project, assigned to the key's owner, with no labels; the issue is recorded
 * under the thread's `ticket:<toolCallId>` key, and a repeat answers that record rather
 * than creating a second issue (AC3).
 *
 * The draft is re-checked here rather than trusted: the card's title and body are editable,
 * so what is filed is not what `propose_ticket` approved.
 */
export const fileTicket = createServerFn({ method: "POST" })
  .validator(
    z.object({
      description: z.string(),
      project: z.string(),
      threadId,
      title: z.string(),
      toolCallId,
    })
  )
  .handler(async ({ data }): Promise<FileTicketResult> => {
    const ask = await import("#/server/ask");
    const stored = await ask.readFiledTicket(
      ask.askStore,
      data.threadId,
      data.toolCallId
    );
    if (stored) {
      return { issue: stored, ok: true, replay: true };
    }
    const key = `${data.threadId}:${data.toolCallId}`;
    const running = filing.get(key);
    if (running) {
      return running;
    }
    const task = (async (): Promise<FileTicketResult> => {
      const linear = await import("#/server/linear");
      const ticket = await import("#/server/ticket");
      const check = await ticket.checkDraft({
        description: trimmedText(data.description),
        project: trimmedText(data.project),
        title: trimmedText(data.title),
      });
      if (!check.ok) {
        return { error: check.error, ok: false };
      }
      const config = linear.linearConfig();
      if (!config.configured) {
        return {
          error: config.reason ?? "LINEAR_API_KEY is not set",
          ok: false,
          status: 503,
        };
      }
      const { draft } = check;
      if (!draft.teamId) {
        return {
          error: `team ${config.team} could not be read from Linear — the key may not reach it`,
          ok: false,
          status: 503,
        };
      }
      let issue: FiledTicket;
      try {
        const made = await linear.createIssue({
          description: draft.description,
          teamId: draft.teamId,
          title: draft.title,
          ...(draft.project.id ? { projectId: draft.project.id } : {}),
          ...(draft.viewerId ? { assigneeId: draft.viewerId } : {}),
        });
        issue = { ...made, at: new Date().toISOString() };
      } catch (e) {
        if (e instanceof linear.LinearError) {
          return { error: e.message, ok: false, status: e.status };
        }
        throw e;
      }
      await ask.writeFiledTicket(
        ask.askStore,
        data.threadId,
        data.toolCallId,
        issue
      );
      return { issue, ok: true };
    })().finally(() => filing.delete(key));
    filing.set(key, task);
    return task;
  });

// ── the board, a feature, and the triage queue (LIA-160, ARG-167) ──────────────

export interface BoardPage {
  /** `marauder/board.md`, or null when no run has rendered one yet. */
  board: Rendered | null;
  /** Left to triage — the badge the board carries through to `/unsorted`. */
  unsorted: number;
}

/**
 * The home page: the board as the sweep rendered it, with its links pointed at the routes
 * that serve them and every feature's name linked to its own page (AC1).
 */
export const getBoard = createServerFn({ method: "GET" }).handler(
  async (): Promise<BoardPage> => {
    const mr = await import("#/server/marauder");
    const dec = await import("#/server/decisions");
    const [features, unsorted, decided] = await Promise.all([
      mr.listFeatures(),
      mr.readUnsorted(),
      dec.readMarauderDecisions(),
    ]);
    return {
      board: await mr.readBoard(undefined, { features }),
      unsorted: unsorted.filter((u) => !decided.has(u.id)).length,
    };
  }
);

/** One ticket on a feature, with everything Send needs to know about it (AC2). */
export interface FeatureTicket {
  /** True when nobody has started it: Send is offered only then. */
  sendable: boolean;
  /** The send already written from here, or null — what makes a second click a replay. */
  sent: SendDecision | null;
  /** Linear's display name for its state, empty when Linear could not be asked. */
  state: string;
  ticket: string;
  title: string;
}

/** One event still waiting on the user, with the key a Verify is written against (AC3). */
export interface FeatureAsk {
  at: string;
  /** What the loop worked out and will not apply until this is confirmed. */
  edit?: string;
  event: string;
  summary: string;
  ticket?: string;
  /** The confirmation already written, or null. */
  verified: MarauderDecision | null;
}

export interface FeaturePage {
  /** The app the feature sits in — what its docs route is keyed on. */
  app: string;
  /** The events aimed at the user that nobody has answered yet, oldest first. */
  asks: FeatureAsk[];
  feature: string;
  foundry: FoundryConfig;
  milestone: Milestone | null;
  name: string;
  page: Rendered | null;
  /** What Send offers as the repo; empty when Foundry could not answer with a list. */
  repos: FoundryRepo[];
  tickets: FeatureTicket[];
  work: Work | null;
}

/**
 * One feature: the page argus renders beside its docs, the record behind it — which is
 * where the tickets and the PRs come from — the milestone it points at, and the two things
 * a reader can do from here: hand a ticket to Foundry, and answer an event that asked them
 * something (LIA-162 AC2, AC3; ARG-167 AC2, AC5). Null when there is no such feature.
 *
 * Linear and Foundry are both asked, and neither can fail the page: `openIssues` never
 * throws and `trackedRepos` swallows its own failures, so a ticket whose state could not
 * be read is offered Send with the state unknown rather than hidden.
 */
export const getFeature = createServerFn({ method: "GET" })
  .validator((feature: string) => feature)
  .handler(async ({ data }): Promise<FeaturePage | null> => {
    const mr = await import("#/server/marauder");
    const dec = await import("#/server/decisions");
    const fd = await import("#/server/foundry");
    const [found, foundry, repos] = await Promise.all([
      mr.readFeature(data),
      fd.foundryConfig(),
      fd.trackedRepos(),
    ]);
    if (!found) {
      return null;
    }
    const w = found.work;
    const [milestones, sent, decided, issues] = await Promise.all([
      w?.milestone ? mr.readMilestones() : ({} as Record<string, Milestone>),
      dec.readSendDecisions(),
      dec.readMarauderDecisions(),
      w && w.keys.tickets.length > 0
        ? (await import("#/server/linear")).openIssues()
        : { issues: [], source: "none" as const },
    ]);
    const keys = w ? eventKeys(w.events) : [];
    return {
      app: found.app,
      asks: (w?.events ?? []).flatMap((e, i) => {
        const event = keys[i] ?? "";
        return needsVerify(e) && event
          ? [
              {
                at: e.at,
                ...(e.action ? { edit: e.action } : {}),
                event,
                summary: e.summary,
                ...(e.ticket ? { ticket: e.ticket } : {}),
                verified: decided.get(event) ?? null,
              },
            ]
          : [];
      }),
      feature: found.feature,
      foundry,
      milestone: w?.milestone ? (milestones[w.milestone] ?? null) : null,
      name: found.name,
      page: found.page,
      repos,
      tickets: (w?.keys.tickets ?? []).map((ticket) => {
        const issue = issues.issues.find((i) => i.identifier === ticket);
        return {
          sendable: isSendable(issue?.stateType),
          sent: sent.get(ticket) ?? null,
          state: issue?.state ?? "",
          ticket,
          title: issue?.title ?? "",
        };
      }),
      work: w,
    };
  });

/** One row of `/features`: a feature with something going on, as the index lists it. */
export interface WorkRow {
  /** How many events on it are still waiting on the user — the badge the row wears. */
  asks: number;
  feature: string;
  milestone: Milestone | null;
  name: string;
  /** Questions still standing on it, whoever's move they are. */
  open: number;
  updated: string;
}

/**
 * Every feature with a `work.json`, most recently moved first, with what each is waiting
 * on the user for — the flat list beside the board.
 */
export const listWork = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkRow[]> => {
    const mr = await import("#/server/marauder");
    const dec = await import("#/server/decisions");
    const [work, milestones, decided] = await Promise.all([
      mr.listWork(),
      mr.readMilestones(),
      dec.readMarauderDecisions(),
    ]);
    return work.map((w) => {
      const keys = eventKeys(w.events);
      return {
        asks: w.events.filter(
          (e, i) => needsVerify(e) && !decided.has(keys[i] ?? "")
        ).length,
        feature: w.feature,
        milestone: w.milestone ? (milestones[w.milestone] ?? null) : null,
        name: w.name,
        open: w.openQuestions.length,
        updated: w.updated,
      };
    });
  }
);

export interface UnsortedPage {
  /** The decision already written on an entry, by the entry's own id. */
  decided: [string, MarauderDecision][];
  /** Every feature a row may attach to, by manifest name (ARG-167 AC3). */
  features: Array<{ feature: string; name: string }>;
  items: UnsortedItem[];
}

/**
 * The corrections queue: every entry ingest could not attach, newest first, with whatever
 * has already been decided about it laid over the top (AC3). A `Map` does not survive the
 * wire, so the pairs travel as an array.
 */
export const getUnsorted = createServerFn({ method: "GET" }).handler(
  async (): Promise<UnsortedPage> => {
    const mr = await import("#/server/marauder");
    const dec = await import("#/server/decisions");
    const [items, features, decided] = await Promise.all([
      mr.readUnsorted(),
      mr.listFeatures(),
      dec.readMarauderDecisions(),
    ]);
    return {
      decided: Array.from(decided.entries()),
      features: features
        .map((f) => ({ feature: f.feature, name: f.name }))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.feature.localeCompare(b.feature)
        ),
      items,
    };
  }
);

/** What Ask's card asks on mount: has this entry, or this ticket, already been decided? */
export interface DecidedLookup {
  decided: MarauderDecision | null;
  /** As on the feature page — the same list, for the same field on the card. */
  repos: FoundryRepo[];
  sent: SendDecision | null;
}

/**
 * Whatever is already on disk for one entry or one ticket, with Foundry's repo list. The
 * card never trusts its own replayed tool output for whether the click has been made, so
 * this is the read behind it — and the repos are the field it collects for a send.
 */
export const getDecided = createServerFn({ method: "GET" })
  .validator((input: { id?: string; ticket?: string }) => input)
  .handler(async ({ data }): Promise<DecidedLookup> => {
    const dec = await import("#/server/decisions");
    const fd = await import("#/server/foundry");
    const [repos, sent, decided] = await Promise.all([
      fd.trackedRepos(),
      data.ticket ? dec.readSendDecision(data.ticket) : null,
      data.id ? dec.readMarauderDecision(data.id) : null,
    ]);
    return { decided, repos, sent };
  });

export type UnsortedVerdict =
  | { ok: true; decision: MarauderDecision; replay?: boolean }
  | { ok: false; error: string };

/**
 * Decide one Unsorted entry: one `decisions/marauder/<slug>.json`, through the same atomic
 * writer every other verdict uses. No `work.json` is touched here — the next `marauder
 * ingest` applies the file through its correction functions, drops the entry from the queue
 * and commits, which is what keeps this app's one-writer rule (AC3, AC4).
 *
 * A second click on the same entry is a no-op that answers the file already there: a
 * decision file is never edited afterwards, and re-deciding would otherwise write a second,
 * later verdict over a correction the sweep may already have applied.
 */
export const decideUnsorted = createServerFn({ method: "POST" })
  .validator(
    (input: {
      action: string;
      feature?: string;
      id: string;
      reason?: string;
    }) => input
  )
  .handler(async ({ data }): Promise<UnsortedVerdict> => {
    const dec = await import("#/server/decisions");
    const draft = {
      action: trimmed(data.action),
      feature: trimmed(data.feature),
      id: trimmed(data.id),
      reason: trimmed(data.reason),
    };
    const error = checkDraft(draft);
    if (error) {
      return { error, ok: false };
    }
    const already = await dec.readMarauderDecision(draft.id);
    if (already) {
      return { decision: already, ok: true, replay: true };
    }
    const decision: MarauderDecision = {
      action: draft.action as MarauderDecision["action"],
      at: new Date().toISOString(),
      by: PENSIEVE_USER,
      id: draft.id,
      ...(draft.action === "attach" ? { feature: draft.feature } : {}),
      ...(draft.reason ? { reason: draft.reason } : {}),
    };
    await dec.writeMarauderDecision(decision);
    return { decision, ok: true };
  });
