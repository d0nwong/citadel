import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageTitle } from "#/components/bits";
import { Md } from "#/components/md";
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
    <p className="text-ink-dim">No report for that day.</p>
  ),
});

function ReportPage() {
  const { day } = Route.useParams();
  const r = Route.useLoaderData();
  return (
    <>
      <PageTitle
        aside={<span className="mono">{r.path}</span>}
        kicker="Sweep report"
        title={prettyDay(day)}
      />
      <div className="rise" style={{ animationDelay: "60ms" }}>
        <Md doc={r.doc} />
      </div>
    </>
  );
}
