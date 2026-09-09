import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
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
      <PageHeader
        aside={
          <span className="mono text-subtle" title={workspace}>
            {workspace.replace(/^\/Users\/[^/]+/, "~")}
          </span>
        }
        eyebrow="Inbox"
        title={report ? prettyDay(report.day) : "Nothing drawn yet"}
      />

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="kicker">Sweep report</h2>
          <div className="flex items-baseline gap-4 text-sm">
            {openPoints !== null && (
              <Link
                className="inline-flex items-center gap-1 text-primary hover:underline"
                to="/points"
              >
                {openPoints === 0
                  ? "nothing needs you"
                  : `${openPoints} point${openPoints === 1 ? "" : "s"} need${openPoints === 1 ? "s" : ""} you`}
                <ArrowUpRight className="size-3" />
              </Link>
            )}
            <Link className="text-subtle hover:text-primary" to="/reports">
              past reports
            </Link>
            <Link
              className="inline-flex items-center gap-1 text-subtle hover:text-primary"
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

      <section className="mt-12">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="kicker">
            Latest digest
            {digest ? ` · ${prettyDay(digest.day, { weekday: false })}` : ""}
          </h2>
          {digest && (
            <Link
              className="inline-flex items-center gap-1 text-sm text-subtle hover:text-primary"
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
