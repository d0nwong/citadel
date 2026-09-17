/**
 * The top bar's sweep line. While a tick runs it says so, with a way to its log; otherwise it
 * says when the last tick ended and when the next is due. Polled, since the sweep runs in its
 * own container; when a tick ends the page's loaders re-run, so what it wrote shows up.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { LoaderCircle, ScrollText } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "#/components/ui/button";
import { getSweepStatus } from "#/lib/api";
import { cn, prettyStamp, relativeTime } from "#/lib/utils";

export const SWEEP_STATUS_KEY = ["sweep-status"];

export function SweepStatus() {
  const router = useRouter();
  const { data: status } = useQuery({
    queryFn: () => getSweepStatus(),
    queryKey: SWEEP_STATUS_KEY,
    refetchInterval: (q) => (q.state.data?.running ? 5000 : 30_000),
  });

  const running = status?.running ?? false;
  const wasRunning = useRef<boolean>(running);
  useEffect(() => {
    const ended = wasRunning.current && !running;
    wasRunning.current = running;
    if (ended) {
      void router.invalidate();
    }
  }, [running, router]);

  if (!status) {
    return null;
  }

  if (status.running) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="hidden items-center gap-1.5 whitespace-nowrap font-medium text-foreground text-sm sm:inline-flex"
          title={
            status.startedAt
              ? `Started ${prettyStamp(status.startedAt)}`
              : undefined
          }
        >
          <LoaderCircle className="size-3.5 animate-spin text-primary" />
          Sweep running.....
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to="/sweep">
            <ScrollText />
            <span className="hidden sm:inline">Inspect logs</span>
            <span className="sm:hidden">Sweep logs</span>
          </Link>
        </Button>
      </div>
    );
  }

  const failed = status.lastExit !== undefined && status.lastExit !== 0;
  return (
    <Link
      className="hidden items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-accent hover:text-foreground md:inline-flex"
      title="Sweep logs"
      to="/sweep"
    >
      <span>Sweep last run</span>
      <span
        className={cn(
          "font-medium text-foreground",
          failed && "text-destructive"
        )}
        title={status.lastRunAt ? prettyStamp(status.lastRunAt) : undefined}
      >
        {status.lastRunAt ? relativeTime(status.lastRunAt) : "never"}
        {failed && ` (exit ${status.lastExit})`}
      </span>
      {status.nextRunAt && (
        <>
          <span aria-hidden>·</span>
          <span>next</span>
          <span
            className="font-medium text-foreground"
            title={prettyStamp(status.nextRunAt)}
          >
            {relativeTime(status.nextRunAt)}
          </span>
        </>
      )}
    </Link>
  );
}
