import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Fact, FeatureLink, PageTitle } from "#/components/bits";
import { Md } from "#/components/md";
import { getDoc } from "#/lib/api";
import { cn } from "#/lib/utils";

interface Search {
  tier?: "product" | "arch";
}

export const Route = createFileRoute("/docs/$")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tier:
      s.tier === "arch" ? "arch" : s.tier === "product" ? "product" : undefined,
  }),
  loaderDeps: ({ search }) => ({ tier: search.tier ?? "product" }),
  loader: async ({ params, deps }) => {
    const feature = params._splat ?? "";
    let r = await getDoc({ data: { feature, tier: deps.tier } });
    // a feature with only one tier still opens on its first visit
    if (!r) {
      r = await getDoc({
        data: { feature, tier: deps.tier === "arch" ? "product" : "arch" },
      });
    }
    if (!r) {
      throw notFound();
    }
    return r;
  },
  component: DocPage,
  notFoundComponent: () => (
    <p className="text-ink-dim">No doc for that feature.</p>
  ),
});

function DocPage() {
  const { doc, meta, path } = Route.useLoaderData();
  const headings = (doc.headings ?? []).filter((h) => h.level <= 2);
  // The key is `<app>/<dir>`; the app is already the kicker's first half.
  const short = meta.feature.startsWith(`${meta.app}/`)
    ? meta.feature.slice(meta.app.length + 1)
    : meta.feature;
  return (
    <>
      <PageTitle
        aside={
          <span className="flex gap-1.5">
            {(["product", "arch"] as const).map((t) => (
              <Link
                className={cn(
                  "rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]",
                  meta.tier === t
                    ? "border-ink bg-ink text-paper"
                    : "border-rule text-ink-dim hover:border-thread hover:text-thread"
                )}
                key={t}
                params={{ _splat: meta.feature }}
                search={{ tier: t }}
                to="/docs/$"
              >
                {t}
              </Link>
            ))}
          </span>
        }
        kicker={
          <>
            {meta.app} ·{" "}
            <span className="normal-case tracking-normal">{short}</span>
          </>
        }
        title={meta.name ?? short}
      />
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[1fr_13rem]">
        <div className="rise min-w-0" style={{ animationDelay: "60ms" }}>
          <Md doc={doc} />
        </div>
        <aside
          className="rise order-first lg:sticky lg:top-6 lg:order-none lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto"
          style={{ animationDelay: "120ms" }}
        >
          <dl>
            <Fact label="Verified · FE">
              {meta.lastVerified && (
                <>
                  <span className="mono">{meta.lastVerified.slice(0, 9)}</span>
                  {meta.lastVerifiedDate && (
                    <span className="ml-2 text-ink-faint">
                      {meta.lastVerifiedDate}
                    </span>
                  )}
                </>
              )}
            </Fact>
            {/* Single-repo apps carry no backend stamp; `Fact` omits an empty row. */}
            <Fact label="Verified · BE">
              {meta.lastVerifiedBe && (
                <>
                  <span className="mono">
                    {meta.lastVerifiedBe.slice(0, 9)}
                  </span>
                  {meta.lastVerifiedBeDate && (
                    <span className="ml-2 text-ink-faint">
                      {meta.lastVerifiedBeDate}
                    </span>
                  )}
                </>
              )}
            </Fact>
            <Fact label="Status">{meta.status}</Fact>
            <Fact label="Owner">{meta.owner}</Fact>
            <Fact label="Related">
              {meta.related.length > 0 && (
                <span className="flex flex-wrap gap-x-2">
                  {meta.related.map((f) => (
                    <FeatureLink feature={f} key={f} />
                  ))}
                </span>
              )}
            </Fact>
            <Fact label="Journal">
              <Link
                className="text-thread hover:underline"
                search={{ feature: meta.feature }}
                to="/journal"
              >
                landings for {meta.feature}
              </Link>
            </Fact>
            <Fact label="File">
              <span className="mono break-all text-ink-faint">{path}</span>
            </Fact>
          </dl>
          {headings.length > 1 && (
            <nav className="mt-6 hidden lg:block">
              <p className="kicker mb-2">On this page</p>
              <ol className="flex flex-col gap-1 border-rule-soft border-l">
                {headings.map((h) => (
                  <li
                    className={cn(h.level === 1 ? "pl-3" : "pl-3")}
                    key={h.id}
                  >
                    <a
                      className="block text-ink-dim text-sm leading-snug hover:text-thread"
                      href={`#${h.id}`}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </aside>
      </div>
    </>
  );
}
