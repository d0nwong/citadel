/**
 * The server functions the pages call. Reads come from the workspace (the ledgers, the
 * arch docs, Ask's conversations); every write to the argus checkout goes through
 * `server/argus.ts`, which runs one `argus` verb, and the two writes that leave the app go
 * to a ticket provider — Linear or, for an alden-portal feature, the Alden Trello board
 * (CTD-207), through `@citadel/tickets` — and to Foundry (a job). Nothing here touches a
 * ledger directly.
 */

import type { UIMessage } from "@tanstack/ai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSendable, REPO_REQUIRED } from "#/lib/send";
import type {
  AskStatus,
  Conversation,
  ConversationSummary,
  FiledTicket,
} from "#/server/ask";
import type { FoundryJob, FoundryRepo } from "#/server/foundry";
import type { Home, LedgerRef, PipelineCard } from "#/server/ledger";
import type { Json } from "#/server/workspace";
import type { WorktreeDiscardCounts } from "#/server/worktrees";

const trimmed = (v: string) => v.trim();

/** a feature is its directory under an app's features/, one level of nesting at most */
const isFeature = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(v);

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
    const lg = await import("#/server/ledger");
    const [docs, unplaced] = await Promise.all([
      ws.listDocs(),
      lg.readUnplaced(),
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
      unsorted: unplaced.length,
      workspace: ws.WORKSPACE_DIR,
    };
  }
);

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
    const { withKeepalive } = await import("#/server/keepalive");
    // A comment every 15 s keeps proxies with an idle limit from cutting a quiet stretch.
    return withKeepalive(
      toServerSentEventsResponse(ask.askStream(data, { abortController }), {
        abortController,
      })
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

/**
 * What Delete discards beyond the file (CTD-223, S-44): `null` in container mode, or before a
 * conversation's first question has cut its worktrees — Delete's confirm shows this plainly.
 */
export const getConversationDiscard = createServerFn({ method: "GET" })
  .validator(threadId)
  .handler(async ({ data }): Promise<WorktreeDiscardCounts | null> => {
    const ask = await import("#/server/ask");
    return ask.conversationDiscardCounts(data);
  });

/**
 * Land a local-mode conversation's citadel-data worktree on main and remove both worktrees
 * and both local branches (CTD-222). A no-op on a conversation with no worktrees — never run
 * locally, or already finished.
 */
export const finishConversation = createServerFn({ method: "POST" })
  .validator(threadId)
  .handler(async ({ data }): Promise<void> => {
    const ask = await import("#/server/ask");
    await ask.finishConversation(data);
  });

// ── filing a ticket: the other write path ──────────────────────────────────────

/** Is File available — the credential of whichever provider the draft's team routes to. */
export interface TicketConfig {
  configured: boolean;
  reason?: string;
}

/** The card's two questions in one read: may File be pressed, and was it already? */
export interface TicketPage {
  config: TicketConfig;
  issue: FiledTicket | null;
}

const toolCallId = z.string().min(1).max(256);

/**
 * What the ticket card asks on mount. It never trusts its own replayed tool output for
 * whether the issue exists: a tool part is stored with the conversation and replayed on
 * every reload, so the record in the thread's metadata is the truth (AC3), and
 * `config.configured` is the one branch behind File's disabled state (AC5). `team` is the
 * proposal's own team, so the credential named is the one the draft would actually file on
 * (AC1) rather than always Linear's.
 */
export const getFiledTicket = createServerFn({ method: "GET" })
  .validator(z.object({ team: z.string().optional(), threadId, toolCallId }))
  .handler(async ({ data }): Promise<TicketPage> => {
    const ask = await import("#/server/ask");
    const ticket = await import("#/server/ticket");
    const team = ticket.teamFor(data.team) ?? ticket.TEAMS[0];
    const [config, issue] = await Promise.all([
      ticket.providerConfigFor(team),
      ask.readFiledTicket(ask.askStore, data.threadId, data.toolCallId),
    ]);
    return { config, issue: issue ?? null };
  });

export type FileTicketResult =
  | { ok: true; issue: FiledTicket; replay?: boolean; note?: string }
  | { ok: false; status?: number; error: string };

/**
 * One File press at a time per card, in this process: a double click reaches Linear once
 * and records once. Across processes the metadata record does the same job, since a reload
 * reads it back before offering File again.
 */
const filing = new Map<string, Promise<FileTicketResult>>();

const trimmedText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * File the drafted ticket the card is showing, on whichever provider the draft's team
 * routes to — Linear for Citadel, the Alden Trello board for Alden (CTD-207) — through
 * `@citadel/tickets`' `createTicket`, which creates a missing project or label itself; the
 * ticket is recorded under the thread's `ticket:<toolCallId>` key, and a repeat answers that
 * record rather than filing a second one (AC3). Citadel is always assigned to Liam (spec
 * S-19); Alden defaults unassigned, taking the picker's board-member id when one is sent
 * (spec S-21).
 *
 * The draft is re-checked here rather than trusted: the card's title and body are editable,
 * so what is filed is not what `propose_ticket` approved.
 */
/**
 * After File: on the confirmed feature's ledger the ticket shows in Home's Ready with Send
 * (`argus ticket <dir> <key> --title`). With no feature, Home reads it back from the
 * thread's record instead. A ledger that refuses it still leaves the issue filed.
 */
async function recordFiled(
  issue: FiledTicket,
  feature: string | undefined,
  title: string
): Promise<FileTicketResult> {
  if (!feature) {
    return { issue, ok: true };
  }
  const a = await import("#/server/argus");
  const recorded = await a.argus("ticket", [
    feature,
    issue.identifier,
    "--title",
    title,
  ]);
  return recorded.ok
    ? { issue, ok: true }
    : {
        issue,
        note: `${issue.identifier} was filed, but the ledger did not take it: ${a.argusNote(recorded)}`,
        ok: true,
      };
}

export const fileTicket = createServerFn({ method: "POST" })
  .validator(
    z.object({
      /** A board member's id — the picker's own choice (ticket 11); absent files unassigned. */
      assignee: z.string().optional(),
      description: z.string(),
      feature: z.string().optional(),
      project: z.string(),
      team: z.string().optional(),
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
      const tickets = await import("@citadel/tickets");
      const ticket = await import("#/server/ticket");
      const check = await ticket.checkDraft({
        description: trimmedText(data.description),
        feature: trimmedText(data.feature),
        project: trimmedText(data.project),
        team: trimmedText(data.team),
        title: trimmedText(data.title),
      });
      if (!check.ok) {
        return { error: check.error, ok: false };
      }
      const { draft } = check;
      const config = ticket.providerConfigFor(draft.team);
      if (!config.configured) {
        return {
          error: config.reason ?? "the ticket provider is not configured",
          ok: false,
          status: 503,
        };
      }
      const assignee = trimmedText(data.assignee);
      let issue: FiledTicket;
      try {
        const made = await tickets.createTicket({
          assigneeId: draft.team.key === "CTD" ? "me" : assignee || undefined,
          description: draft.description,
          project: draft.project.name,
          team: draft.team.key,
          title: draft.title,
        });
        issue = {
          at: new Date().toISOString(),
          id: made.key,
          identifier: made.key,
          title: draft.title,
          url: made.url,
          ...(draft.feature ? { feature: draft.feature } : {}),
        };
      } catch (e) {
        if (e instanceof tickets.MissingCredentialError) {
          return { error: `${e.variable} is not set`, ok: false, status: 503 };
        }
        return {
          error: e instanceof Error ? e.message : String(e),
          ok: false,
        };
      }
      await ask.writeFiledTicket(
        ask.askStore,
        data.threadId,
        data.toolCallId,
        issue
      );
      return recordFiled(issue, draft.feature, draft.title);
    })().finally(() => filing.delete(key));
    filing.set(key, task);
    return task;
  });

