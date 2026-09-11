/**
 * / — home. Three lists over every feature's ledger: the asks aimed at you that are not
 * done, the tickets of yours with nothing left to wait for, and what the last runs could
 * not place on a feature. Under them, one line per feature. Nothing here is a rendered
 * page; every row is read from `ledger.json` and every click runs one argus verb.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { NeedsMe, Ready, UnplacedList } from "#/features/ledger/home";
import { getHome, getSendOptions } from "#/lib/api";

export const Route = createFileRoute("/")({
  staticData: { crumb: "Home" },
  loader: async () => {
    const [home, send] = await Promise.all([getHome(), getSendOptions()]);
    return { ...home, send };
  },
  component: HomePage,
});

function HomePage() {
  const h = Route.useLoaderData();
  const features = h.features.map((f) => f.dir);
  return (
    <DocLayout>
      <PageHeader
        description={
          h.onYou.length === 0
            ? "Nothing is waiting on you."
            : `${h.onYou.length} ${h.onYou.length === 1 ? "thing is" : "things are"} waiting on you.`
        }
        title="Where the work stands"
      />
      <div className="flex flex-col gap-10">
        <section>
          <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
            On you
          </h2>
          <NeedsMe asks={h.onYou} features={features} />
        </section>
        <section>
          <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
            Ready to work on
          </h2>
          <Ready asks={h.readyAsks} send={h.send} tickets={h.ready} />
        </section>
        <section>
          <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
            Unplaced{" "}
            <span className="font-normal text-muted-foreground">
              {h.unplaced.length}
            </span>
          </h2>
          <UnplacedList features={features} items={h.unplaced} />
        </section>
        <section>
          <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
            Features
          </h2>
          <ul className="divide-y divide-border">
            {h.features.map((f) => (
              <li key={f.feature}>
                <Link
                  className="flex flex-col gap-0.5 rounded-md px-2 py-2.5 transition-colors hover:bg-accent"
                  params={{ _splat: f.feature }}
                  to="/features/$"
                >
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium text-[15px] text-foreground">
                      {f.dir}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {f.open} open{f.onYou ? `, ${f.onYou} on you` : ""}
                      {f.proposals ? `, ${f.proposals} proposed` : ""}
                    </span>
                  </span>
                  {f.health && (
                    <span className="text-muted-foreground text-sm leading-snug">
                      {f.health}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {h.problems.length > 0 && (
            <p className="mt-3 text-st-hold text-xs">
              {h.problems.map((p) => `${p.dir}: ${p.problem}`).join(" · ")}
            </p>
          )}
        </section>
      </div>
    </DocLayout>
  );
}
