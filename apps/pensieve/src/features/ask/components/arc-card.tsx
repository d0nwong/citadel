/**
 * The card behind `propose_arc` (LIA-147). The tool the session calls is read-only — a
 * bridged tool executes without an approval gate, so it can only ever answer a proposal.
 * This is where the proposal becomes a record: the slug, the title in a field Liam can
 * edit, every seed grouped by kind, and Open — which calls `openArc`, writing
 * `decisions/arc/<slug>.json` through the same atomic writer every verdict uses.
 *
 * The seeds are shown and not edited, because they are the proposal's whole substance: the
 * session may only seed keys it actually retrieved, and a key edited into the card here
 * would be exactly the guess the tool refuses. A wrong seed is a refusal to report, not a
 * field to correct.
 *
 * A tool part is stored with the conversation and replayed on every reload, so the card
 * never trusts its own output for whether the arc has been opened: it asks `getOpenedArc`,
 * which reads the thread's `arc:<toolCallId>` record, and shows the opened state the moment
 * one is there. That is what stops a second Open being offered for an arc already opened
 * (AC2).
 */

import type { ToolProps } from "@tanstack/ai-react/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { GitBranchPlus, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Tag, TicketLink } from "#/components/bits";
import { getOpenedArc, openArc } from "#/lib/api";
import type { ArcSeeds } from "#/lib/arcs";
import { allSeeds, SEED_KINDS, SEED_LABEL, toSeeds } from "#/lib/arcs";
import { toolResultText } from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { Block, Refusal, str } from "./card";

/** What `propose_arc` answers, as the card reads it back off the wire. */
interface Proposal {
  seeds: ArcSeeds;
  slug: string;
  title: string;
  /** False when no open-ticket list could be read — the card says the seeds are unverified. */
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
  const slug = str(p.slug);
  const seeds = toSeeds(p.seeds);
  if (!slug) {
    return { error: "the proposal named no arc", ok: false };
  }
  if (allSeeds(seeds).length === 0) {
    return { error: "the proposal carried no seeds", ok: false };
  }
  return {
    ok: true,
    proposal: {
      seeds,
      slug,
      title: str(p.title) ?? slug,
      verified: p.verified === true,
    },
  };
}

export function ArcCard({ part, result }: ToolProps<Opts>) {
  const output = result
    ? (result.error ?? toolResultText(result.content))
    : part.output;
  const answer = parseAnswer(output);

  if (!answer) {
    return <Block state="input-streaming" title="propose_arc · checking…" />;
  }
  if (!answer.ok) {
    return <Refusal error={answer.error} tool="propose_arc" />;
  }
  return <Proposed proposal={answer.proposal} toolCallId={part.id} />;
}

/** A LIA key, so a ticket seed is offered as the link the rest of the app makes of one. */
const TICKET_KEY_RE = /^LIA-\d+$/;

/** The four lists, in seed order; a kind with no keys is left out rather than shown empty. */
function Seeds({ seeds }: { seeds: ArcSeeds }) {
  return (
    <dl className="flex flex-col gap-1">
      {SEED_KINDS.filter((kind) => seeds[kind].length > 0).map((kind) => (
        <div className="flex flex-wrap items-baseline gap-x-2" key={kind}>
          <dt className="kicker w-16 shrink-0">{SEED_LABEL[kind]}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {seeds[kind].map((seed) =>
              kind === "tickets" && TICKET_KEY_RE.test(seed) ? (
                <TicketLink key={seed} ticket={seed} />
              ) : (
                <span className="mono text-muted-foreground text-sm" key={seed}>
                  {seed}
                </span>
              )
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The proposal itself. The title is editable, so what Open sends is what is on screen —
 * which is why `openArc` re-checks the draft rather than trusting the one `propose_arc`
 * approved.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = ["ask-arc", threadId, toolCallId];
  const q = useQuery({
    queryFn: () => getOpenedArc({ data: { threadId, toolCallId } }),
    queryKey: key,
  });
  const opened = q.data?.opened;

  const open = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await openArc({
        data: {
          seeds: proposal.seeds,
          slug: proposal.slug,
          threadId,
          title,
          toolCallId,
        },
      });
      if (r.ok) {
        await queryClient.invalidateQueries({ queryKey: key });
      } else {
        setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  };

  // The record is the truth, not this part: a reload replays the proposal, and once the
  // arc is opened the card says so rather than offering to open it again.
  if (opened) {
    return (
      <section className="my-2 max-w-[70ch] rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Tag tone="implemented">opened</Tag>
          <span className="min-w-0 truncate font-medium text-foreground">
            {opened.title}
          </span>
          <span className="mono ml-auto shrink-0 text-subtle text-xs">
            {opened.at.slice(0, 16).replace("T", " ")}
          </span>
        </div>
        <p className="mt-1 text-sm text-subtle">
          <span className="mono">decisions/arc/{opened.slug}.json</span> — the
          sweep writes <span className="mono">arcs/{opened.slug}.md</span> on
          its next tick.
        </p>
      </section>
    );
  }

  return (
    <form
      className="my-2 flex max-w-[70ch] flex-col gap-2 rounded-lg border border-primary/30 bg-muted/40 px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void open();
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Tag tone="documented">new arc</Tag>
        <span className="mono min-w-0 truncate text-muted-foreground">
          arc/{proposal.slug}
        </span>
        <span className="mono ml-auto shrink-0 text-subtle">proposed</span>
      </div>

      <label className="kicker" htmlFor={`arc-title-${toolCallId}`}>
        Title
      </label>
      <input
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-foreground placeholder:text-subtle focus:border-primary focus:outline-none"
        id={`arc-title-${toolCallId}`}
        onChange={(e) => setTitle(e.target.value)}
        value={title}
      />

      <span className="kicker">Seeds</span>
      <Seeds seeds={proposal.seeds} />
      <p className="text-sm text-subtle leading-snug">
        Every landing, point and ticket carrying one of these keys is filed
        against the arc — and nothing else is.
        {proposal.verified
          ? ""
          : " Linear's open issues could not be read, so the ticket keys are taken on trust."}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={busy || q.isPending}
          type="submit"
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <GitBranchPlus className="size-3.5" strokeWidth={1.75} />
          )}
          Open
        </button>
        <span className="text-sm text-subtle">
          nothing is written until you press Open
        </span>
      </div>

      {error && <p className="text-sm text-st-hold leading-snug">{error}</p>}
    </form>
  );
}
