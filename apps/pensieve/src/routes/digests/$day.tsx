import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout, Toc } from "#/components/toc";
import { getDigest } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/digests/$day")({
  loader: async ({ params }) => {
    const r = await getDigest({ data: params.day });
    if (!r) {
      throw notFound();
    }
    return r;
  },
  component: DigestPage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No digest for that day.</p>
  ),
});

function DigestPage() {
  const { day } = Route.useParams();
  const r = Route.useLoaderData();
  return (
    <>
      <PageHeader
        aside={<span className="mono text-subtle">{r.path}</span>}
        eyebrow="#dev-team digest"
        title={prettyDay(day)}
      />
      <DocLayout rail={<Toc headings={r.doc.headings ?? []} />}>
        <Md doc={r.doc} />
      </DocLayout>
    </>
  );
}
