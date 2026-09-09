import type { MarkdownHeading } from "@tanstack/markdown";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * "On this page" — the document's h2s and h3s as anchor links, from the outline the
 * reader derives (`server/sections.ts` `outline`). Nothing to show for a page with fewer
 * than two headings.
 */
export function Toc({
  headings,
  className,
}: {
  headings: MarkdownHeading[];
  className?: string;
}) {
  const shown = headings.filter((h) => h.level === 2 || h.level === 3);
  if (shown.length < 2) {
    return null;
  }
  return (
    <nav aria-label="On this page" className={className}>
      <p className="kicker mb-2">On this page</p>
      <ol className="flex flex-col gap-1 border-border border-l">
        {shown.map((h) => (
          <li className={cn(h.level === 3 ? "pl-6" : "pl-3")} key={h.id}>
            <a
              className="block truncate text-[13px] text-muted-foreground leading-snug hover:text-foreground"
              href={`#${h.id}`}
              title={h.text}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A reading page: the prose column and, from `xl` up, a sticky right rail for the outline
 * and the page's facts. Below `xl` the rail's content comes first, in flow, so the facts
 * are not lost on a phone.
 */
export function DocLayout({
  rail,
  children,
}: {
  rail?: ReactNode;
  children: ReactNode;
}) {
  if (!rail) {
    return <div className="min-w-0">{children}</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_13rem]">
      <div className="min-w-0">{children}</div>
      <aside className="order-first flex flex-col gap-6 xl:sticky xl:top-8 xl:order-none xl:max-h-[calc(100dvh-4rem)] xl:self-start xl:overflow-y-auto">
        {rail}
      </aside>
    </div>
  );
}
