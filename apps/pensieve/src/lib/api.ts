/**
 * Server functions — the only bridge between the client and the workspace on disk.
 * Each handler lazy-imports the fs reader so nothing node-only reaches the client bundle.
 *
 * Everything here reads, except the two verdicts (`decidePoint`, `sendPoint`) that write
 * one file each under `decisions/` through server/decisions.ts — the app's only writer
 * into the blackboard — and Ask, which writes its conversations under `PENSIEVE_HOME`
 * (server/ask.ts) and nowhere else. Nothing here is a public API — TanStack Start RPC,
 * same as the rest of the app.
 */

import type { UIMessage } from "@tanstack/ai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  AskStatus,
  Conversation,
  ConversationSummary,
} from "#/server/ask";
import type { Decision } from "#/server/decisions";
import type { FoundryConfig, FoundryJob, JobStatus } from "#/server/foundry";
import type { Json, PointsFile } from "#/server/workspace";

export const getInbox = createServerFn({ method: "GET" }).handler(async () => {
  const ws = await import("#/server/workspace");
  const dec = await import("#/server/decisions");
  const ask = await import("#/server/ask");
  const [reports, digests, points, conversations] = await Promise.all([
    ws.listReports(),
    ws.listDigests(),
    ws.readPoints(),
    ask.listConversations(),
  ]);
  const [latestReport] = reports;
  const [latestDigest] = digests;
  const [report, digest] = await Promise.all([
    latestReport ? ws.readReport(latestReport.day) : null,
    latestDigest ? ws.readDigest(latestDigest.day) : null,
  ]);
  // The open count merges the files on disk the same way /points does, so the number
  // the Inbox shows is the number the page lists — even between sweep ticks (AC8).
  const openPoints = points
    ? dec
        .mergeDecisions(points.points, await dec.readDecisions())
        .filter((p) => !p.decision).length
    : null;
  return {
    // Ask's stored conversations — the Inbox links to /ask with this count (LIA-103, AC5).
    conversations: conversations.length,
    digest:
      digest && latestDigest ? { day: latestDigest.day, ...digest } : null,
    openPoints,
    report:
      report && latestReport ? { day: latestReport.day, ...report } : null,
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

export interface PointsPage {
  file: PointsFile | null;
  foundry: FoundryConfig;
}

/** `points.json` with `decisions/` laid over it, plus whether Send is available (AC7). */
export const listPoints = createServerFn({ method: "GET" }).handler(
  async (): Promise<PointsPage> => {
    const ws = await import("#/server/workspace");
    const dec = await import("#/server/decisions");
    const fd = await import("#/server/foundry");
    const [file, onDisk, foundry] = await Promise.all([
      ws.readPoints(),
      dec.readDecisions(),
      fd.foundryConfig(),
    ]);
    return {
      file: file
        ? { ...file, points: dec.mergeDecisions(file.points, onDisk) }
        : null,
      foundry,
    };
  }
);

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
    const ws = await import("#/server/workspace");
    const dec = await import("#/server/decisions");
    if (!dec.isPointId(data.point)) {
      return { error: `"${data.point}" is not a point id`, ok: false };
    }
    if (!data.reason) {
      return { error: "a reason is required to ignore a point", ok: false };
    }
    const file = await ws.readPoints();
    const point = file?.points.find((p) => p.id === data.point);
    if (!point) {
      return { error: "that point is not in reports/points.json", ok: false };
    }
    const existing = await dec.readDecision(point.id);
    if (existing) {
      return {
        error: `already ${existing.action} on ${existing.at.slice(0, 16).replace("T", " ")}`,
        ok: false,
      };
    }
    const decision: Decision = {
      action: "ignored",
      at: new Date().toISOString(),
      point: point.id,
      reason: data.reason,
      subject: point.subject,
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
    const dec = await import("#/server/decisions");
    if (!dec.isPointId(data.point)) {
      return { error: `"${data.point}" is not a point id`, ok: false };
    }
    if (!data.repo) {
      return {
        error: "a repo is required — a path Foundry tracks, or its name",
        ok: false,
      };
    }
    const running = inFlight.get(data.point);
    if (running) {
      return running;
    }
    const task = (async (): Promise<Verdict> => {
      const ws = await import("#/server/workspace");
      const fd = await import("#/server/foundry");
      const file = await ws.readPoints();
      const point = file?.points.find((p) => p.id === data.point);
      if (!point) {
        return { error: "that point is not in reports/points.json", ok: false };
      }
      if (!point.ticket) {
        return {
          error:
            "that point names no ticket — file one first (the sweep's ticket pass)",
          ok: false,
        };
      }
      // A file already on disk is the earlier answer — a retry after a timeout that did
      // in fact land must not ask Foundry again, and must never write a second file.
      const existing = await dec.readDecision(point.id);
      if (existing) {
        return { decision: existing, ok: true, replay: true };
      }
      let job: FoundryJob;
      let replay: boolean;
      try {
        ({ job, replay } = await fd.createJob({
          idempotencyKey: point.id,
          repo: data.repo,
          ticketId: point.ticket,
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
