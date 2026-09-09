/**
 * Server functions — the only bridge between the client and the workspace on disk.
 * Each handler lazy-imports the fs reader so nothing node-only reaches the client bundle.
 *
 * Everything here reads, except the two verdicts (`decidePoint`, `sendPoint`) that write
 * one file each under `decisions/` through server/decisions.ts — the app's only writer
 * into the blackboard — `fileTicket`, which creates one Linear issue (LIA-113) and is the
 * app's only writer outside it, and Argus, which writes its conversations under
 * `PENSIEVE_HOME` (server/ask.ts) and nowhere else. Nothing here is a public API —
 * TanStack Start RPC, same as the rest of the app.
 */

import type { UIMessage } from "@tanstack/ai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isPointId, POINT_ID_RE } from "#/lib/points";
import type {
  AskStatus,
  Conversation,
  ConversationSummary,
  FiledTicket,
} from "#/server/ask";
import type { Decision } from "#/server/decisions";
import type {
  FoundryConfig,
  FoundryJob,
  FoundryRepo,
  JobStatus,
} from "#/server/foundry";
import type { LinearConfig } from "#/server/linear";
import type { Json, Point } from "#/server/workspace";

export const getInbox = createServerFn({ method: "GET" }).handler(async () => {
  const ws = await import("#/server/workspace");
  const { loadQueue } = await import("#/server/queue");
  const { dropSection, dropTldr } = await import("#/server/sections");
  const ask = await import("#/server/ask");
  const [reports, digests, queue, conversations] = await Promise.all([
    ws.listReports(),
    ws.listDigests(),
    loadQueue(),
    ask.listConversations(),
  ]);
  const [latestReport] = reports;
  const [latestDigest] = digests;
  const report = latestReport ? await ws.readReport(latestReport.day) : null;
  return {
    // Ask's stored conversations — the page links to /ask with this count (LIA-103, AC5).
    conversations: conversations.length,
    digest: latestDigest
      ? { day: latestDigest.day, lede: latestDigest.lede }
      : null,
    // The queue is the report's Needs-you section with `decisions/` laid over it, so the
    // report itself is shown without that section — and without the TL;DR callout that
    // restates it; the summary sentence stays.
    queue,
    report:
      report && latestReport
        ? {
            day: latestReport.day,
            doc: dropTldr(dropSection(report.doc, "Needs you")),
            path: report.path,
          }
        : null,
    workspace: ws.WORKSPACE_DIR,
  };
});

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

export const listReports = createServerFn({ method: "GET" }).handler(
  async () => {
    const ws = await import("#/server/workspace");
    return ws.listReports();
  }
);

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

// ── points: the one write path ─────────────────────────────────────────────────

export interface PointPage {
  foundry: FoundryConfig;
  point: Point | null;
  /** As on the home page's queue — the same list, for the same field on the conversation's card. */
  repos: FoundryRepo[];
}

/**
 * One point by id, with its decision file laid over it, whether Send is available and the
 * repos it may target — what a conversation opened on a point needs to show it and act on
 * it (LIA-109, LIA-120). `null` when the id names nothing in the last tick's `points.json`.
 * Foundry is asked before the id is, so a card on a stale point still gets the list.
 */
export const getPoint = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<PointPage> => {
    const ws = await import("#/server/workspace");
    const dec = await import("#/server/decisions");
    const fd = await import("#/server/foundry");
    const [foundry, repos] = await Promise.all([
      fd.foundryConfig(),
      fd.trackedRepos(),
    ]);
    if (!isPointId(data)) {
      return { foundry, point: null, repos };
    }
    const [file, decision] = await Promise.all([
      ws.readPoints(),
      dec.readDecision(data),
    ]);
    const point = file?.points.find((p) => p.id === data) ?? null;
    return {
      foundry,
      point: point && decision ? { ...point, decision } : point,
      repos,
    };
  });

