import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Empty, PageHeader } from "#/components/bits";
import { listDocs } from "#/lib/api";
import { cn, daysSince } from "#/lib/utils";
import type { DocMeta } from "#/server/workspace";

interface Search {
  app?: string;
}

export const Route = createFileRoute("/docs/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    app: typeof s.app === "string" && s.app ? s.app : undefined,
  }),
  loader: () => listDocs(),
  component: DocsPage,
});

function Age({ date, label }: { date?: string; label: string }) {
  const d = daysSince(date);
  if (d === null) {
    return <span className="text-subtle">{label} —</span>;
  }
  // Widest threshold first: ordering them the other way makes the second unreachable.
  return (
    <span
      className={cn(
        d > 30 ? "text-st-hold" : d > 14 ? "text-st-decided" : "text-subtle"
      )}
      title={date}
    >
      {label} {d}d
    </span>
  );
}

/** One app's features. Rows show the key without its app prefix; links carry it. */
function AppSection({ app, docs }: { app: string; docs: DocMeta[] }) {
  const byFeature = useMemo(() => {
    const m = new Map<string, Partial<Record<DocMeta["tier"], DocMeta>>>();
    for (const d of docs) {
      m.set(d.feature, { ...(m.get(d.feature) ?? {}), [d.tier]: d });
    }
    return Array.from(m.entries());
  }, [docs]);

  return (
    <section className="mb-10">
      <div className="mb-1 flex items-baseline gap-3 border-border border-b pb-1">
        <h2 className="font-semibold text-base text-foreground">{app}</h2>
        <span className="text-subtle text-xs">
          {byFeature.length} feature{byFeature.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {byFeature.map(([feature, tiers]) => {
          const any = tiers.product ?? tiers.arch;
          const short = feature.startsWith(`${app}/`)
            ? feature.slice(app.length + 1)
            : feature;
          return (
            <li
              className="grid grid-cols-1 gap-x-6 gap-y-1 py-3 sm:grid-cols-[1fr_auto] sm:items-baseline"
              key={feature}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium text-foreground">
                    {any?.name ?? short}
                  </span>
                  <span className="mono text-subtle">{short}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  <Age date={any?.lastVerifiedDate} label="fe" />
                  {/* Single-repo apps have no backend tier, so an empty `be —` on every
                      row would be noise rather than a signal. */}
                  {any?.lastVerifiedBe && (
                    <Age date={any.lastVerifiedBeDate} label="be" />
                  )}
                  {any?.status && (
                    <span className="text-subtle">{any.status}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5">
                {(["product", "arch"] as const).map((t) =>
                  tiers[t] ? (
                    <Link
                      className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground hover:border-primary hover:text-primary"
                      key={t}
                      params={{ _splat: feature }}
                      search={{ tier: t }}
                      to="/docs/$"
                    >
                      {t}
                    </Link>
                  ) : (
                    <span
                      className="rounded-full border border-border border-dashed px-2.5 py-0.5 text-subtle/60"
                      key={t}
                    >
                      {t}
                    </span>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DocsPage() {
  const docs = Route.useLoaderData();
  const { app: selected } = Route.useSearch();
  const navigate = Route.useNavigate();

  const apps = useMemo(
    () => Array.from(new Set(docs.map((d) => d.app))).sort(),
    [docs]
  );
  const shown = useMemo(
    () => (selected ? docs.filter((d) => d.app === selected) : docs),
    [docs, selected]
  );
  const grouped = useMemo(() => {
    const m = new Map<string, DocMeta[]>();
    for (const d of shown) {
      m.set(d.app, [...(m.get(d.app) ?? []), d]);
    }
    return Array.from(m.entries());
  }, [shown]);
  const features = useMemo(
    () => new Set(shown.map((d) => d.feature)).size,
    [shown]
  );

  return (
    <>
      <PageHeader
        aside={
          <>
            {features} feature{features === 1 ? "" : "s"}
            {apps.length > 1 && !selected && ` · ${apps.length} apps`}
            {selected && (
              <button
                className="ml-3 text-primary hover:underline"
                onClick={() => navigate({ search: {}, replace: true })}
                type="button"
              >
                clear
              </button>
            )}
          </>
        }
        eyebrow="Dual-tier feature docs"
        title="Docs"
      />

      {apps.length > 1 && (
        <div className="mb-8 flex flex-wrap items-center gap-1.5">
          {apps.map((a) => (
            <button
              className={cn(
                "rounded-md border px-2 py-0.5 font-medium text-xs transition-colors",
                selected === a
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              )}
              key={a}
              onClick={() =>
                navigate({
                  search: selected === a ? {} : { app: a },
                  replace: true,
                })
              }
              type="button"
            >
              {a}
            </button>
          ))}
        </div>
      )}

      {grouped.length === 0 && <Empty title="No docs found" />}
      {grouped.map(([app, appDocs]) => (
        <AppSection app={app} docs={appDocs} key={app} />
      ))}
    </>
  );
}