/** The Alden board's own members, and whether Trello is configured — the assignee picker's read (ticket 11). */
export interface AldenBoardMembers {
  configured: boolean;
  members: Array<{ id: string; name: string }>;
  reason?: string;
}

/** `GET /1/boards/{id}/members` through `@citadel/tickets`, for an alden-portal draft's assignee picker. */
export const getAldenBoardMembers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AldenBoardMembers> => {
    const tickets = await import("@citadel/tickets");
    try {
      const members = await tickets.trelloMembers();
      return {
        configured: true,
        members: members.map((m) => ({
          id: m.id,
          name: m.fullName || m.username,
        })),
      };
    } catch (e) {
      return {
        configured: false,
        members: [],
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }
);

// ── the board, a feature, and the triage queue (LIA-160, CTD-167) ──────────────

/**
 * The Alden board's Pipeline and High Priority Pipeline cards, whichever the ledgers do or
 * don't already track — a revision's parent card (the one whose checklist lists its
 * sub-cards) is left out, since its sub-cards are the work (AC3). With no Trello credential,
 * or the board unreachable, there is simply nothing to add here.
 */
async function pipelineCandidates(
  tickets: typeof import("@citadel/tickets")
): Promise<PipelineCard[]> {
  let open: Awaited<ReturnType<typeof tickets.listOpenTickets>>;
  try {
    open = await tickets.listOpenTickets({ team: "AP" });
  } catch {
    return [];
  }
  const candidates = open.filter(
    (t) => t.state.state === "open" && t.state.stage === "unstarted"
  );
  // A card referenced as some other candidate's parent is the revision's parent, not the work.
  const parents = new Set<string>();
  for (const t of candidates) {
    try {
      const full = await tickets.getTicket(t.key);
      if (full?.parentKey) {
        parents.add(full.parentKey);
      }
    } catch {
      // a checklist that could not be read leaves this card's parent unknown; it stays a candidate
    }
  }
  return candidates
    .filter((t) => !parents.has(t.key))
    .map((t) => {
      const s = t.state;
      return {
        highPriority: s.state === "open" && s.name === "High Priority Pipeline",
        key: t.key,
        state: s,
        title: t.title,
      };
    });
}

/** The home page: on you, ready, unplaced, and one line per feature. */
export const getHome = createServerFn({ method: "GET" }).handler(
  async (): Promise<Home> => {
    const l = await import("#/server/ledger");
    const lib = await import("#/lib/ledger");
    const ask = await import("#/server/ask");
    const linear = await import("#/server/linear");
    const tickets = await import("@citadel/tickets");

    // Tickets filed from Ask with no feature have no ledger; their provider says when they are done (AC1).
    const loose = (await ask.listFiledTickets()).filter((t) => !t.feature);

    // Every ledger's own ready tickets, so their live state and assignee can be read in one batch (AC2).
    const { ledgers } = await l.listLedgers();
    const ledgerKeys = ledgers.flatMap(({ ledger }) =>
      lib.readyTickets(ledger).map((t) => t.key)
    );
    const states = await tickets.ticketStates([
      ...ledgerKeys,
      ...loose.map((t) => t.identifier),
    ]);

    const open = loose.filter((t) => {
      const s = states(t.identifier);
      return s.state !== "done" && s.state !== "canceled";
    });

    // Liam's own id on each provider — whose tickets, and Pipeline cards, are his to work on.
    const [{ viewerId: linearViewer }, trelloViewer, pipelineCards] =
      await Promise.all([
        linear.knownProjects(),
        tickets.trelloViewerId(),
        pipelineCandidates(tickets),
      ]);

    return l.home(
      undefined,
      undefined,
      open,
      states,
      { linear: linearViewer ?? null, trello: trelloViewer },
      pipelineCards
    );
  }
);

/** One feature's ledger by its route param, with the app it lives in. */
export const getLedger = createServerFn({ method: "GET" })
  .validator((feature: string) => trimmed(feature))
  .handler(async ({ data }): Promise<LedgerRef | null> => {
    const l = await import("#/server/ledger");
    return l.readLedger(data);
  });

export type LedgerWrite =
  | { ok: true; wrote: boolean; diff: string[] }
  | { error: string; ok: false };

type WriteAnswer = import("#/server/argus").ArgusResult<{
  wrote?: boolean;
  diff?: string[];
}>;

const toWrite = (
  r: WriteAnswer,
  note: (r: WriteAnswer) => string | null
): LedgerWrite =>
  r.ok
    ? {
        diff: Array.isArray(r.diff) ? (r.diff as string[]) : [],
        ok: true,
        wrote: r.wrote === true,
      }
    : { error: note(r) ?? "argus refused", ok: false };

/** Done: close an ask by the reader's say-so. `argus close <dir> <A-n> --reason`. */
export const closeAsk = createServerFn({ method: "POST" })
  .validator((input: { dir: string; ask: string; reason: string }) => ({
    ask: trimmed(input.ask),
    dir: trimmed(input.dir),
    reason: trimmed(input.reason),
  }))
  .handler(async ({ data }): Promise<LedgerWrite> => {
    if (!data.reason) {
      return { error: "Say in a few words why it is done.", ok: false };
    }
    const a = await import("#/server/argus");
    return toWrite(
      await a.argus<{ wrote?: boolean; diff?: string[] }>("close", [
        data.dir,
        data.ask,
        "--reason",
        data.reason,
      ]),
      a.argusNote
    );
  });

/** Confirm or contradict a requirement. `argus confirm <dir> <R-n> --reason [--contradict]`. */
export const confirmRequirement = createServerFn({ method: "POST" })
  .validator(
    (input: {
      dir: string;
      requirement: string;
      reason: string;
      contradict?: boolean;
    }) => ({
      contradict: input.contradict === true,
      dir: trimmed(input.dir),
      reason: trimmed(input.reason),
      requirement: trimmed(input.requirement),
    })
  )
  .handler(async ({ data }): Promise<LedgerWrite> => {
    if (!data.reason) {
      return { error: "Say who settled it, or how you know.", ok: false };
    }
    const a = await import("#/server/argus");
    const args = [data.dir, data.requirement, "--reason", data.reason];
    if (data.contradict) {
      args.push("--contradict");
    }
    return toWrite(
      await a.argus<{ wrote?: boolean; diff?: string[] }>("confirm", args),
      a.argusNote
    );
  });

/** Confirm every assumed requirement of a feature at once. */
export const confirmAll = createServerFn({ method: "POST" })
  .validator((input: { dir: string; reason: string }) => ({
    dir: trimmed(input.dir),
    reason: trimmed(input.reason),
  }))
  .handler(async ({ data }): Promise<LedgerWrite> => {
    if (!data.reason) {
      return { error: "Say why they all hold.", ok: false };
    }
    const a = await import("#/server/argus");
    return toWrite(
      await a.argus<{ wrote?: boolean; diff?: string[] }>("confirm", [
        data.dir,
        "--all",
        "--reason",
        data.reason,
      ]),
      a.argusNote
    );
  });

export type PlaceWrite =
  | { ok: true; feature: string; thread: string | null }
  | { error: string; ok: false };

/** Place an unplaced message on a feature. `argus place <id> <dir>`; the thread learns it. */
export const placeUnplaced = createServerFn({ method: "POST" })
  .validator((input: { id: string; dir: string }) => ({
    dir: trimmed(input.dir),
    id: trimmed(input.id),
  }))
  .handler(async ({ data }): Promise<PlaceWrite> => {
    if (!data.dir) {
      return { error: "Pick a feature.", ok: false };
    }
    const a = await import("#/server/argus");
    const r = await a.argus<{ feature: string; thread: string | null }>(
      "place",
      [data.id, data.dir]
    );
    return r.ok
      ? { feature: r.feature, ok: true, thread: r.thread }
      : { error: a.argusNote(r) ?? "argus refused", ok: false };
  });

export type FileProposalResult =
  | { ok: true; key: string; url: string; project: string | null }
  | { error: string; ok: false; status?: number };

/**
 * File a proposal from a feature's ledger: `argus file` says what the card is and where it
 * goes — the Alden board's Pipeline list, the label named after the feature (`argus file`
 * is alden-portal only; a Citadel ticket never reaches it) — `@citadel/tickets`' `createTicket`
 * makes the card, and `argus ticket` writes the key onto the ledger. The one place a ledger
 * proposal reaches a ticket provider.
 */
export const fileProposal = createServerFn({ method: "POST" })
  .validator((input: { dir: string; proposal: string }) => ({
    dir: trimmed(input.dir),
    proposal: trimmed(input.proposal),
  }))
  .handler(async ({ data }): Promise<FileProposalResult> => {
    const a = await import("#/server/argus");
    const tickets = await import("@citadel/tickets");
    const ticket = await import("#/server/ticket");
    const draft = await a.argus<{
      title: string;
      body: string;
      label: string;
      assignee?: string;
    }>("file", [data.dir, data.proposal]);
    if (!draft.ok) {
      return { error: a.argusNote(draft) ?? "argus refused", ok: false };
    }
    const config = ticket.providerConfigFor(ticket.TEAMS[0]);
    if (!config.configured) {
      return {
        error: config.reason ?? "the Alden board is not configured",
        ok: false,
        status: 503,
      };
    }
    let made: { key: string; url: string };
    try {
      made = await tickets.createTicket({
        assigneeId: draft.assignee,
        description: draft.body,
        project: draft.label,
        team: "AP",
        title: draft.title,
      });
    } catch (e) {
      if (e instanceof tickets.MissingCredentialError) {
        return { error: `${e.variable} is not set`, ok: false, status: 503 };
      }
      return { error: e instanceof Error ? e.message : String(e), ok: false };
    }
    const recorded = await a.argus("ticket", [
      data.dir,
      data.proposal,
      made.key,
    ]);
    if (!recorded.ok) {
      return {
        error: `${made.key} was filed, but the ledger did not take it: ${a.argusNote(recorded)}`,
        ok: false,
      };
    }
    return {
      key: made.key,
      ok: true,
      project: draft.label,
      url: made.url,
    };
  });

export type SendReadyResult =
  | {
      ok: true;
      job: { id: string; url: string };
      replay: boolean;
      note?: string;
    }
  | { error: string; ok: false; status?: number };

/**
 * Send a ready ticket to Foundry: `POST /api/jobs` with the ticket as the idempotency key,
 * then `argus sent` records the job on the ledger. Pensieve posts because it holds the
 * Foundry token and the client; argus keeps the record.
 *
 * An `AP` card is refused when its list is neither Pipeline nor High Priority Pipeline — the
 * board's own answer for "nobody has started it" — and an unanswered board lets the send
 * through rather than blocking on it (AC2). The card is left on its own list — Ready for
 * Agent is not used, so a sent ticket just stays in Pipeline until `claim` moves it.
 */
export const sendReady = createServerFn({ method: "POST" })
  .validator((input: { dir: string; ticket: string; repo: string }) => ({
    dir: trimmed(input.dir),
    repo: trimmed(input.repo),
    ticket: trimmed(input.ticket),
  }))
  .handler(async ({ data }): Promise<SendReadyResult> => {
    if (!data.repo) {
      return { error: REPO_REQUIRED, ok: false };
    }
    const fd = await import("#/server/foundry");
    const a = await import("#/server/argus");
    const tickets = await import("@citadel/tickets");

    if (tickets.providerNameFor(data.ticket) === "trello") {
      const states = await tickets.ticketStates([data.ticket]);
      const state = states(data.ticket);
      if (
        state.state === "done" ||
        state.state === "canceled" ||
        (state.state === "open" && !isSendable(state.stage))
      ) {
        return {
          error: `${data.ticket} is ${state.name} — Foundry takes a ticket nobody has started`,
          ok: false,
        };
      }
    }

    let job: FoundryJob;
    let replay: boolean;
    try {
      ({ job, replay } = await fd.createJob({
        idempotencyKey: data.ticket,
        repo: data.repo,
        ticketId: data.ticket,
      }));
    } catch (e) {
      if (e instanceof fd.FoundryError) {
        return { error: e.message, ok: false, status: e.status };
      }
      throw e;
    }
    // A Pipeline card on no ledger has no feature to record the send on: Foundry has the
    // job, and the row says so rather than calling `argus sent` with an empty feature.
    if (!data.dir) {
      const unrecorded = `${data.ticket} is on no ledger, so the send is not recorded there`;
      return {
        job: { id: job.id, url: fd.jobUrl(job.id) },
        note: unrecorded,
        ok: true,
        replay,
      };
    }
    const recorded = await a.argus("sent", [
      data.dir,
      data.ticket,
      "--repo",
      data.repo,
      "--job",
      job.id,
    ]);
    if (!recorded.ok) {
      return {
        error: `Foundry took ${data.ticket}, but the ledger did not record it: ${a.argusNote(recorded)}`,
        ok: false,
      };
    }
    return {
      job: { id: job.id, url: fd.jobUrl(job.id) },
      ok: true,
      replay,
    };
  });

/** What Send needs on the home page: whether Foundry is reachable and the repos it tracks. */
export const getSendOptions = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    configured: boolean;
    reason?: string;
    repos: FoundryRepo[];
  }> => {
    const fd = await import("#/server/foundry");
    const c = fd.foundryConfig();
    return {
      configured: c.configured,
      reason: c.reason,
      repos: c.configured ? await fd.trackedRepos() : [],
    };
  }
);

