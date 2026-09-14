/**
 * The card behind `propose_ticket` (LIA-113). The tool the session calls is read-only — a
 * bridged tool executes without an approval gate, so it can only ever answer a proposal.
 * This is where the proposal becomes an issue: the drafted title and body in fields Liam
 * can edit, the project it lands in, and File — which calls `fileTicket`, the one place in
 * the app that writes to Linear.
 *
 * A tool part is stored with the conversation and replayed on every reload, so the card
 * never trusts its own output for whether the ticket exists: it asks `getFiledTicket`,
 * which reads the thread's `ticket:<toolCallId>` record, and shows the key the moment one
 * is there. That is what stops a second File being offered for a draft already filed (AC3),
 * and the same read carries whether the credential is present at all (AC5).
 */

import type { ToolProps } from "@tanstack/ai-react/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowUpRight, FilePlus2, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { FileTicketResult } from "#/lib/api";
import { fileTicket, getFiledTicket } from "#/lib/api";
import { cn } from "#/lib/utils";
import { toolResultText } from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { Block, Refusal, str } from "./card";

/** The format's limit, restated here so the card can count against it as Liam types. */
const TITLE_MAX = 80;

/** What `propose_ticket` answers, as the card reads it back off the wire. */
interface Proposal {
  description: string;
  /** The feature dir confirmed in the chat, whose ledger File records the ticket on. */
  feature?: string;
  /** True when the team has no project by this name yet: File creates it before the issue. */
  isNew: boolean;
  project: string;
  projectId?: string;
  team: string;
  title: string;
  /** False when no project list could be read — the card says the project is unverified. */
  verified: boolean;
}
type Answer =
  | { ok: true; proposal: Proposal }
  | { ok: false; error: string }
  | null;

/**
 * The tool's output as an answer. It crosses the harness as a JSON string, so anything that
 * does not parse into the shape above is reported as an error rather than guessed at.
 */
export function parseAnswer(output: unknown): Answer {
  if (output === undefined || output === "") {
    return null;
  }
  let v: unknown = output;
  if (typeof output === "string") {
    try {
      v = JSON.parse(output);
    } catch {
      // Not JSON: the harness passed something through verbatim — a denial, say.
      return { error: output, ok: false };
    }
  }
  if (!v || typeof v !== "object") {
    return { error: String(output), ok: false };
  }
  const o = v as Record<string, unknown>;
  if (o.ok !== true) {
    return { error: str(o.error) ?? "the draft was refused", ok: false };
  }
  const p = (o.proposal ?? {}) as Record<string, unknown>;
  const title = str(p.title);
  const description = str(p.description);
  if (!(title && description)) {
    return { error: "the proposal carried no draft", ok: false };
  }
  return {
    ok: true,
    proposal: {
      description,
      feature: str(p.feature),
      isNew: p.isNew === true,
      project: str(p.project) ?? "",
      projectId: str(p.projectId),
      team: str(p.team) ?? "Alden",
      title,
      verified: p.verified === true,
    },
  };
}

export function TicketCard({ part, result }: ToolProps<Opts>) {
  const output = result
    ? (result.error ?? toolResultText(result.content))
    : part.output;
  const answer = parseAnswer(output);

  if (!answer) {
    return <Block state="input-streaming" title="propose_ticket · checking…" />;
  }
  if (!answer.ok) {
    return <Refusal error={answer.error} tool="propose_ticket" />;
  }
  return <Proposed proposal={answer.proposal} toolCallId={part.id} />;
}

/** The filed issue, once there is one — the card's terminal state. */
function Filed({ identifier, url }: { identifier: string; url: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-primary hover:underline"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <span className="mono">{identifier}</span>
      <ArrowUpRight className="size-3" />
    </a>
  );
}

/**
 * The proposal itself. The title and body are editable, so what File sends is what is on
 * screen — which is why `fileTicket` re-checks the draft rather than trusting the one
 * `propose_ticket` approved.
 */
