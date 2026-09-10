/**
 * / — the board. `marauder/board.md` as the sweep rendered it: what needs the reader, what
 * is in flight by area, what waits on someone else, what shipped this week (LIA-155). The
 * whole page is that one file — nothing here re-derives, re-orders or annotates it, so what
 * a reader sees in Pensieve and what they see in a terminal are the same words.
 *
 * Two things the file cannot carry are added on the way through, both in
 * `server/marauder.ts`: its evidence links are pointed at the routes that serve them, and
 * each feature's name links to its own page. The day's sweep log — the queue and the
 * report that used to be here — moved to /reports (LIA-160 AC1).
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout, Toc } from "#/components/toc";
import { getBoard } from "#/lib/api";

export const Route = createFileRoute("/")({
  staticData: { crumb: "Board" },
  loader: () => getBoard(),
  component: BoardPage,
});

function BoardPage() {
  const { board, unsorted } = Route.useLoaderData();
  return (
    <>
      <PageHeader
        actions={
          unsorted > 0 && (
            <Link
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-foreground text-xs transition-colors hover:bg-accent"
              to="/unsorted"
            >
              <Inbox className="size-3.5 text-subtle" strokeWidth={1.75} />
              {unsorted} to sort
            </Link>
          )
        }
        title="Where the work stands"
      />
      {board ? (
        <DocLayout rail={<Toc headings={board.doc.headings ?? []} />}>
          <Md className="prose-loose" doc={board.doc} />
        </DocLayout>
      ) : (
        <DocLayout>
          <Empty title="No board drawn yet">
            The sweep writes <span className="mono">marauder/board.md</span>{" "}
            from every feature's <span className="mono">work.json</span> on
            every run. Run <span className="mono">marauder render</span> in
            argus and this page fills in.
          </Empty>
        </DocLayout>
      )}
    </>
  );
}
