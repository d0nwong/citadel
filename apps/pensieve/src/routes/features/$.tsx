/**
 * /features/$ — one feature, read from its ledger: the five questions a founder asks,
 * then what is in motion (the asks with what happened to each, the tickets and their
 * blockers, the proposals), then the requirements with who confirmed them, then the
 * landings. The arch doc is one link away.
 * A splat, because a feature is a directory and a directory nests: `admin/invoicing`.
 */

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MessageCircleQuestion } from "lucide-react";
import { PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { newThreadId } from "#/features/ask";
import {
  Asks,
  Landings,
  Proposals,
  Requirements,
  Story,
  Tickets,
} from "#/features/ledger/feature";
import { getLedger, listFeatureDirs } from "#/lib/api";

export const Route = createFileRoute("/features/$")({
  staticData: { crumb: "Features" },
  loader: async ({ params }) => {
    const [r, features] = await Promise.all([
      getLedger({ data: params._splat ?? "" }),
      listFeatureDirs(),
    ]);
    if (!r) {
      throw notFound();
    }
    return { ...r, crumb: r.dir, features };
  },
  component: FeaturePage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">No ledger for that feature yet.</p>
  ),
});

function FeaturePage() {
  const { feature, dir, ledger, features } = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-foreground text-xs transition-colors hover:bg-accent"
              params={{ _splat: feature }}
              search={{ tier: "arch" }}
              to="/docs/$"
            >
              How it is built
            </Link>
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
              Ask
            </Link>
          </>
        }
        description={ledger.summary}
        title={dir}
      />
      <div className="flex flex-col gap-10">
        <Story dir={dir} ledger={ledger} />
        <Asks dir={dir} features={features} ledger={ledger} />
        <Tickets tickets={ledger.tickets} />
        <Proposals dir={dir} proposals={ledger.proposals} />
        <Requirements dir={dir} ledger={ledger} />
        <Landings landings={ledger.landings} />
      </div>
    </DocLayout>
  );
}