export type Verdict =
  | { ok: true; decision: Decision; replay?: boolean }
  | {
      ok: false;
      status?: number;
      error: string;
      job?: { id: string; status: JobStatus };
    };

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Ignore a point with a reason. Writes `decisions/<group>/<slug>.json` with `action: "ignored"`. */
export const decidePoint = createServerFn({ method: "POST" })
  .validator((input: { point: string; reason: string }) => ({
    point: trimmed(input.point),
    reason: trimmed(input.reason),
  }))
  .handler(async ({ data }): Promise<Verdict> => {
    const dec = await import("#/server/decisions");
    const v = await import("#/server/verdict");
    const check = await v.checkIgnore(data.point, data.reason);
    if (!check.ok) {
      return { error: check.error, ok: false };
    }
    const decision: Decision = {
      action: "ignored",
      at: new Date().toISOString(),
      point: check.point.id,
      reason: check.reason,
      subject: check.point.subject,
    };
    await dec.writeDecision(decision);
    return { decision, ok: true };
  });

/**
 * Confirm a Verify-group point — the user agreeing with an inference the sweep made, which
 * licenses the sweep's next tick to make the edit the point names (LIA-114/115). Writes
 * `decisions/verify/<slug>.json` with `action: "verified"`.
 *
 * `decidePoint`'s shape with two differences: the note is optional, and it is spread in only
 * when one was given, so the file carries no empty `reason` key. Foundry is never consulted
 * — nothing on this path imports `server/foundry`, so a verdict lands with the token unset.
 */
export const verifyPoint = createServerFn({ method: "POST" })
  .validator((input: { note: string; point: string }) => ({
    note: trimmed(input.note),
    point: trimmed(input.point),
  }))
  .handler(async ({ data }): Promise<Verdict> => {
    const dec = await import("#/server/decisions");
    const v = await import("#/server/verdict");
    const check = await v.checkVerify(data.point, data.note);
    if (!check.ok) {
      return { error: check.error, ok: false };
    }
    const decision: Decision = {
      action: "verified",
      at: new Date().toISOString(),
      point: check.point.id,
      ...(check.reason ? { reason: check.reason } : {}),
      subject: check.point.subject,
    };
    await dec.writeDecision(decision);
    return { decision, ok: true };
  });

/**
 * One send at a time per point, in this process: a double click reaches Foundry once and
 * writes once. Across processes the idempotency key (the point id) does the same job.
 */
const inFlight = new Map<string, Promise<Verdict>>();

/**
 * Send a point's ticket to Foundry. Exactly one `POST /api/jobs` with `{ ticketId, repo }`
 * and `Idempotency-Key: <point id>`; on 202 or 200 the decision file is written with the
 * job. A Foundry error writes nothing and comes back with its `error` text (and on 409,
 * the holding job).
 */
export const sendPoint = createServerFn({ method: "POST" })
  .validator((input: { point: string; repo: string }) => ({
    point: trimmed(input.point),
    repo: trimmed(input.repo),
  }))
  .handler(async ({ data }): Promise<Verdict> => {
    const v = await import("#/server/verdict");
    const check = await v.checkSend(data.point, data.repo);
    if (!check.ok) {
      // A file already on disk is the earlier answer — a retry after a timeout that did
      // in fact land must not ask Foundry again, and must never write a second file.
      return check.decision
        ? { decision: check.decision, ok: true, replay: true }
        : { error: check.error, ok: false };
    }
    const running = inFlight.get(data.point);
    if (running) {
      return running;
    }
    const { point, repo, ticket } = check;
    const task = (async (): Promise<Verdict> => {
      const dec = await import("#/server/decisions");
      const fd = await import("#/server/foundry");
      let job: FoundryJob;
      let replay: boolean;
      try {
        ({ job, replay } = await fd.createJob({
          idempotencyKey: point.id,
          repo,
          ticketId: ticket,
        }));
      } catch (e) {
        if (e instanceof fd.FoundryError) {
          return { error: e.message, job: e.job, ok: false, status: e.status };
        }
        throw e;
      }
      const decision: Decision = {
        action: "sent",
        at: new Date().toISOString(),
        job: { id: job.id, url: fd.jobUrl(job.id) },
        point: point.id,
        subject: point.subject,
      };
      await dec.writeDecision(decision);
      return { decision, ok: true, replay };
    })().finally(() => inFlight.delete(data.point));
    inFlight.set(data.point, task);
    return task;
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
      messages: z.array(
        z.custom<UIMessage>(
          (v) =>
            typeof v === "object" && v !== null && "role" in v && "parts" in v
        )
      ),
      /** The point the conversation was opened on; stored on the thread's first run. */
      point: z.string().regex(POINT_ID_RE).optional(),
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
