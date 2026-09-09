/**
 * /reports — the sweep log, which is what the home page was before the board took it
 * (LIA-160 AC1). The Needs-you queue first (the sweep's points with their verdict
 * controls — `features/points/queue`), then the latest report with its `## Needs you`
 * section sliced out, since the queue above is that section with buttons; then every
 * other day, and the latest digest and Argus as one link each.
 */

import type { MarkdownHeading } from "@tanstack/markdown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout } from "#/components/toc";
import { Queue } from "#/features/points/queue";
import { getSweepLog } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/reports/")({
  staticData: { crumb: "Reports" },
  loader: () => getSweepLog(),
  component: SweepLogPage,
});

/** "2026-09-07T12:16:00.000Z" → "13:16" — the last run, as a time of day. */
function runTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** The log's h2s — Done today, Linear today, Audit — as one row of anchors above it. */
function SweepJumps({ headings }: { headings: MarkdownHeading[] }) {
  const tops = headings.filter((h) => h.level === 2);
  if (tops.length < 2) {
    return null;
  }
  return (
    <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {tops.map((h) => (
        <a
          className="text-muted-foreground hover:text-foreground"
          href={`#${h.id}`}
          key={h.id}
        >
          {h.text}
        </a>
      ))}
    </p>
  );
}

function SweepLogPage() {
  const { report, days, digest, queue, conversations } = Route.useLoaderData();
  const open = queue.file
    ? queue.file.points.filter((p) => !p.decision).length
    : 0;
  const count =
    open === 0
      ? "Nothing needs you"
      : `${open} point${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} you`;
  const earlier = days.filter((d) => d.day !== report?.day);
  return (
    <DocLayout>
      <PageHeader
        description={
          queue.file
            ? `${count} · last sweep run ${runTime(queue.file.tick)}`
            : undefined
        }
        title={report ? prettyDay(report.day) : "Nothing drawn yet"}
      />

      <Queue queue={queue} />

      <section className="mt-12">
        <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
          Sweep log
        </h2>
        {report ? (
          <>
            <SweepJumps headings={report.doc.headings ?? []} />
            <Md className="prose-loose" doc={report.doc} />
          </>
        ) : (
          <Empty title="No sweep report on file">
            The sweep writes{" "}
            <span className="mono">reports/&lt;day&gt;.md</span> each run. Run{" "}
            <span className="mono">/sweep</span> in argus and this page fills
            in.
          </Empty>
        )}
      </section>

      {earlier.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
            Earlier days
          </h2>
          <ul className="-mx-2 flex flex-col">
            {earlier.map((r) => (
              <li key={r.day}>
                <Link
                  className="flex items-baseline gap-4 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                  params={{ day: r.day }}
                  to="/reports/$day"
                >
                  <span className="mono w-24 shrink-0 text-subtle">
                    {r.day}
                  </span>
                  <span className="shrink-0 font-medium text-foreground">
                    {prettyDay(r.day)}
                  </span>
                  {r.lede && (
                    <span className="min-w-0 truncate text-sm text-subtle">
                      {r.lede}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 grid gap-3 sm:grid-cols-2">
        {digest ? (
          <Link
            className="group rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent"
            params={{ day: digest.day }}
            to="/digests/$day"
          >
            <p className="flex items-center gap-1 font-medium text-sm">
              Latest digest · {prettyDay(digest.day, { weekday: false })}
              <ArrowUpRight className="size-3.5 text-subtle group-hover:text-foreground" />
            </p>
            {digest.lede && (
              <p className="mt-0.5 truncate text-subtle text-xs">
                {digest.lede}
              </p>
            )}
          </Link>
        ) : (
          <div className="rounded-lg border border-border border-dashed px-4 py-3 text-sm text-subtle">
            No digest on file
          </div>
        )}
        <Link
          className="group rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent"
          to="/ask"
        >
          <p className="flex items-center gap-1 font-medium text-sm">
            Ask Argus
            <ArrowUpRight className="size-3.5 text-subtle group-hover:text-foreground" />
          </p>
          <p className="mt-0.5 text-subtle text-xs">
            {conversations === 0
              ? "the blackboard, read-only"
              : `${conversations} conversation${conversations === 1 ? "" : "s"}`}
          </p>
        </Link>
      </section>
    </DocLayout>
  );
}
