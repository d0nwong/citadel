import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
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
      <PageHeader
        aside={`${digests.length} day${digests.length === 1 ? "" : "s"}`}
        eyebrow="#dev-team"
        title="Digests"
      />
      {digests.length === 0 && <Empty title="No digests yet" />}
      <ul className="divide-y divide-border">
        {digests.map((d) => (
          <li key={d.day}>
            <Link
              className="group flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
              params={{ day: d.day }}
              to="/digests/$day"
            >
              <span className="mono w-28 shrink-0 text-subtle">{d.day}</span>
              <span className="font-medium text-foreground group-hover:text-primary">
                {prettyDay(d.day)}
              </span>
              {d.lede && (
                <span className="min-w-0 truncate text-sm text-subtle">
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
