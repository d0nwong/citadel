import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  Fact,
  FeatureLink,
  PageHeader,
  PrLink,
  StatusPill,
  TicketLink,
} from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout, Toc } from "#/components/toc";
import { getJournalEntry } from "#/lib/api";

export const Route = createFileRoute("/journal/$")({
  staticData: { crumb: "Journal" },
  loader: async ({ params }) => {
    const r = await getJournalEntry({ data: params._splat ?? "" });
    if (!r) {
      throw notFound();
    }
    return { ...r, crumb: r.meta.summary ?? r.meta.slug };
  },
  component: EntryPage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No journal entry at that path.</p>
  ),
});

function EntryPage() {
  const { doc, meta, path } = Route.useLoaderData();
  return (
    <>
      <PageHeader
        actions={<StatusPill hold={meta.hold} status={meta.status} />}
        title={meta.summary ?? meta.slug}
      />
      <DocLayout
        rail={
          <>
            <dl>
              <Fact label="Landing">
                <PrLink pr={meta.pr} url={meta.url} />
                {meta.merge && (
                  <span className="mono ml-2 text-subtle">{meta.merge}</span>
                )}
              </Fact>
              <Fact label="Ticket">
                <TicketLink ticket={meta.ticket} />
              </Fact>
              <Fact label="Scope">{meta.scope}</Fact>
              <Fact label="Features">
                <span className="flex flex-wrap gap-x-2">
                  {meta.features.map((f) => (
                    <FeatureLink feature={f} key={f} />
                  ))}
                </span>
              </Fact>
              <Fact label="Hold">
                {meta.hold && <span className="text-st-hold">{meta.hold}</span>}
              </Fact>
              <Fact label="Source">
                {meta.source && meta.source !== "null"
                  ? meta.source
                  : undefined}
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
