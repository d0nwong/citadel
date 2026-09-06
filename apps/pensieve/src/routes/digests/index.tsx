import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageTitle } from "#/components/bits";
import { listDigests } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/digests/")({
  loader: () => listDigests(),
  component: DigestsPage,
});

function DigestsPage() {
  const digests = Route.useLoaderData();
  return (
    <>
      <PageTitle
        aside={`${digests.length} day${digests.length === 1 ? "" : "s"}`}
        kicker="#dev-team"
        title="Digests"
      />
      {digests.length === 0 && <Empty title="No digests yet" />}
      <ul className="divide-y divide-rule-soft">
        {digests.map((d, i) => (
          <li
            className="rise"
            key={d.day}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <Link
              className="group flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
              params={{ day: d.day }}
              to="/digests/$day"
            >
              <span className="mono w-28 shrink-0 text-ink-faint">{d.day}</span>
              <span className="display text-[19px] text-ink group-hover:text-thread">
                {prettyDay(d.day)}
              </span>
              {d.lede && (
                <span className="min-w-0 truncate text-ink-faint text-sm">
                  {d.lede}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
