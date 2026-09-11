/**
 * The card behind `propose_decision`. The tool the session calls is read-only — a bridged
 * tool executes without an approval gate, so it can only ever answer a proposal. This is
 * where the proposal becomes a change to the record: what is being decided, the reason in
 * a field the reader can edit, and Confirm — which calls the very server function the
 * feature page or the home page calls for the same click, so the verb argus runs is the
 * same either way.
 *
 * A tool part is stored with the conversation and replayed on every reload; the card
 * keeps its own "done" only for the session, and the pages read the record for the truth.
 */

import type { ToolProps } from "@tanstack/ai-react/ui";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import { CommitError, FIELD_CLASS, useCommit } from "#/features/work/controls";
import type { LedgerWrite, PlaceWrite } from "#/lib/api";
import { closeAsk, confirmRequirement, placeUnplaced } from "#/lib/api";
import { toolResultText } from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { Block, Refusal, str } from "./card";

const VERBS = ["close", "confirm", "contradict", "place"] as const;
type Verb = (typeof VERBS)[number];

/** What `propose_decision` answers, as the card reads it back off the wire. */
interface Proposal {
  feature: string;
  id: string;
  reason?: string;
  subject: string;
  verb: Verb;
}
type Answer =
  | { ok: true; proposal: Proposal }
  | { ok: false; error: string }
  | null;

const isVerb = (v: unknown): v is Verb =>
  typeof v === "string" && (VERBS as readonly string[]).includes(v);

/** The tool's output, whichever way it arrived: the part's own output, or the result's text. */
export function parseAnswer(output: unknown): Answer {
  let v: unknown = output;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { error: v as string, ok: false };
    }
  }
  if (!v || typeof v !== "object") {
    return null;
  }
  const o = v as Record<string, unknown>;
  if (o.ok === false) {
    return { error: str(o.error) ?? "refused", ok: false };
  }
  const p = o.proposal as Record<string, unknown> | undefined;
  if (o.ok !== true || !p || !isVerb(p.verb)) {
    return null;
  }
  return {
    ok: true,
    proposal: {
      feature: str(p.feature) ?? "",
      id: str(p.id) ?? "",
      reason: str(p.reason),
      subject: str(p.subject) ?? "",
      verb: p.verb,
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

const LABEL: Record<Verb, string> = {
  close: "Close it",
  confirm: "Confirm",
  contradict: "Contradict",
  place: "Place",
};

const DONE: Record<Verb, string> = {
  close: "closed",
  confirm: "confirmed",
  contradict: "contradicted",
  place: "placed",
};

function write(p: Proposal, reason: string): Promise<LedgerWrite | PlaceWrite> {
  switch (p.verb) {
    case "close":
      return closeAsk({ data: { ask: p.id, dir: p.feature, reason } });
    case "confirm":
    case "contradict":
      return confirmRequirement({
        data: {
          contradict: p.verb === "contradict",
          dir: p.feature,
          reason,
          requirement: p.id,
        },
      });
    default:
      return placeUnplaced({ data: { dir: p.feature, id: p.id } });
  }
}

function Proposed({ proposal }: { proposal: Proposal }) {
  const [reason, setReason] = useState(proposal.reason ?? "");
  const [done, setDone] = useState(false);
  const { busy, commit, error } = useCommit<LedgerWrite | PlaceWrite>();
  const needsReason = proposal.verb !== "place";

  if (done) {
    return (
      <section className="my-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Tag tone="documented">{DONE[proposal.verb]}</Tag>
          <span className="mono text-xs">{proposal.id}</span>
          <span className="min-w-0 truncate text-foreground">
            {proposal.subject}
          </span>
          <CircleCheck className="ml-auto size-4 text-st-documented" />
        </div>
      </section>
    );
  }

  return (
    <form
      className="my-2 flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        commit(
          () => write(proposal, reason),
          () => setDone(true)
        );
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Tag tone="decided">{proposal.verb}</Tag>
        <span className="mono text-xs">{proposal.feature}</span>
        <span className="mono text-xs">{proposal.id}</span>
      </div>
      <p className="text-foreground text-sm leading-snug">{proposal.subject}</p>
      {needsReason && (
        <>
          <label
            className="kicker"
            htmlFor={`card-reason-${proposal.feature}-${proposal.id}`}
          >
            Why
          </label>
          <textarea
            className={FIELD_CLASS}
            id={`card-reason-${proposal.feature}-${proposal.id}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="what the record should keep about this"
            rows={2}
            value={reason}
          />
        </>
      )}
      <div className="flex items-center gap-2">
        <Button
          disabled={busy || (needsReason && !reason.trim())}
          size="sm"
          type="submit"
        >
          {busy && <LoaderCircle className="animate-spin" />}
          {LABEL[proposal.verb]}
        </Button>
      </div>
      <CommitError
        v={error?.ok === false ? { error: error.error, ok: false } : null}
      />
    </form>
  );
}
