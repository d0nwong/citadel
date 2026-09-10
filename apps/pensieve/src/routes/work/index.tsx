/**
 * /work — every workstream, most recently moved first. The board says what needs a reader
 * right now and groups by that; this is the flat list, for when the question is "is there
 * one for this at all?" rather than "what should I look at?".
 *
 * Each row is the record's own words: the name, where each side has got to, the milestone
 * it points at, and a badge when something on it is waiting on the user (LIA-162 AC3's
 * events, counted). Parked ones sit at the end rather than being hidden — a parked
 * workstream is still the answer to "is that done yet?".
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Empty, PageHeader, Tag } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { listWork } from "#/lib/api";
import { SIDES } from "#/lib/marauder";

export const Route = createFileRoute("/work/")({
  staticData: { crumb: "Work" },
  loader: () => listWork(),
  component: WorkIndexPage,
});

const SIDE_WORD = { be: "BE", fe: "FE" } as const;

function WorkIndexPage() {
  const rows = Route.useLoaderData();
  const open = rows.filter((r) => !r.parked).length;
  return (
    <DocLayout>
      <PageHeader
        description={
          rows.length === 0
            ? undefined
            : `${open} open · ${rows.length - open} parked`
        }
        title="Work"
      />
      {rows.length === 0 ? (
        <Empty title="No workstreams yet">
          The sweep writes <span className="mono">workstreams/</span> as it
          ingests Slack and the landings. Run{" "}
          <span className="mono">/sweep</span> in argus and this page fills in.
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.slug}>
              <Link
                className="flex flex-col gap-1 rounded-md px-2 py-3 transition-colors hover:bg-accent"
                params={{ slug: r.slug }}
                to="/work/$slug"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-[15px] text-foreground">
                    {r.name}
                  </span>
                  {r.asks > 0 && <Tag tone="hold">{r.asks} waiting on you</Tag>}
                  {r.parked && <Tag tone="superseded">parked</Tag>}
                </span>
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-subtle text-xs">
                  {SIDES.filter((s) => r.stage[s]).map((s) => (
                    <span key={s}>
                      {SIDE_WORD[s]} {r.stage[s]}
                    </span>
                  ))}
                  {r.driver && <span>{r.driver}</span>}
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
