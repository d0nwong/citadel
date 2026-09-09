/**
 * /arcs — where every initiative is, on one screen (LIA-149 AC1). An open arc is a card
 * with its whole "Where we are" paragraph, since that paragraph is the page: the reader
 * comes here to see the story before acting on one step of it, and a truncated one would
 * send them into every arc to find out. The count and the date are what say whether it is
 * moving. Closed arcs fold underneath — they are the record, not the work.
 *
 * Nothing here writes; the arc files are the sweep's (argus `skills/sweep/scripts/arcs.ts`)
 * and the two verdicts that open and close one are `decisions/arc/<slug>.json` (LIA-147).
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout } from "#/components/toc";
import { listArcs } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/arcs/")({
  staticData: { crumb: "Arcs" },
  loader: () => listArcs(),
  component: ArcsPage,
});

const points = (n: number) => `${n} open point${n === 1 ? "" : "s"}`;

function ArcsPage() {
  const { open, closed } = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        description={
          open.length > 0
            ? `${open.length} open · one running story per initiative`
            : undefined
        }
        title="Arcs"
      />

      {open.length === 0 && closed.length === 0 && (
        <Empty title="No arcs yet">
          An arc is opened from a conversation — ask Argus about an initiative
          and confirm the card it proposes. The sweep then writes{" "}
          <span className="mono">arcs/&lt;slug&gt;.md</span> on its next tick
          and keeps it current.
        </Empty>
      )}

      <div className="flex flex-col gap-4">
        {open.map((arc) => (
          <Link
            className="group rounded-lg border border-border px-5 py-4 transition-colors hover:bg-accent"
            key={arc.meta.slug}
            params={{ slug: arc.meta.slug }}
            to="/arcs/$slug"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-semibold text-[17px] text-foreground leading-tight">
                {arc.meta.title}
              </h2>
              <span className="text-subtle text-xs">
                {points(arc.openCount)}
              </span>
              <span className="ml-auto text-subtle text-xs">
                {arc.meta.updated
                  ? prettyDay(arc.meta.updated, { weekday: false })
                  : "not rewritten yet"}
              </span>
            </div>
            {arc.where.children.length > 0 ? (
              <Md className="prose-tight mt-1.5" doc={arc.where} />
            ) : (
              <p className="mt-1.5 text-sm text-subtle leading-normal">
                The sweep writes this arc's paragraph on its next tick.
              </p>
            )}
          </Link>
        ))}
      </div>

      {closed.length > 0 && (
        <details className="group mt-8 border-border border-t pt-3">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 self-center transition-transform group-open:rotate-90"
              strokeWidth={1.75}
            />
            <span className="font-semibold text-base">Closed</span>
            <span className="text-subtle text-xs">{closed.length}</span>
          </summary>
          <ul className="mt-2 divide-y divide-border pl-6">
            {closed.map((meta) => (
              <li key={meta.slug}>
                <Link
                  className="flex items-baseline gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                  params={{ slug: meta.slug }}
                  to="/arcs/$slug"
                >
                  <span className="min-w-0 truncate font-medium text-muted-foreground">
                    {meta.title}
                  </span>
                  <span className="ml-auto shrink-0 text-subtle text-xs">
                    {meta.updated
                      ? `closed ${prettyDay(meta.updated, { weekday: false })}`
                      : "closed"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </DocLayout>
  );
}
