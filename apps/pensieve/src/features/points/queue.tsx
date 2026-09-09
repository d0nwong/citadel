/**
 * The Needs-you queue — every open point from `reports/points.json`, in three sections by
 * who moves it (`sections.ts`), each row with its verdict controls; the decided points
 * collapsed underneath, a sent one showing its Foundry job live until it settles. Lives on
 * the home page above the sweep log (LIA-94, LIA-115).
 */

import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { Empty, Inline, Tag, TicketLink } from "#/components/bits";
import { Button } from "#/components/ui/button";
import { newThreadId } from "#/features/ask";
import { cn, daysSince } from "#/lib/utils";
import type { FoundryRepo } from "#/server/foundry";
import type { Queue as QueueData } from "#/server/queue";
import type { Point } from "#/server/workspace";
import { SECTIONS, sectionOf, waitingTag } from "./sections";
import { DecidedLine, VerdictControls } from "./verdict";

/**
 * The question an Ask conversation opens with — the point named the way the file names
 * it. `/ask` in front loads argus's `ask` skill explicitly (a `/skill` prefix expands under
 * `claude -p` — verified in LIA-104), so the session's first tool call is `accio point`.
 */
const pointQuestion = (point: Point) =>
  `/ask About the sweep point "${point.subject}" (${point.id}) in reports/points.json: what is it asking me to decide, what is the evidence in the checkout, and what would you recommend?`;

/** Opens a new conversation about the point, with a breadcrumb back home (see routes/ask/$id). */
function useAskAbout(point: Point) {
  const navigate = useNavigate();
  return () =>
    navigate({
      params: { id: newThreadId() },
      search: { from: "home", point: point.id, q: pointQuestion(point) },
      to: "/ask/$id",
    });
}

function age(firstSeen: string) {
  const n = daysSince(firstSeen);
  if (n === null) {
    return "";
  }
  return n <= 0 ? "new" : `${n}d`;
}

export function Queue({ queue }: { queue: QueueData }) {
  const { file, foundry, repos } = queue;
  if (!file) {
    return (
      <Empty title="No points on file">
        The sweep writes <span className="mono">reports/points.json</span> each
        tick, one record per Needs-you item. Run{" "}
        <span className="mono">/sweep</span> in argus and this fills in.
      </Empty>
    );
  }
  const open = file.points.filter((p) => !p.decision);
  const decided = file.points
    .filter((p) => p.decision)
    .sort((a, b) => ((a.decision?.at ?? "") < (b.decision?.at ?? "") ? 1 : -1));
  const sections = SECTIONS.map((s) => ({
    ...s,
    points: open.filter((p) => sectionOf(p) === s.key),
  })).filter((s) => s.points.length > 0);

  return (
    <div className="flex flex-col gap-8">
      {!foundry.configured && (
        <p className="rounded-md border border-st-hold/30 bg-st-hold/5 px-3 py-2 text-muted-foreground text-sm leading-snug">
          <span className="font-medium text-foreground">Send is off.</span>{" "}
          {foundry.reason}. Approve and Dismiss still work.
        </p>
      )}

      {open.length === 0 && (
        <Empty title="Nothing needs you">
          Every point in the last tick has a decision. The next sweep picks the
          files up from <span className="mono">decisions/</span>.
        </Empty>
      )}

      {sections.map((s) =>
        s.key === "housekeeping" ? (
          <Disclosure
            count={s.points.length}
            hint={s.hint}
            key={s.key}
            label={s.label}
          >
            <Rows foundry={foundry} points={s.points} repos={repos} />
          </Disclosure>
        ) : (
          <section key={s.key}>
            <div className="mb-1 flex items-baseline gap-2 border-border border-b pb-1.5">
              <h2 className="font-semibold text-base">{s.label}</h2>
              <span className="text-subtle text-xs">{s.points.length}</span>
              <span className="ml-auto hidden text-subtle text-xs sm:block">
                {s.hint}
              </span>
            </div>
            <Rows foundry={foundry} points={s.points} repos={repos} />
          </section>
        )
      )}

      {decided.length > 0 && (
        <Disclosure
          count={decided.length}
          hint="leaves the report on the next tick"
          label="Decided"
        >
          <ul className="divide-y divide-border">
            {decided.map((p) => (
              <DecidedRow foundryUrl={foundry.url} key={p.id} point={p} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function Disclosure({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-border border-t pt-3">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 self-center transition-transform group-open:rotate-90"
          strokeWidth={1.75}
        />
        <span className="font-semibold text-base">{label}</span>
        <span className="text-subtle text-xs">{count}</span>
        <span className="ml-auto hidden text-subtle text-xs sm:block">
          {hint}
        </span>
      </summary>
      <div className="mt-2 pl-6">{children}</div>
    </details>
  );
}

function Rows({
  points,
  foundry,
  repos,
}: {
  points: Point[];
  foundry: QueueData["foundry"];
  repos: FoundryRepo[];
}) {
  return (
    <ul className="divide-y divide-border">
      {points.map((p) => (
        <PointRow
          foundryOk={foundry.configured}
          foundryReason={foundry.reason}
          key={p.id}
          point={p}
          repos={repos}
        />
      ))}
    </ul>
  );
}

// ── an open point ──────────────────────────────────────────────────────────────

function PointRow({
  point,
  foundryOk,
  foundryReason,
  repos,
}: {
  point: Point;
  foundryOk: boolean;
  foundryReason?: string;
  repos: FoundryRepo[];
}) {
  const askAbout = useAskAbout(point);
  const waiting = waitingTag(point);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-medium text-foreground leading-snug">
          <Inline text={point.subject} />
        </span>
        {point.ticket && <TicketLink ticket={point.ticket} />}
        {waiting && <Tag>{waiting}</Tag>}
        <span className="ml-auto text-subtle text-xs">
          {age(point.firstSeen)}
        </span>
      </div>
      {/* A waiting row's ask is its tag; the others' ask is the question itself. */}
      {!waiting && (
        <p className="mt-1 text-muted-foreground text-sm leading-normal">
          <Inline text={point.ask} />
        </p>
      )}
      {point.detail && (
        <p
          className={cn("mt-1 max-w-[72ch] text-sm text-subtle leading-normal")}
        >
          <Inline text={point.detail} />
        </p>
      )}
      <VerdictControls
        extra={
          <Button onClick={askAbout} size="sm" variant="ghost">
            <MessageCircleQuestion strokeWidth={1.75} />
            Ask
          </Button>
        }
        foundryOk={foundryOk}
        foundryReason={foundryReason}
        point={point}
        repos={repos}
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
                "font-medium leading-snug",
                point.decision.action === "ignored"
                  ? "text-muted-foreground"
                  : "text-foreground"
              )}
            >
              <Inline text={point.subject} />
            </span>
            {point.ticket && <TicketLink ticket={point.ticket} />}
            <button
              className="inline-flex items-center gap-1 text-primary text-sm hover:underline"
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
