import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { listReports } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/reports/")({
  staticData: { crumb: "Reports" },
  loader: () => listReports(),
  component: ReportsPage,
});

function ReportsPage() {
  const reports = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        actions={`${reports.length} day${reports.length === 1 ? "" : "s"}`}
        title="Reports"
      />
      {reports.length === 0 && <Empty title="No reports yet" />}
      <ul className="-mx-2 flex flex-col">
        {reports.map((r) => (
          <li key={r.day}>
            <Link
              className="flex items-baseline gap-4 rounded-md px-2 py-2 transition-colors hover:bg-accent"
              params={{ day: r.day }}
              to="/reports/$day"
            >
              <span className="mono w-24 shrink-0 text-subtle">{r.day}</span>
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
    </DocLayout>
  );
}
