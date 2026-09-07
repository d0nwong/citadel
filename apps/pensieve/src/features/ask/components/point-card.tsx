/**
 * The Needs-you point a conversation was opened on, above the transcript (LIA-109). One
 * line by default — the page below it is the conversation, and that is what the screen is
 * for — with the point's ask and detail behind a disclosure and the same Ignore / Send
 * controls the Points page uses (`features/points/verdict`), so the verdict can be given
 * here rather than back on the list.
 *
 * A point that already has a decision shows it and offers no controls. A conversation with
 * no point renders nothing — every one stored before this landed is in that state.
 */

import { ChevronRight } from "lucide-react";
import { TicketLink } from "#/components/bits";
import { DecidedLine, VerdictControls } from "#/features/points/verdict";
import type { PointPage } from "#/lib/api";
import { daysSince } from "#/lib/utils";

function age(firstSeen: string) {
  const n = daysSince(firstSeen);
  if (n === null) {
    return "";
  }
  return n <= 0 ? "new" : `${n}d`;
}

export function PointCard({ page }: { page: PointPage | null }) {
  const point = page?.point;
  if (!(page && point)) {
    return null;
  }
  const subject = (
    <span className="display min-w-0 truncate text-[17px] text-ink leading-tight">
      {point.subject}
    </span>
  );

  if (point.decision) {
    return (
      <section className="mb-3 border-rule-soft border-b pb-3">
        <DecidedLine
          foundryUrl={page.foundry.url}
          head={
            <>
              {subject}
              {point.ticket && <TicketLink ticket={point.ticket} />}
            </>
          }
          point={point}
        />
      </section>
    );
  }

  return (
    <section className="mb-3 border-rule-soft border-b pb-3">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 self-center text-ink-faint transition-transform group-open:rotate-90"
            strokeWidth={1.75}
          />
          {subject}
          {point.ticket && <TicketLink ticket={point.ticket} />}
          <span className="mono ml-auto shrink-0 text-ink-faint">
            {age(point.firstSeen)}
          </span>
        </summary>
        <p className="mt-1 pl-7 text-ink-dim text-sm leading-snug">
          {point.ask}
        </p>
        {point.detail && (
          <p className="mt-1 max-w-[72ch] pl-7 text-ink-faint text-sm leading-snug">
            {point.detail}
          </p>
        )}
      </details>
      <div className="pl-7">
        <VerdictControls
          foundryOk={page.foundry.configured}
          foundryReason={page.foundry.reason}
          point={point}
        />
      </div>
    </section>
  );
}
