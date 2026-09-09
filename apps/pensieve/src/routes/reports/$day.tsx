import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout, Toc } from "#/components/toc";
import { getReport } from "#/lib/api";
import { prettyDay } from "#/lib/utils";

export const Route = createFileRoute("/reports/$day")({
  loader: async ({ params }) => {
    const r = await getReport({ data: params.day });
    if (!r) {
      throw notFound();
    }
    return r;
  },
  component: ReportPage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No report for that day.</p>
  ),
});

function ReportPage() {
  const { day } = Route.useParams();
  const r = Route.useLoaderData();
  return (
    <>
      <PageHeader
        aside={<span className="mono text-subtle">{r.path}</span>}
        eyebrow="Sweep report"
        title={prettyDay(day)}
      />
      <DocLayout rail={<Toc headings={r.doc.headings ?? []} />}>
        <Md className="prose-loose" doc={r.doc} />
      </DocLayout>
    </>
  );
}
