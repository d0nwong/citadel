/**
 * The workstream a conversation was opened on, above the transcript (LIA-162 AC4). One line
 * and no controls: Send and Verify are on the workstream's own page, and a correction
 * arrives as a card in the thread — so all this has to do is say what "it" means in the
 * conversation below and link back. A conversation opened on nothing renders nothing.
 */

import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

export function WorkstreamLine({ slug }: { slug?: string }) {
  if (!slug) {
    return null;
  }
  return (
    <section className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-b pb-3">
      <span className="kicker">About</span>
      <Link
        className="mono inline-flex min-w-0 items-center gap-1 truncate text-foreground leading-tight hover:text-primary"
        params={{ slug }}
        to="/work/$slug"
      >
        {slug}
        <ArrowUpRight className="size-3 shrink-0" />
      </Link>
    </section>
  );
}
