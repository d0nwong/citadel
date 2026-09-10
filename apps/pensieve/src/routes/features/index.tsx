/**
 * /features — every feature with something going on, most recently moved first. The board
 * says what needs a reader right now; this is the flat list, for when the question is "is
 * anything going on in this at all?" rather than "what should I look at?".
 *
 * Each row is one `work.json`: the feature's manifest name, the milestone it points at,
 * how many questions stand on it, and a badge when something on it is waiting on the user
 * (LIA-162 AC3's events, counted). A feature with nothing going on has no record and no row.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader, Tag } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { listWork } from "#/lib/api";

export const Route = createFileRoute("/features/")({
  staticData: { crumb: "Features" },
  loader: () => listWork(),
  component: FeaturesIndexPage,
});

function FeaturesIndexPage() {
  const rows = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        description={
          rows.length === 0 ? undefined : `${rows.length} with work going on`
        }
        title="Work"
      />
      {rows.length === 0 ? (
        <Empty title="Nothing going on yet">
          The sweep writes each feature's{" "}
          <span className="mono">work.json</span> as it ingests Slack and the
          landings. Run <span className="mono">/sweep</span> in argus and this
          page fills in.
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.feature}>
              <Link
                className="flex flex-col gap-1 rounded-md px-2 py-3 transition-colors hover:bg-accent"
                params={{ _splat: r.feature }}
                to="/features/$"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-[15px] text-foreground">
                    {r.name}
                  </span>
                  {r.asks > 0 && <Tag tone="hold">{r.asks} waiting on you</Tag>}
                </span>
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-subtle text-xs">
                  <span className="mono">{r.feature}</span>
                  {r.open > 0 && (
                    <span>
                      {r.open} open question{r.open === 1 ? "" : "s"}
                    </span>
                  )}
                  {r.milestone && (
                    <span>
                      {r.milestone.name} · {r.milestone.date}
                    </span>
                  )}
                  <span className="mono ml-auto">{r.updated.slice(0, 10)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DocLayout>
  );
}
