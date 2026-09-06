import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Empty, PageTitle } from "#/components/bits";
import { Md } from "#/components/md";
import { getInbox } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/")({
  loader: () => getInbox(),
  component: InboxPage,
});

function InboxPage() {
  const { report, digest, workspace, openPoints, conversations } =
    Route.useLoaderData();
  return (
    <>
      <PageTitle
        aside={
          <span className="mono text-ink-faint" title={workspace}>
            {workspace.replace(/^\/Users\/[^/]+/, "~")}
          </span>
        }
        kicker="Inbox"
        title={report ? prettyDay(report.day) : "Nothing drawn yet"}
      />

      <section className="rise" style={{ animationDelay: "60ms" }}>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="kicker">Sweep report</h2>
          <div className="flex items-baseline gap-4 text-sm">
            {openPoints !== null && (
              <Link
                className="inline-flex items-center gap-1 text-thread hover:underline"
                to="/points"
              >
                {openPoints === 0
                  ? "nothing needs you"
                  : `${openPoints} point${openPoints === 1 ? "" : "s"} need${openPoints === 1 ? "s" : ""} you`}
                <ArrowUpRight className="size-3" />
              </Link>
            )}
            <Link className="text-ink-faint hover:text-thread" to="/reports">
              past reports
            </Link>
            <Link
              className="inline-flex items-center gap-1 text-ink-faint hover:text-thread"
              to="/ask"
            >
              {conversations === 0
                ? "ask argus"
                : `${conversations} conversation${conversations === 1 ? "" : "s"}`}
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </div>
        {report ? (
          <Md doc={report.doc} />
        ) : (
          <Empty title="No sweep report on file">
            The sweep writes{" "}
            <span className="mono">reports/&lt;day&gt;.md</span> each tick. Run{" "}
            <span className="mono">/sweep</span> in argus and this page fills
            in.
          </Empty>
        )}
      </section>

      <section className="rise mt-12" style={{ animationDelay: "140ms" }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="kicker">
            Latest digest
            {digest ? ` · ${prettyDay(digest.day, { weekday: false })}` : ""}
          </h2>
          {digest && (
            <Link
              className="inline-flex items-center gap-1 text-ink-faint text-sm hover:text-thread"
              params={{ day: digest.day }}
              to="/digests/$day"
            >
              open <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>
        {digest ? <Md doc={digest.doc} /> : <Empty title="No digest on file" />}
      </section>
    </>
  );
}
