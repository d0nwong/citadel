/**
 * /features — every feature with a ledger, and how it is going in one line each.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { getHome } from "#/lib/api";

export const Route = createFileRoute("/features/")({
  staticData: { crumb: "Features" },
  loader: () => getHome(),
  component: FeaturesIndexPage,
});

function FeaturesIndexPage() {
  const { features } = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        description={`${features.length} with a ledger`}
        title="Features"
      />
      {features.length === 0 ? (
        <Empty title="No ledgers yet">
          Argus writes one <span className="mono">ledger.json</span> per
          feature. Run <span className="mono">argus seed --all</span> and this
          page fills in.
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {features.map((f) => (
            <li key={f.feature}>
              <Link
                className="flex flex-col gap-0.5 rounded-md px-2 py-3 transition-colors hover:bg-accent"
                params={{ _splat: f.feature }}
                to="/features/$"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-[15px] text-foreground">
                    {f.dir}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {f.open} open{f.onYou ? `, ${f.onYou} on you` : ""}
                    {f.ready ? `, ${f.ready} ready` : ""}
                  </span>
                </span>
                <span className="text-muted-foreground text-sm leading-snug">
                  {f.health || f.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DocLayout>
  );
}
