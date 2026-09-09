import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
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
        aside={<span className="mono">{r.path}</span>}
        eyebrow="#dev-team digest"
        title={prettyDay(day)}
      />
      <div>
        <Md doc={r.doc} />
      </div>
    </>
  );
}
