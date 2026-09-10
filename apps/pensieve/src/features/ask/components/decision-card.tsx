/**
 * The card behind `propose_decision` (LIA-111, retargeted by LIA-162). The tool the session
 * calls is read-only — a bridged tool executes without an approval gate, so it can only
 * ever answer a proposal. This is where the proposal becomes a decision: what is being
 * decided, the reason (or the repo) in a field the reader can edit, and Confirm — which
 * calls the very server function the page for that thing calls, so the file written here is
 * the file that page would write.
 *
 * Two shapes, because there are two things a conversation proposes:
 *
 *   - a **correction** — attach or dismiss — which goes through
 *     `decideUnsorted`, the Unsorted page's writer;
 *   - a **send**, which goes through `sendTicket`, the feature page's.
 *
 * A tool part is stored with the conversation and replayed on every reload, so the card
 * never trusts its own output for whether the click has been made: it asks the server, and
 * shows what is on disk the moment a decision file exists. That is what stops a second
 * Confirm being offered for something already decided.
 */

import type { ToolProps } from "@tanstack/ai-react/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Tag, TicketLink } from "#/components/bits";
import {
  CommitError,
  FIELD_CLASS,
  JobLine,
  RepoField,
  useCommit,
  when,
} from "#/features/work/controls";
import type { SendResult, UnsortedVerdict } from "#/lib/api";
import { decideUnsorted, getDecided, sendTicket } from "#/lib/api";
import type { MarauderDecision } from "#/lib/marauder";
import { DISMISS_NEEDS_REASON } from "#/lib/marauder";
import { pickRepo, REPO_REQUIRED } from "#/lib/send";
import type { SendDecision } from "#/server/decisions";
import type { FoundryRepo } from "#/server/foundry";
import { toolResultText } from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { Block, Refusal, str } from "./card";

const ACTIONS = ["attach", "dismiss", "send"] as const;
type Action = (typeof ACTIONS)[number];

/** What `propose_decision` answers, as the card reads it back off the wire. */
interface Proposal {
  action: Action;
  feature?: string;
  id?: string;
  reason?: string;
  repo?: string;
  subject: string;
  ticket?: string;
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
    return { error: str(o.error) ?? "the proposal was refused", ok: false };
  }
  const p = (o.proposal ?? {}) as Record<string, unknown>;
  const action = ACTIONS.find((a) => a === p.action);
  if (!action) {
    return { error: "the proposal named no action", ok: false };
  }
  const id = str(p.id);
  const ticket = str(p.ticket);
  if (action === "send" ? !ticket : !id) {
    return {
      error:
        action === "send"
          ? "the proposal named no ticket"
          : "the proposal named no entry",
      ok: false,
    };
  }
  return {
    ok: true,
    proposal: {
      action,
      feature: str(p.feature),
      id,
      reason: str(p.reason),
      repo: str(p.repo),
      subject: str(p.subject) ?? (ticket || id || ""),
      ticket,
    },
  };
}

export function DecisionCard({ part, result }: ToolProps<Opts>) {
  const output = result
    ? (result.error ?? toolResultText(result.content))
    : part.output;
  const answer = parseAnswer(output);

  if (!answer) {
    return (
      <Block state="input-streaming" title="propose_decision · checking…" />
    );
  }
  if (!answer.ok) {
    return <Refusal error={answer.error} tool="propose_decision" />;
  }
  return <Proposed proposal={answer.proposal} />;
}

/** What the tag on the card says, in the reader's words rather than the file's. */
const WORD: Record<Action, string> = {
  attach: "attach",
  dismiss: "dismiss",
  send: "send",
};

/**
 * The write itself — the very server function the page for this thing calls, so a decision
 * confirmed on a card and one made on a page take the same path and write the same file.
 */
function writeCall(
  proposal: Proposal,
  repo: string,
  reason: string
): Promise<SendResult | UnsortedVerdict> {
  if (proposal.action === "send") {
    return sendTicket({ data: { repo, ticket: proposal.ticket ?? "" } });
  }
  return decideUnsorted({
    data: {
      action: proposal.action,
      id: proposal.id ?? "",
      ...(proposal.feature ? { feature: proposal.feature } : {}),
      ...(reason.trim() ? { reason } : {}),
    },
  });
}

/** What a send collects: the repo, and what Foundry will do with the ticket. */
function SendFields({
  onChange,
  proposal,
  repo,
  repos,
}: {
  onChange: (v: string) => void;
  proposal: Proposal;
  repo: string;
  repos: FoundryRepo[];
}) {
  return (
    <>
      <RepoField
        className="bg-background"
        id={`card-repo-${proposal.ticket}`}
        onChange={onChange}
        repos={repos}
        value={repo}
      />
      <p className="text-sm text-subtle leading-snug">
        Foundry composes the brief from{" "}
        <span className="mono">{proposal.ticket}</span> and claims it in Linear.
        The idempotency key is the ticket, so this cannot queue twice.
      </p>
    </>
  );
}

