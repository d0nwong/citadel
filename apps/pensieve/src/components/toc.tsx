import type { MarkdownHeading } from "@tanstack/markdown";
import { ListIcon } from "lucide-react";
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
      <p className="mb-3 flex items-center gap-2 font-semibold text-foreground text-sm">
        <ListIcon className="size-4 text-subtle" strokeWidth={1.75} />
        On this page
      </p>
      <ol className="flex flex-col gap-2 border-border border-l">
        {shown.map((h) => (
          <li className={cn(h.level === 3 ? "pl-7" : "pl-4")} key={h.id}>
            <a
              className="block truncate font-medium text-muted-foreground text-sm leading-snug hover:text-foreground"
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
 * The content column every page uses: a reading width of 720px and, when a page has a
 * rail, a sticky right column for the outline and the page's facts from `xl` up. Below
 * `xl` the rail's content comes first, in flow, so the facts are not lost on a phone.
 */
export function DocLayout({
  rail,
  children,
}: {
  rail?: ReactNode;
  children: ReactNode;
}) {
  if (!rail) {
    return <div className="min-w-0 max-w-[720px]">{children}</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-8 xl:grid-cols-[minmax(0,720px)_240px]">
      <div className="min-w-0">{children}</div>
      <aside className="order-first flex flex-col gap-8 xl:sticky xl:top-24 xl:order-none xl:max-h-[calc(100dvh-8rem)] xl:self-start xl:overflow-y-auto">
        {rail}
      </aside>
    </div>
  );
}