/** Ignore: drop an ask that was never one, or is not wanted. `argus drop <dir> <A-n> --reason`. */
export const dropAsk = createServerFn({ method: "POST" })
  .validator((input: { dir: string; ask: string; reason: string }) => ({
    ask: trimmed(input.ask),
    dir: trimmed(input.dir),
    reason: trimmed(input.reason),
  }))
  .handler(async ({ data }): Promise<LedgerWrite> => {
    if (!data.reason) {
      return { error: "Say in a few words why it is not an ask.", ok: false };
    }
    const a = await import("#/server/argus");
    return toWrite(
      await a.argus<{ wrote?: boolean; diff?: string[] }>("drop", [
        data.dir,
        data.ask,
        "--reason",
        data.reason,
      ]),
      a.argusNote
    );
  });

/**
 * Ticket: file an ask straight onto the Alden board. `argus file <dir> <A-n>` hands back the
 * reader's proposal covering the ask (and refuses when there is none) as a card in the
 * Pipeline list with the feature's label, `@citadel/tickets`' `createTicket` makes it, and
 * `argus ticket <dir> <A-n> <key>` puts the key on the ask, the ticket on the ledger with the
 * ask's open blockers, and spends the proposal.
 */
export const fileAsk = createServerFn({ method: "POST" })
  .validator((input: { dir: string; ask: string }) => ({
    ask: trimmed(input.ask),
    dir: trimmed(input.dir),
  }))
  .handler(async ({ data }): Promise<FileProposalResult> => {
    const a = await import("#/server/argus");
    const tickets = await import("@citadel/tickets");
    const ticket = await import("#/server/ticket");
    const draft = await a.argus<{
      title: string;
      body: string;
      label: string;
      assignee?: string;
    }>("file", [data.dir, data.ask]);
    if (!draft.ok) {
      return { error: a.argusNote(draft) ?? "argus refused", ok: false };
    }
    const config = ticket.providerConfigFor(ticket.TEAMS[0]);
    if (!config.configured) {
      return {
        error: config.reason ?? "the Alden board is not configured",
        ok: false,
        status: 503,
      };
    }
    let made: { key: string; url: string };
    try {
      made = await tickets.createTicket({
        assigneeId: draft.assignee,
        description: draft.body,
        project: draft.label,
        team: "AP",
        title: draft.title,
      });
    } catch (e) {
      if (e instanceof tickets.MissingCredentialError) {
        return { error: `${e.variable} is not set`, ok: false, status: 503 };
      }
      return { error: e instanceof Error ? e.message : String(e), ok: false };
    }
    const recorded = await a.argus("ticket", [
      data.dir,
      data.ask,
      made.key,
      "--title",
      draft.title,
    ]);
    if (!recorded.ok) {
      return {
        error: `${made.key} was filed, but the ledger did not take it: ${a.argusNote(recorded)}`,
        ok: false,
      };
    }
    return {
      key: made.key,
      ok: true,
      project: draft.label,
      url: made.url,
    };
  });

