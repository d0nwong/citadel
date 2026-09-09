import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Empty,
  FeatureLink,
  PageHeader,
  PrLink,
  StatusPill,
  TicketLink,
} from "#/components/bits";
import { listJournal } from "#/lib/api";
import { cn, prettyDay } from "#/lib/utils";
import type { JournalEntry, JournalStatus } from "#/server/workspace";

const STATUSES: Array<JournalStatus | "hold"> = [
  "decided",
  "implemented",
  "documented",
  "superseded",
  "hold",
];

interface Search {
  app?: string;
  day?: string;
  feature?: string;
  q?: string;
  status?: JournalStatus | "hold";
}

export const Route = createFileRoute("/journal/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    app: typeof s.app === "string" && s.app ? s.app : undefined,
    day: typeof s.day === "string" ? s.day : undefined,
    feature: typeof s.feature === "string" ? s.feature : undefined,
    status: STATUSES.includes(s.status as JournalStatus)
      ? (s.status as Search["status"])
      : undefined,
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
  loader: () => listJournal(),
  component: JournalPage,
});

function matches(e: JournalEntry, s: Search) {
  if (s.app && e.app !== s.app) {
    return false;
  }
  if (s.day && e.date !== s.day) {
    return false;
  }
  // `features:` holds bare ids, `e.feature` is `<app>/<dir>` — accept a filter written
  // either way, so a link from a doc's feature key and a click on this page agree.
  if (
    s.feature &&
    e.feature !== s.feature &&
    !e.features.includes(s.feature) &&
    !e.feature.endsWith(`/${s.feature}`)
  ) {
    return false;
  }
  if (s.status === "hold" ? !e.hold : s.status && e.status !== s.status) {
    return false;
  }
  if (s.q) {
    const hay =
      `${e.slug} ${e.summary ?? ""} ${e.pr ?? ""} ${e.ticket ?? ""} ${e.merge ?? ""}`.toLowerCase();
    if (!hay.includes(s.q.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function JournalPage() {
  const all = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const apps = useMemo(
    () => Array.from(new Set(all.map((e) => e.app))).sort(),
    [all]
  );
  // The feature list follows the app filter: every feature of every app at once is a
  // wall of names, and a feature only means something inside its app.
  const features = useMemo(
    () =>
      Array.from(
        new Set(
          all
            .filter((e) => !search.app || e.app === search.app)
            .map((e) => e.feature)
        )
      ).sort(),
    [all, search.app]
  );
  const shown = useMemo(
    () => all.filter((e) => matches(e, search)),
    [all, search]
  );
  const byDay = useMemo(() => {
    const m = new Map<string, JournalEntry[]>();
    for (const e of shown) {
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    return Array.from(m.entries());
  }, [shown]);

  const set = (patch: Partial<Search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const filtered = Boolean(
    search.app || search.day || search.feature || search.status || search.q
  );

  return (
    <>
      <PageHeader
        aside={
          <>
            {shown.length}
            {filtered ? ` of ${all.length}` : ""} entr
            {shown.length === 1 ? "y" : "ies"}
            {filtered && (
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
        eyebrow="Change journal"
        title={search.day ? prettyDay(search.day) : "Landings"}
      />

      <div className="mb-8 flex flex-col gap-3">
        {apps.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {apps.map((a) => (
              <button
                className={cn(
                  "rounded-md border px-2 py-0.5 font-medium text-xs transition-colors",
                  search.app === a
                    ? "border-primary bg-primary text-background"
                    : "border-border text-muted-foreground hover:border-muted-foreground"
                )}
                key={a}
                // Changing app drops the feature filter — a feature key belongs to one app.
                onClick={() =>
                  set({
                    app: search.app === a ? undefined : a,
                    feature: undefined,
                  })
                }
                type="button"
              >
                {a}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map((s) => (
            <button
              className={cn(
                "rounded-md border px-2 py-0.5 font-medium text-xs transition-colors",
                search.status === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              )}
              key={s}
              onClick={() =>
                set({ status: search.status === s ? undefined : s })
              }
              type="button"
            >
              {s}
            </button>
          ))}
          <input
            className="ml-auto w-full rounded-md border border-border bg-muted/60 px-3 py-1.5 font-mono text-foreground text-sm placeholder:text-subtle focus:border-primary focus:outline-none sm:w-72"
            onChange={(e) => set({ q: e.target.value || undefined })}
            placeholder="search slug, summary, pr, ticket…"
            value={search.q ?? ""}
          />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {features.map((f) => (
            <button
              className={cn(
                "mono transition-colors",
                search.feature === f
                  ? "text-primary underline underline-offset-4"
                  : "text-subtle hover:text-foreground"
              )}
              key={f}
              onClick={() =>
                set({ feature: search.feature === f ? undefined : f })
              }
              type="button"
            >
              {search.app && f.startsWith(`${search.app}/`)
                ? f.slice(search.app.length + 1)
                : f}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && (
        <Empty title="Nothing matches">
          Loosen a filter, or widen the window the sweep scans.
        </Empty>
      )}

      {byDay.map(([day, entries]) => (
        <section
          className="mb-8 grid grid-cols-1 gap-x-8 md:grid-cols-[9rem_1fr]"
          key={day}
        >
          <div className="md:sticky md:top-6 md:self-start">
            <Link
              className="block font-medium text-foreground leading-tight hover:text-primary"
              search={{ day }}
              to="/journal"
            >
              {prettyDay(day)}
            </Link>
            <p className="mono mt-0.5 text-subtle">
              {entries.length} landing{entries.length === 1 ? "" : "s"}
            </p>
          </div>
          <ol className="divide-y divide-border border-border border-t md:border-t-0">
            {entries.map((e) => (
              <li className="py-3" key={e.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <FeatureLink app={e.app} feature={e.feature} />
                  <PrLink pr={e.pr} url={e.url} />
                  {e.merge && (
                    <span className="mono text-subtle">
                      {e.merge.slice(0, 9)}
                    </span>
                  )}
                  <TicketLink ticket={e.ticket} />
                  <span className="ml-auto">
                    <StatusPill hold={e.hold} status={e.status} />
                  </span>
                </div>
                <Link
                  className="mt-1 block text-[16px] text-foreground leading-snug hover:text-primary"
                  params={{ _splat: e.id }}
                  to="/journal/$"
                >
                  {e.summary ?? e.slug}
                </Link>
                {e.hold && (
                  <p className="mt-1 text-sm text-st-hold italic">
                    hold: {e.hold}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
