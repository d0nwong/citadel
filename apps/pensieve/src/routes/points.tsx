/**
 * /points — the sweep's Needs-you queue as a list you can act on (LIA-94). Every point
 * without a decision is listed in the report's own order; each can be ignored with a
 * reason, or — when it names a ticket — sent to Foundry. Both write one file under
 * `decisions/` and the point moves to the collapsed Decided list below, where a sent
 * point shows its Foundry job live until it settles.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { Empty, PageTitle, TicketLink } from "#/components/bits";
import { newThreadId } from "#/features/ask";
import {
  ActionButton,
  DecidedLine,
  VerdictControls,
} from "#/features/points/verdict";
import { listPoints } from "#/lib/api";
import { cn, daysSince } from "#/lib/utils";
import type { Point, PointGroup } from "#/server/workspace";

export const Route = createFileRoute("/points")({
  loader: () => listPoints(),
  component: PointsPage,
});

const GROUPS: Array<{ key: PointGroup; label: string; hint: string }> = [
  { key: "decide", label: "Decide", hint: "a call only you can make" },
  { key: "verify", label: "Verify", hint: "the sweep thinks, you confirm" },
  { key: "confirm", label: "Confirm", hint: "with someone" },
  { key: "hold", label: "On hold", hint: "waiting on something outside" },
  { key: "housekeeping", label: "Housekeeping", hint: "the blackboard itself" },
];

/**
 * The question an Ask conversation opens with — the point named the way the file names
 * it. `/ask` in front loads argus's `ask` skill explicitly (a `/skill` prefix expands under
 * `claude -p` — verified in LIA-104), so the session's first tool call is `accio point`.
 */
const pointQuestion = (point: Point) =>
  `/ask About the sweep point "${point.subject}" (${point.id}) in reports/points.json: what is it asking me to decide, what is the evidence in the checkout, and what would you recommend?`;

/** Opens a new conversation about the point, with a breadcrumb back here (see routes/ask/$id). */
function useAskAbout(point: Point) {
  const navigate = useNavigate();
  return () =>
    navigate({
      to: "/ask/$id",
      params: { id: newThreadId() },
      search: { q: pointQuestion(point), from: "points", point: point.id },
    });
}

function age(firstSeen: string) {
  const n = daysSince(firstSeen);
  if (n === null) {
    return "";
  }
  return n <= 0 ? "new" : `${n}d`;
}

function PointsPage() {
  const { file, foundry } = Route.useLoaderData();
  if (!file) {
    return (
      <>
        <PageTitle kicker="Needs you" title="Points" />
        <Empty title="No points on file">
          The sweep writes <span className="mono">reports/points.json</span>{" "}
          each tick, one record per Needs-you item. Run{" "}
          <span className="mono">/sweep</span> in argus and this page fills in.
        </Empty>
      </>
    );
  }
  const open = file.points.filter((p) => !p.decision);
  const decided = file.points
    .filter((p) => p.decision)
    .sort((a, b) => ((a.decision?.at ?? "") < (b.decision?.at ?? "") ? 1 : -1));
  const groups = GROUPS.map((g) => ({
    ...g,
    points: open.filter((p) => p.group === g.key),
  })).filter((g) => g.points.length > 0);

  return (
    <>
      <PageTitle
        aside={
          <span className="mono text-ink-faint" title={`tick ${file.tick}`}>
            {file.date}
            {decided.length > 0 && ` · ${decided.length} decided`}
          </span>
        }
        kicker="Needs you"
        title={
          open.length === 0
            ? "Nothing to decide"
            : `${open.length} point${open.length === 1 ? "" : "s"}`
        }
      />

      {!foundry.configured && (
        <p
          className="rise mb-6 border-st-hold/50 border-l-2 pl-3 text-ink-dim text-sm leading-snug"
          style={{ animationDelay: "40ms" }}
        >
          <span className="font-semibold">Send is off.</span> {foundry.reason}.
          Ignore still works.
        </p>
      )}

      {open.length === 0 && (
        <Empty title="The queue is clear">
          Every point in the last tick has a decision. The next sweep will pick
          the files up from <span className="mono">decisions/</span>.
        </Empty>
      )}

      {groups.map((g, gi) => (
        <section
          className="rise mb-10"
          key={g.key}
          style={{ animationDelay: `${60 + gi * 40}ms` }}
        >
          <div className="mb-1 flex items-baseline justify-between border-rule border-b pb-1.5">
            <h2 className="display text-[22px] text-ink">
              {g.label}
              <span className="mono ml-2 text-ink-faint">
                {g.points.length}
              </span>
            </h2>
            <span className="hidden text-ink-faint text-sm italic sm:block">
              {g.hint}
            </span>
          </div>
          <ul className="divide-y divide-rule-soft">
            {g.points.map((p) => (
              <PointRow
                foundryOk={foundry.configured}
                foundryReason={foundry.reason}
                key={p.id}
                point={p}
              />
            ))}
          </ul>
        </section>
      ))}

      {decided.length > 0 && (
        <details
          className="rise group mt-4 border-rule border-t pt-4"
          style={{ animationDelay: "200ms" }}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-dim hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 transition-transform group-open:rotate-90"
              strokeWidth={1.75}
            />
            <span className="display text-[19px]">Decided</span>
            <span className="mono text-ink-faint">{decided.length}</span>
            <span className="ml-auto hidden text-ink-faint text-sm italic sm:block">
              leaves the report on the next tick
            </span>
          </summary>
          <ul className="mt-3 divide-y divide-rule-soft">
            {decided.map((p) => (
              <DecidedRow foundryUrl={foundry.url} key={p.id} point={p} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// ── an open point ──────────────────────────────────────────────────────────────

function PointRow({
  point,
  foundryOk,
  foundryReason,
}: {
  point: Point;
  foundryOk: boolean;
  foundryReason?: string;
}) {
  const askAbout = useAskAbout(point);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="display text-[19px] text-ink leading-tight">
          {point.subject}
        </span>
        {point.ticket && <TicketLink ticket={point.ticket} />}
        <span className="mono text-ink-faint">{age(point.firstSeen)}</span>
      </div>
      <p className="mt-1 text-ink-dim text-sm leading-snug">{point.ask}</p>
      {point.detail && (
        <p className="mt-1 max-w-[72ch] text-ink-faint text-sm leading-snug">
          {point.detail}
        </p>
      )}
      <VerdictControls
        foundryOk={foundryOk}
        foundryReason={foundryReason}
        lead={
          <ActionButton
            active={false}
            icon={MessageCircleQuestion}
            onClick={askAbout}
          >
            Ask
          </ActionButton>
        }
        point={point}
      />
    </li>
  );
}

// ── a decided point ────────────────────────────────────────────────────────────

function DecidedRow({
  point,
  foundryUrl,
}: {
  point: Point;
  foundryUrl: string;
}) {
  const askAbout = useAskAbout(point);
  if (!point.decision) {
    return null;
  }
  return (
    <li className="py-3">
      <DecidedLine
        foundryUrl={foundryUrl}
        head={
          <>
            <span
              className={cn(
                "display text-[17px] leading-tight",
                point.decision.action === "ignored"
                  ? "text-ink-dim"
                  : "text-ink"
              )}
            >
              {point.subject}
            </span>
            {point.ticket && <TicketLink ticket={point.ticket} />}
            <button
              className="inline-flex items-center gap-1 text-sm text-thread hover:underline"
              onClick={askAbout}
              type="button"
            >
              <MessageCircleQuestion className="size-3.5" strokeWidth={1.75} />
              Ask
            </button>
          </>
        }
        point={point}
      />
    </li>
  );
}
