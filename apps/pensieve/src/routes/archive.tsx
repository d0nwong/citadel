/**
 * /archive — the reading layer the loop had before the board (LIA-161). A sweep report per
 * day and a Slack digest per day, both written until 2026-09-09 and neither written since;
 * every file already committed stays readable, and this is the index of them.
 *
 * Nothing here is the state of the work — that is the board's, and the line at the top says
 * so. `/reports`, `/digests` and `/arcs` land here too, since the pages they used to have
 * read files nobody writes any more (LIA-162 AC1).
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { getArchive } from "#/lib/api";
import { prettyDay } from "#/lib/utils";
import type { DayFile } from "#/server/workspace";

export const Route = createFileRoute("/archive")({
  staticData: { crumb: "Archive" },
  loader: () => getArchive(),
  component: ArchivePage,
});

function Days({
  days,
  empty,
  to,
}: {
  days: DayFile[];
  empty: string;
  to: "/reports/$day" | "/digests/$day";
}) {
  if (days.length === 0) {
    return <p className="px-2 py-2 text-sm text-subtle">{empty}</p>;
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {days.map((d) => (
        <li key={d.day}>
          <Link
            className="flex items-baseline gap-4 rounded-md px-2 py-2 transition-colors hover:bg-accent"
            params={{ day: d.day }}
            to={to}
          >
            <span className="mono w-24 shrink-0 text-subtle">{d.day}</span>
            <span className="shrink-0 font-medium text-foreground">
              {prettyDay(d.day)}
            </span>
            {d.lede && (
              <span className="min-w-0 truncate text-sm text-subtle">
                {d.lede}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ArchivePage() {
  const { digests, reports } = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        description="What the loop wrote before the board replaced it on 9 September 2026. Nothing writes these files any more."
        title="Archive"
      />
      <p className="mb-8 text-muted-foreground text-sm leading-normal">
        Where the work stands now is{" "}
        <Link className="text-primary hover:underline" to="/">
          the board
        </Link>
        , and every feature with work going on has its own page under{" "}
        <Link className="text-primary hover:underline" to="/features">
          Work
        </Link>
        .
      </p>

      {reports.length === 0 && digests.length === 0 ? (
        <Empty title="Nothing in the archive">
          No <span className="mono">reports/</span> or{" "}
          <span className="mono">digests/</span> files are on disk.
        </Empty>
      ) : (
        <>
          <section>
            <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
              Sweep reports
            </h2>
            <Days
              days={reports}
              empty="No reports on file."
              to="/reports/$day"
            />
          </section>
          <section className="mt-12">
            <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
              Slack digests
            </h2>
            <Days
              days={digests}
              empty="No digests on file."
              to="/digests/$day"
            />
          </section>
        </>
      )}
    </DocLayout>
  );
}
