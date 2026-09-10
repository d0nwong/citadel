/**
 * /unsorted — the corrections queue. Everything `marauder ingest` could not attach to a
 * feature on its own, with its guess, and the one click that moves it (LIA-160 AC3).
 *
 * This is where the design keeps its honest: a click here is what teaches a feature its
 * next thread root or its vocabulary, so the next message like this one attaches without
 * anybody. The click writes a decision file and nothing else — `features/unsorted/queue`
 * has the whole of it.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Empty, PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { UnsortedQueue, UnsortedSummary } from "#/features/unsorted/queue";
import { getUnsorted } from "#/lib/api";

export const Route = createFileRoute("/unsorted")({
  staticData: { crumb: "Unsorted" },
  loader: () => getUnsorted(),
  component: UnsortedPage,
});

function UnsortedPage() {
  const page = Route.useLoaderData();
  return (
    <DocLayout>
      <PageHeader
        description={<UnsortedSummary page={page} />}
        title="Unsorted"
      />
      {page.items.length === 0 ? (
        <Empty title="Nothing waiting">
          Everything the last run took in attached to a feature on its own.
        </Empty>
      ) : (
        <UnsortedQueue page={page} />
      )}
    </DocLayout>
  );
}
