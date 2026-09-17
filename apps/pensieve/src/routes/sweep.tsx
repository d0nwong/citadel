/**
 * /sweep — the running (or last) sweep tick's output. The loop tees Claude's stream-json into
 * the log; `lib/sweep-log` turns it into the model's text, its tool calls, a tool's failure
 * and the closing result. Polled while the tick runs.
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Empty, PageHeader } from "#/components/bits";
import { getSweepLog } from "#/lib/api";
import { type Entry, parseLog } from "#/lib/sweep-log";
import { cn, prettyStamp, relativeTime } from "#/lib/utils";
import type { SweepStatus } from "#/server/sweep";

export const Route = createFileRoute("/sweep")({
  staticData: { crumb: "Sweep" },
  loader: () => getSweepLog(),
  component: SweepPage,
});

function SweepPage() {
  const initial = Route.useLoaderData();
  const { data } = useQuery({
    initialData: initial,
    queryFn: () => getSweepLog(),
    queryKey: ["sweep-log"],
    refetchInterval: (q) => (q.state.data?.status?.running ? 3000 : false),
  });
  const { status, log } = data;
  const entries = log ? parseLog(log.text) : [];

  // Follow the tail while running, unless the reader has scrolled up.
  const bottom = useRef<HTMLDivElement>(null);
  const count = entries.length;
  useEffect(() => {
    if (!status?.running || count === 0) {
      return;
    }
    const nearBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 200;
    if (nearBottom) {
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [count, status?.running]);

  const description = describe(status);

  return (
    <div>
      <PageHeader
        actions={
          status?.running && (
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <LoaderCircle className="size-3.5 animate-spin text-primary" />
              Sweep running.....
            </span>
          )
        }
        description={description}
        title={status?.running ? "Sweep log" : "Last sweep log"}
      />
      {!log || entries.length === 0 ? (
        <Empty title="No log yet">
          The loop writes <span className="mono">.git/sweep.log</span> in the
          data repo on each tick.
        </Empty>
      ) : (
        <ol className="space-y-2 text-sm">
          {log.truncated && (
            <li className="text-subtle text-xs">
              Earlier output trimmed; showing the tail.
            </li>
          )}
          {entries.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the log only grows at the end
            <li key={i}>
              <LogEntry entry={e} />
            </li>
          ))}
        </ol>
      )}
      <div ref={bottom} />
    </div>
  );
}

function describe(status: SweepStatus | null): string {
  if (!status) {
    return "The stack's sweep loop has not written a status yet.";
  }
  if (status.running) {
    return `Running since ${status.startedAt ? prettyStamp(status.startedAt) : "—"}`;
  }
  const exit = status.lastExit ? ` (exit ${status.lastExit})` : "";
  return [
    status.lastRunAt &&
      `Last run ended ${relativeTime(status.lastRunAt)}${exit}`,
    status.nextRunAt && `next ${relativeTime(status.nextRunAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function LogEntry({ entry: e }: { entry: Entry }) {
  switch (e.kind) {
    case "text":
      return (
        <p className="whitespace-pre-wrap text-foreground leading-relaxed">
          {e.text}
        </p>
      );
    case "tool":
      return (
        <p className="mono flex min-w-0 gap-2 text-muted-foreground text-xs">
          <span className="shrink-0 font-medium text-primary">{e.name}</span>
          <span className="truncate" title={e.detail}>
            {e.detail}
          </span>
        </p>
      );
    case "error":
      return (
        <pre className="mono whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
          {e.text}
        </pre>
      );
    case "result":
      return (
        <div
          className={cn(
            "mt-4 rounded-md border px-4 py-3",
            e.ok ? "border-border bg-muted/40" : "border-destructive/40"
          )}
        >
          <p className="mb-1 font-medium text-foreground text-xs">
            {e.ok ? "Finished" : "Failed"}
            {e.meta && (
              <span className="ml-2 font-normal text-muted-foreground">
                {e.meta}
              </span>
            )}
          </p>
          <p className="whitespace-pre-wrap text-foreground">{e.text}</p>
        </div>
      );
    default:
      return (
        <pre className="mono whitespace-pre-wrap text-subtle text-xs">
          {e.text}
        </pre>
      );
  }
}
