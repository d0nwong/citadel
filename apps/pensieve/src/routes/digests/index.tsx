import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { listDigests } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/digests/")({
  staticData: { crumb: "Digests" },
  loader: () => listDigests(),
  component: DigestsPage,
});

function DigestsPage() {
  const digests = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        actions={`${digests.length} day${digests.length === 1 ? "" : "s"}`}
        title="Digests"
      />
      {digests.length === 0 && <Empty title="No digests yet" />}
      <ul className="-mx-2 flex flex-col">
        {digests.map((d) => (
          <li key={d.day}>
            <Link
              className="flex flex-col gap-0.5 rounded-md px-2 py-2 transition-colors hover:bg-accent sm:flex-row sm:items-baseline sm:gap-4"
              params={{ day: d.day }}
              to="/digests/$day"
            >
              <span className="mono w-24 shrink-0 text-subtle">{d.day}</span>
              <span className="shrink-0 font-medium text-foreground">
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
    </DocLayout>
  );
}
