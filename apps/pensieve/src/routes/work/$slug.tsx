/**
 * /work/$slug — one workstream's story. The page itself is `marauder/<slug>.md` as the
 * sweep rendered it: what it is, where it stands, what is open, what happened, in order
 * (LIA-155). The rail beside it is the record — `workstreams/<slug>.json` — which is where
 * the stage per side, the milestone, and the tickets and PRs it links out to come from
 * (LIA-160 AC2).
 *
 * The two halves cannot disagree, because the page is rendered from the record and both
 * are read here from the same file.
 */

import { createFileRoute, notFound } from "@tanstack/react-router";
import { Empty, Fact, PageHeader, Tag } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout } from "#/components/toc";
import { getWorkstream } from "#/lib/api";
import { SIDES } from "#/lib/marauder";
import { LINEAR_ISSUE } from "#/lib/utils";

export const Route = createFileRoute("/work/$slug")({
  staticData: { crumb: "Work" },
  loader: async ({ params }) => {
    const r = await getWorkstream({ data: params.slug });
    if (!(r.page || r.workstream)) {
      throw notFound();
    }
    return { ...r, crumb: r.workstream?.name ?? params.slug };
  },
  component: WorkstreamPage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No workstream by that name.</p>
  ),
});

/** How a side reads on the rail — the record's own word for it, with the side it is on. */
const SIDE_WORD = { be: "Backend", fe: "Frontend" } as const;

/** `fe#417` → the frontend repo's PR; `be#764` → the backend's. Nothing else is a PR key. */
const PR_URL: Record<string, string> = {
  be: "https://github.com/aldenstudios/alden-connect-portal-be/pull/",
  fe: "https://github.com/aldenstudios/alden-portal-fe/pull/",
};

function prHref(key: string): string | undefined {
  const m = key.match(/^(fe|be)#(\d+)$/);
  return m ? `${PR_URL[m[1]]}${m[2]}` : undefined;
}

function WorkstreamPage() {
  const { slug } = Route.useParams();
  const { page, workstream, milestone } = Route.useLoaderData();
  const w = workstream;
  return (
    <>
      <PageHeader
        actions={page && <span className="mono text-subtle">{page.path}</span>}
        title={w?.name ?? slug}
      />
      <DocLayout
        rail={
          w && (
            <dl>
              {SIDES.filter((s) => w.stage[s]).map((s) => (
                <Fact key={s} label={SIDE_WORD[s]}>
                  <Tag tone="neutral">{w.stage[s]}</Tag>
                </Fact>
              ))}
              <Fact label="Milestone">
                {milestone &&
                  `${milestone.name} · ${milestone.date}${milestone.owner ? ` · ${milestone.owner}` : ""}`}
              </Fact>
              <Fact label="Driver">{w.driver}</Fact>
              <Fact label="Wants it">
                {w.wants.length > 0 ? w.wants.join(", ") : undefined}
              </Fact>
              <Fact label="Tickets">
                {w.keys.tickets.length > 0 && (
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    {w.keys.tickets.map((t) => (
                      <a
                        className="mono text-primary hover:underline"
                        href={`${LINEAR_ISSUE}${t}`}
                        key={t}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {t}
                      </a>
                    ))}
                  </span>
                )}
              </Fact>
              <Fact label="Pull requests">
                {w.keys.prs.length > 0 && (
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    {w.keys.prs.map((pr) => {
                      const href = prHref(pr);
                      return href ? (
                        <a
                          className="mono text-primary hover:underline"
                          href={href}
                          key={pr}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {pr}
                        </a>
                      ) : (
                        <span className="mono" key={pr}>
                          {pr}
                        </span>
                      );
                    })}
                  </span>
                )}
              </Fact>
              {w.parked && (
                <Fact label="Parked">nothing is moving on this</Fact>
              )}
            </dl>
          )
        }
      >
        {page ? (
          <Md className="prose-loose" doc={page.doc} />
        ) : (
          <Empty title="No page drawn for this yet">
            The record is there, but{" "}
            <span className="mono">marauder/{slug}.md</span> has not been
            rendered. Run <span className="mono">marauder render</span> in
            argus.
          </Empty>
        )}
      </DocLayout>
    </>
  );
}
