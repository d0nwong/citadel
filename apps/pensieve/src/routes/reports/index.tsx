import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageTitle } from "#/components/bits";
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
      <PageTitle
        aside={`${reports.length} day${reports.length === 1 ? "" : "s"}`}
        kicker="Sweep"
        title="Reports"
      />
      {reports.length === 0 && <Empty title="No reports yet" />}
      <ul className="divide-y divide-rule-soft">
        {reports.map((r, i) => (
          <li
            className="rise"
            key={r.day}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <Link
              className="group flex items-baseline gap-4 py-3"
              params={{ day: r.day }}
              to="/reports/$day"
            >
              <span className="mono w-28 shrink-0 text-ink-faint">{r.day}</span>
              <span className="display text-[19px] text-ink group-hover:text-thread">
                {prettyDay(r.day)}
              </span>
              {r.lede && (
                <span className="truncate text-ink-faint text-sm">
                  {r.lede}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