/** What a correction collects: the reason, under a line saying what the verb will do. */
function CorrectionFields({
  onChange,
  proposal,
  reason,
}: {
  onChange: (v: string) => void;
  proposal: Proposal;
  reason: string;
}) {
  return (
    <>
      {proposal.action === "attach" && proposal.feature && (
        <p className="text-sm text-subtle leading-snug">
          It moves onto <span className="mono">{proposal.feature}</span>, and
          its thread, tickets and words join that feature's keys.
        </p>
      )}
      <label className="kicker" htmlFor={`card-reason-${proposal.id}`}>
        {proposal.action === "dismiss" ? "Why it goes nowhere" : "Why"}
      </label>
      <textarea
        className={FIELD_CLASS}
        id={`card-reason-${proposal.id}`}
        onChange={(e) => onChange(e.target.value)}
        placeholder="what the record should keep about this"
        rows={2}
        value={reason}
      />
    </>
  );
}

/**
 * What is on disk, once something is. The decision file is the truth, not this part: a
 * reload replays the proposal, and once it is decided the card is the verdict rather than
 * an offer to give one.
 */
function Decided({
  decided,
  proposal,
  sent,
}: {
  decided?: MarauderDecision | null;
  proposal: Proposal;
  sent?: SendDecision | null;
}) {
  return (
    <section className="my-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Tag tone={sent ? "implemented" : "decided"}>
          {sent ? "sent" : (decided?.action ?? "decided")}
        </Tag>
        <span className="min-w-0 truncate font-medium text-foreground">
          {proposal.subject}
        </span>
        {proposal.ticket && <TicketLink ticket={proposal.ticket} />}
        <span className="ml-auto text-subtle text-xs">
          {when((sent ?? decided)?.at ?? "")}
        </span>
      </div>
      {decided?.reason && (
        <p className="mt-1 text-muted-foreground text-sm leading-normal">
          {decided.reason}
        </p>
      )}
      {sent && <JobLine id={sent.job.id} url={sent.job.url} />}
    </section>
  );
}

/**
 * The proposal itself. `getDecided` is the one read behind it: it answers whatever is
 * already on disk for this entry or this ticket, so a reload that replays the tool part
 * shows the decision rather than offering it again.
 */
function Proposed({ proposal }: { proposal: Proposal }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(proposal.reason ?? "");
  const [chosen, setChosen] = useState<string | null>(null);
  const { busy, commit, error, setError } = useCommit<
    SendResult | UnsortedVerdict
  >();

  const send = proposal.action === "send";
  const key = ["decided", send ? proposal.ticket : proposal.id];
  const q = useQuery({
    queryFn: () =>
      getDecided({
        data: send
          ? { ticket: proposal.ticket ?? "" }
          : { id: proposal.id ?? "" },
      }),
    queryKey: key,
  });

  // Unlike the feature page, the repos arrive with the same query as the decision rather
  // than with the route's loader data, so the field cannot be seeded in a `useState`
  // initialiser — until it is touched (`chosen` is null) it shows what the proposal's repo
  // picks out of whatever list has landed.
  const repos = q.data?.repos ?? [];
  const repo =
    chosen ??
    (repos.length > 0 ? pickRepo(repos, proposal.repo) : (proposal.repo ?? ""));

  const confirm = () => {
    if (send && !repo.trim()) {
      return setError({ error: REPO_REQUIRED, ok: false });
    }
    if (proposal.action === "dismiss" && !reason.trim()) {
      return setError({ error: DISMISS_NEEDS_REASON, ok: false });
    }
    return commit(
      () => writeCall(proposal, repo, reason),
      () => queryClient.invalidateQueries({ queryKey: key })
    );
  };

  const sent = q.data?.sent;
  const decided = q.data?.decided;
  if (sent || decided) {
    return <Decided decided={decided} proposal={proposal} sent={sent} />;
  }

  return (
    <form
      className="my-2 flex max-w-[60ch] flex-col gap-2 rounded-lg border border-primary/30 bg-muted/40 px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Tag tone={send ? "implemented" : "decided"}>
          {WORD[proposal.action]}
        </Tag>
        <span className="min-w-0 truncate font-medium text-foreground">
          {proposal.subject}
        </span>
        {proposal.ticket && <TicketLink ticket={proposal.ticket} />}
        <span className="mono ml-auto shrink-0 text-subtle">proposed</span>
      </div>

      {send ? (
        <SendFields
          onChange={setChosen}
          proposal={proposal}
          repo={repo}
          repos={repos}
        />
      ) : (
        <CorrectionFields
          onChange={setReason}
          proposal={proposal}
          reason={reason}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={busy || q.isPending}
          type="submit"
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <CircleCheck className="size-3.5" strokeWidth={1.75} />
          )}
          Confirm
        </button>
        <span className="text-sm text-subtle">
          nothing is written until you confirm
        </span>
      </div>
      <CommitError v={error} />
    </form>
  );
}