export type MoveWrite = { ok: true; id: string } | { error: string; ok: false };

/** Move: an ask to another feature. `argus move <dir> <A-n> <to>`; its thread follows. */
export const moveAsk = createServerFn({ method: "POST" })
  .validator((input: { dir: string; ask: string; to: string }) => ({
    ask: trimmed(input.ask),
    dir: trimmed(input.dir),
    to: trimmed(input.to),
  }))
  .handler(async ({ data }): Promise<MoveWrite> => {
    if (!data.to || data.to === data.dir) {
      return { error: "Pick another feature.", ok: false };
    }
    const a = await import("#/server/argus");
    const r = await a.argus<{ id: string }>("move", [
      data.dir,
      data.ask,
      data.to,
    ]);
    return r.ok
      ? { id: r.id, ok: true }
      : { error: a.argusNote(r) ?? "argus refused", ok: false };
  });

/** Every feature directory with a ledger, for a Move picker. */
export const listFeatureDirs = createServerFn({ method: "GET" }).handler(
  async (): Promise<string[]> => {
    const l = await import("#/server/ledger");
    return (await l.listLedgers()).ledgers.map((x) => x.dir);
  }
);

export type DismissWrite =
  | { ok: true; removed: number }
  | { error: string; ok: false };

/** Nothing: an unplaced message belongs to no feature. `argus dismiss <id>`; the thread is dropped from now on. */
export const dismissUnplaced = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => ({ id: trimmed(input.id) }))
  .handler(async ({ data }): Promise<DismissWrite> => {
    const a = await import("#/server/argus");
    const r = await a.argus<{ removed: number }>("dismiss", [data.id]);
    return r.ok
      ? { ok: true, removed: r.removed }
      : { error: a.argusNote(r) ?? "argus refused", ok: false };
  });
