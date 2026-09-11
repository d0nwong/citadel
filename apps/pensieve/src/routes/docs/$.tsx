import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Fact, FeatureLink, PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout, Toc } from "#/components/toc";
import { getDoc } from "#/lib/api";
import { cn } from "#/lib/utils";

interface Search {
  tier?: "product" | "arch";
}

export const Route = createFileRoute("/docs/$")({
  staticData: { crumb: "Docs" },
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
    const short = r.meta.feature.startsWith(`${r.meta.app}/`)
      ? r.meta.feature.slice(r.meta.app.length + 1)
      : r.meta.feature;
    return { ...r, crumb: r.meta.name ?? short };
  },
  component: DocPage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No doc for that feature.</p>
  ),
});

function DocPage() {
  const { doc, meta, path } = Route.useLoaderData();
  // The key is `<app>/<dir>`; the app is already in the breadcrumb.
  const short = meta.feature.startsWith(`${meta.app}/`)
    ? meta.feature.slice(meta.app.length + 1)
    : meta.feature;
  return (
    <>
      <PageHeader
        actions={
          // The two tiers as a segmented control: one is always the page shown.
          <span className="inline-flex rounded-md border border-border p-0.5">
            {(["product", "arch"] as const).map((t) => (
              <Link
                className={cn(
                  "rounded-[5px] px-2.5 py-0.5 font-medium text-xs transition-colors",
                  meta.tier === t
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
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
        title={meta.name ?? short}
      />
      <DocLayout
        rail={
          <>
            <dl>
              <Fact label="Verified · FE">
                {meta.lastVerified && (
                  <>
                    <span className="mono">
                      {meta.lastVerified.slice(0, 9)}
                    </span>
                    {meta.lastVerifiedDate && (
                      <span className="ml-2 text-subtle">
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
                      <span className="ml-2 text-subtle">
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
              <Fact label="File">
                <span className="mono break-all text-subtle">{path}</span>
              </Fact>
            </dl>
            <Toc className="hidden xl:block" headings={doc.headings ?? []} />
          </>
        }
      >
        <Md doc={doc} />
      </DocLayout>
    </>
  );
}
