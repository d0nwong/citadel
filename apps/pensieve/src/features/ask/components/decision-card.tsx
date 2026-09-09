/**
 * The card behind `propose_decision` (LIA-111). The tool the session calls is read-only —
 * a bridged tool executes without an approval gate, so it can only ever answer a proposal.
 * This is where the proposal becomes a decision: the verdict, the reason in a field Liam
 * can edit, the repo for a Send, and Confirm — which calls `decidePoint` / `sendPoint`
 * through the Points page's own `useVerdictCommit`, so the file written here is the file
 * that page would write.
 *
 * A tool part is stored with the conversation and replayed on every reload, so the card
 * never trusts its own output for whether the verdict has been given: it asks `getPoint`
 * and shows `DecidedLine` the moment a decision file exists. That is what stops a second
 * Confirm being offered for a point that already has one (AC5).
 */

import type { ToolProps } from "@tanstack/ai-react/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { TicketLink } from "#/components/bits";
import {
  DecidedLine,
  RepoField,
  useVerdictCommit,
  VerdictError,
} from "#/features/points/verdict";
import { decidePoint, getPoint, sendPoint } from "#/lib/api";
import { pickRepo, REPO_REQUIRED } from "#/lib/points";
import { cn } from "#/lib/utils";
import { toolResultText } from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { Block, Refusal, str } from "./card";

/** What `propose_decision` answers, as the card reads it back off the wire. */
interface Proposal {
  action: "ignored" | "sent";
  point: string;
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
  const point = str(p.point);
  const action = p.action === "sent" ? "sent" : "ignored";
  if (!point) {
    return { error: "the proposal named no point", ok: false };
  }
  return {
    ok: true,
    proposal: {
      action,
      point,
      reason: str(p.reason),
      repo: str(p.repo),
      subject: str(p.subject) ?? point,
      ticket: str(p.ticket),
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

/**
 * The proposal itself. Keyed reads: `getPoint` is the same server function the conversation's
 * header card loads from, so once a decision exists both show it.
 */
function Proposed({ proposal }: { proposal: Proposal }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(proposal.reason ?? "");
  const [chosen, setChosen] = useState<string | null>(null);
  const { busy, commit, error, setError } = useVerdictCommit();

  const key = ["point", proposal.point];
  const q = useQuery({
    queryFn: () => getPoint({ data: proposal.point }),
    queryKey: key,
  });

  const send = proposal.action === "sent";
  const point = q.data?.point;
  // Unlike the Points page, the repos arrive with the same query as the point rather than
  // with the route's loader data, so the field cannot be seeded in a `useState` initialiser
  // — until it is touched (`chosen` is null) it shows what the proposal's repo picks out of
  // whatever list has landed, and the moment the list lands the choice appears with it.
  const repos = q.data?.repos ?? [];
  const repo =
    chosen ??
    (repos.length > 0 ? pickRepo(repos, proposal.repo) : (proposal.repo ?? ""));

  const confirm = () => {
    if (send && !repo.trim()) {
      return setError({ error: REPO_REQUIRED, ok: false });
    }
    if (!(send || reason.trim())) {
      return setError({
        error: "say why — the reason is what the sweep records",
        ok: false,
      });
    }
    return commit(
      () =>
        send
          ? sendPoint({ data: { point: proposal.point, repo } })
          : decidePoint({ data: { point: proposal.point, reason } }),
      () => queryClient.invalidateQueries({ queryKey: key })
    );
  };

  // The decision file is the truth, not this part: a reload replays the proposal, and once
  // the point is decided the card is the verdict rather than an offer to give one.
  if (point?.decision) {
    return (
      <section className="my-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <DecidedLine
          foundryUrl={q.data?.foundry.url ?? ""}
          head={
            <>
              <span className="min-w-0 truncate font-medium text-foreground">
                {point.subject}
              </span>
              {point.ticket && <TicketLink ticket={point.ticket} />}
            </>
          }
          point={point}
        />
      </section>
    );
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
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-xs",
            send
              ? "border-st-implemented/40 text-st-implemented"
              : "border-st-superseded/40 text-st-superseded"
          )}
        >
          {proposal.action}
        </span>
        <span className="min-w-0 truncate font-medium text-foreground">
          {proposal.subject}
        </span>
        {proposal.ticket && <TicketLink ticket={proposal.ticket} />}
        <span className="mono ml-auto shrink-0 text-subtle">proposed</span>
      </div>

      {send ? (
        <>
          <RepoField
            className="bg-background"
            id={`card-repo-${proposal.point}`}
            onChange={setChosen}
            repos={repos}
            value={repo}
          />
          <p className="text-sm text-subtle leading-snug">
            Foundry composes the brief from{" "}
            <span className="mono">{proposal.ticket}</span> and claims it in
            Linear. The idempotency key is the point id, so this cannot queue
            twice.
          </p>
        </>
      ) : (
        <>
          <label className="kicker" htmlFor={`card-reason-${proposal.point}`}>
            Why ignore it
          </label>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-foreground text-sm placeholder:text-subtle focus:border-primary focus:outline-none"
            id={`card-reason-${proposal.point}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="not worth a ticket / already handled in … / decided otherwise on …"
            rows={2}
            value={reason}
          />
        </>
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
      <VerdictError v={error} />
    </form>
  );
}
