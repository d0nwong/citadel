/**
 * / — today. The Needs-you queue first (the sweep's points with their verdict controls —
 * `features/points/queue`), then the sweep log: the latest report with its `## Needs you`
 * section sliced out, since the queue above is that section with buttons. The latest digest
 * and Argus are one link each — the digest's own action-item list is the same items again.
 */

import type { MarkdownHeading } from "@tanstack/markdown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout } from "#/components/toc";
import { Queue } from "#/features/points/queue";
import { getInbox } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/")({
  staticData: { crumb: "Today" },
  loader: () => getInbox(),
  component: TodayPage,
});

/** "2026-09-07T12:16:00.000Z" → "13:16" — the tick, as a time of day. */
function tickTime(iso: string) {
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

function TodayPage() {
  const { report, digest, queue, conversations } = Route.useLoaderData();
  const open = queue.file
    ? queue.file.points.filter((p) => !p.decision).length
    : 0;
  const count =
    open === 0
      ? "Nothing needs you"
      : `${open} point${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} you`;
  return (
    <DocLayout>
      <PageHeader
        description={
          queue.file
            ? `${count} · last sweep tick ${tickTime(queue.file.tick)}`
            : undefined
        }
        title={report ? prettyDay(report.day) : "Nothing drawn yet"}
      />

      <Queue queue={queue} />

      <section className="mt-12">
        <div className="mb-2 flex items-baseline justify-between gap-4 border-border border-b pb-1.5">
          <h2 className="font-semibold text-base">Sweep log</h2>
          <Link
            className="text-subtle text-xs hover:text-primary"
            to="/reports"
          >
            all reports
          </Link>
        </div>
        {report ? (
          <>
            <SweepJumps headings={report.doc.headings ?? []} />
            <Md className="prose-loose" doc={report.doc} />
          </>
        ) : (
          <Empty title="No sweep report on file">
            The sweep writes{" "}
            <span className="mono">reports/&lt;day&gt;.md</span> each tick. Run{" "}
            <span className="mono">/sweep</span> in argus and this page fills
            in.
          </Empty>
        )}
      </section>

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
