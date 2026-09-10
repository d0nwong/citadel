/**
 * /features/$ — one feature's story, and the two things a reader does about it (ARG-167).
 *
 * A splat, because a feature is a directory and a directory nests: `admin/invoicing`. The
 * page itself is `<app>/features/<dir>/board.md` as argus rendered it beside the feature's
 * docs (ARG-166): the date it points at, what is open, what happened. The rail beside it is
 * the record — `work.json` in the same directory — which is where the milestone, the open
 * questions and the PRs come from. The two halves cannot disagree, because the page is
 * rendered from the record and both are read here from the same directory.
 *
 * Above the page are the actions, because they are what a reader came to do: the events
 * that asked them something, each with Verify, and the tickets, each with Send when Foundry
 * can take it (LIA-162 AC2, AC3) — keyed on the ticket and the event, so they moved here
 * from the workstream page unchanged. Ask opens from here carrying `?feature=`, so a
 * question asked from this page starts with this feature (AC5).
 */

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MessageCircleQuestion } from "lucide-react";
import { Empty, Fact, PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout } from "#/components/toc";
import { newThreadId } from "#/features/ask";
import { Asks, Tickets } from "#/features/work/actions";
import { getFeature } from "#/lib/api";

export const Route = createFileRoute("/features/$")({
  staticData: { crumb: "Features" },
  loader: async ({ params }) => {
    const r = await getFeature({ data: params._splat ?? "" });
    if (!r) {
      throw notFound();
    }
    return { ...r, crumb: r.name };
  },
  component: FeaturePage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No feature by that name.</p>
  ),
});

/** `fe#417` → the frontend repo's PR; `be#764` → the backend's. Nothing else is a PR key. */
const PR_URL: Record<string, string> = {
  be: "https://github.com/aldenstudios/alden-connect-portal-be/pull/",
  fe: "https://github.com/aldenstudios/alden-portal-fe/pull/",
};

const PR_KEY_RE = /^(fe|be)#(\d+)$/;

function prHref(key: string): string | undefined {
  const m = PR_KEY_RE.exec(key);
  return m ? `${PR_URL[m[1]]}${m[2]}` : undefined;
}

function PullRequests({ prs }: { prs: string[] }) {
  if (prs.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {prs.map((pr) => {
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
  );
}

function FeaturePage() {
  const {
    app,
    asks,
    feature,
    foundry,
    milestone,
    name,
    page,
    repos,
    tickets,
    work,
  } = Route.useLoaderData();
  return (
    <>
      <PageHeader
        actions={
          <Link
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-foreground text-xs transition-colors hover:bg-accent"
            params={{ id: newThreadId() }}
            search={{ feature }}
            to="/ask/$id"
          >
            <MessageCircleQuestion
              className="size-3.5 text-subtle"
              strokeWidth={1.75}
            />
            Ask about this
          </Link>
        }
        title={name}
      />
      <DocLayout
        rail={
          <dl>
            <Fact label="Docs">
              <Link
                className="text-primary hover:underline"
                params={{ _splat: `${app}/${feature}` }}
                to="/docs/$"
              >
                {feature}
              </Link>
            </Fact>
            <Fact label="Milestone">
              {milestone &&
                `${milestone.name} · ${milestone.date}${milestone.owner ? ` · ${milestone.owner}` : ""}`}
            </Fact>
            <Fact label="Open questions">
              {work && work.openQuestions.length > 0
                ? work.openQuestions.length
                : undefined}
            </Fact>
            <Fact label="Pull requests">
              {work && <PullRequests prs={work.keys.prs} />}
            </Fact>
            {page && (
              <Fact label="Rendered from">
                <span className="mono">{page.path}</span>
              </Fact>
            )}
          </dl>
        }
      >
        <Asks asks={asks} />
        <Tickets foundry={foundry} repos={repos} tickets={tickets} />
        {page ? (
          <Md className="prose-loose" doc={page.doc} />
        ) : (
          <Empty title="No page drawn for this yet">
            The record is there, but{" "}
            <span className="mono">
              {app}/features/{feature}/board.md
            </span>{" "}
            has not been rendered. Run{" "}
            <span className="mono">marauder render</span> in argus.
          </Empty>
        )}
      </DocLayout>
    </>
  );
}
