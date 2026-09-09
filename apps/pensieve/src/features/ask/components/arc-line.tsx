/**
 * The arc a conversation was opened on, above the transcript (LIA-149 AC4). One line and no
 * controls: an arc is opened from a card and closed on its own page, so the only thing this
 * has to do is say what "it" means in the conversation below and link to the file. A
 * conversation with no arc renders nothing.
 */

import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Tag } from "#/components/bits";
import type { ArcMeta } from "#/server/workspace";

export function ArcLine({ arc }: { arc: ArcMeta | null }) {
  if (!arc) {
    return null;
  }
  return (
    <section className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-b pb-3">
      <Link
        className="min-w-0 truncate font-medium text-foreground leading-tight hover:text-primary"
        params={{ slug: arc.slug }}
        to="/arcs/$slug"
      >
        {arc.title}
      </Link>
      {arc.status === "closed" && <Tag tone="superseded">closed</Tag>}
      <Link
        className="mono ml-auto inline-flex shrink-0 items-center gap-1 text-subtle hover:text-primary"
        params={{ slug: arc.slug }}
        to="/arcs/$slug"
      >
        {arc.path}
        <ArrowUpRight className="size-3" />
      </Link>
    </section>
  );
}
