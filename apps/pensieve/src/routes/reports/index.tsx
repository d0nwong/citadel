import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
import { listReports } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/reports/")({
  loader: () => listReports(),
  component: ReportsPage,
});

function ReportsPage() {
  const reports = Route.useLoaderData();
  return (
    <>
      <PageHeader
        aside={`${reports.length} day${reports.length === 1 ? "" : "s"}`}
        eyebrow="Sweep"
        title="Reports"
      />
      {reports.length === 0 && <Empty title="No reports yet" />}
      <ul className="divide-y divide-border">
        {reports.map((r) => (
          <li key={r.day}>
            <Link
              className="group flex items-baseline gap-4 py-3"
              params={{ day: r.day }}
              to="/reports/$day"
            >
              <span className="mono w-28 shrink-0 text-subtle">{r.day}</span>
              <span className="font-medium text-foreground group-hover:text-primary">
                {prettyDay(r.day)}
              </span>
              {r.lede && (
                <span className="truncate text-sm text-subtle">{r.lede}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