function Proposed({
  proposal,
  toolCallId,
}: {
  proposal: Proposal;
  toolCallId: string;
}) {
  const { id: threadId } = useParams({ from: "/ask/$id" });
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Extract<
    FileTicketResult,
    { ok: false }
  > | null>(null);

  const key = ["ask-ticket", threadId, toolCallId];
  const q = useQuery({
    queryFn: () => getFiledTicket({ data: { threadId, toolCallId } }),
    queryKey: key,
  });

  const filed = q.data?.issue;
  const config = q.data?.config;
  const over = title.length > TITLE_MAX;

  const file = async () => {
    if (busy) {
      return;
    }
    if (over) {
      return setError({
        error: `the title is ${title.length} characters — the format's limit is ${TITLE_MAX}`,
        ok: false,
      });
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fileTicket({
        data: {
          description,
          feature: proposal.feature,
          project: proposal.project,
          team: proposal.team,
          threadId,
          title,
          toolCallId,
        },
      });
      if (r.ok) {
        await queryClient.invalidateQueries({ queryKey: key });
      } else {
        setError(r);
      }
    } finally {
      setBusy(false);
    }
  };

  // The metadata record is the truth, not this part: a reload replays the proposal, and
  // once the issue exists the card is the key rather than an offer to file it again.
  if (filed) {
    return (
      <section className="my-2 max-w-[70ch] rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="inline-flex items-center rounded-md bg-st-implemented/10 px-1.5 py-0.5 font-medium text-st-implemented text-xs">
            filed
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {title}
          </span>
          <span className="ml-auto shrink-0">
            <Filed identifier={filed.identifier} url={filed.url} />
          </span>
        </div>
        <p className="mt-1 text-sm text-subtle">
          {proposal.team} · {proposal.project || "no project"} ·{" "}
          {proposal.feature ?? "no feature"}
        </p>
      </section>
    );
  }

  return (
    <form
      className="my-2 flex max-w-[70ch] flex-col gap-2 rounded-lg border border-primary/30 bg-muted/40 px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void file();
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary text-xs">
          new ticket
        </span>
        <span className="mono min-w-0 truncate text-muted-foreground">
          {proposal.team} · {proposal.project || "no project"} ·{" "}
          {proposal.feature ?? "no feature"}
        </span>
        <span className="mono ml-auto shrink-0 text-subtle">proposed</span>
      </div>

      <label className="kicker" htmlFor={`ticket-title-${toolCallId}`}>
        Title
      </label>
      <input
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-foreground placeholder:text-subtle focus:border-primary focus:outline-none"
        id={`ticket-title-${toolCallId}`}
        onChange={(e) => setTitle(e.target.value)}
        value={title}
      />
      <p
        className={cn(
          "mono text-right text-sm",
          over ? "text-st-hold" : "text-subtle"
        )}
      >
        {title.length}/{TITLE_MAX}
      </p>

      <label className="kicker" htmlFor={`ticket-body-${toolCallId}`}>
        Body
      </label>
      <textarea
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-foreground text-sm placeholder:text-subtle focus:border-primary focus:outline-none"
        id={`ticket-body-${toolCallId}`}
        onChange={(e) => setDescription(e.target.value)}
        rows={14}
        value={description}
      />

      {!proposal.verified && (
        <p className="text-sm text-subtle leading-snug">
          The project could not be checked against Linear, so{" "}
          <span className="mono">{proposal.project}</span> is taken on trust.
        </p>
      )}
      {proposal.isNew && (
        <p className="text-sm text-subtle leading-snug">
          Team {proposal.team} has no project called{" "}
          <span className="mono">{proposal.project}</span> yet — File creates
          it, then the issue in it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {config?.configured === false ? (
          <span
            className="inline-flex cursor-not-allowed items-center gap-1.5 text-sm text-subtle"
            title={config.reason}
          >
            <FilePlus2 className="size-3.5" strokeWidth={1.75} />
            File
            <span className="italic">
              — {config.reason?.split(" — ")[0] ?? "off"}
            </span>
          </span>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            disabled={busy || q.isPending}
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="size-3.5" strokeWidth={1.75} />
            )}
            File
          </button>
        )}
        <span className="text-sm text-subtle">
          nothing is filed until you press File
        </span>
      </div>

      {error && (
        <p className="text-sm text-st-hold leading-snug">
          {error.status ? (
            <span className="mono mr-1.5">{error.status}</span>
          ) : null}
          {error.error}
        </p>
      )}
    </form>
  );
}
