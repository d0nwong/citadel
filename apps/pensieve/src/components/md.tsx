import type { MarkdownInput } from "@tanstack/markdown";
import { Markdown } from "@tanstack/markdown/react";
import { Link } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";
import { cn } from "#/lib/utils";

/** Internal links become router navigations; everything else opens in a new tab. */
function A({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href?.startsWith("/")) {
    // A rewritten link may carry a query — `?tier=arch` on a feature doc — and the router
    // takes the path and the search apart rather than as one string.
    const [path, query] = href.split("?");
    const search = query
      ? Object.fromEntries(new URLSearchParams(query))
      : undefined;
    return (
      <Link
        to={path as "/"}
        {...(search ? { search } : {})}
        {...(rest as object)}
      >
        {children}
      </Link>
    );
  }
  return (
    <a href={href} rel="noreferrer noopener" target="_blank" {...rest}>
      {children}
    </a>
  );
}

const components = { a: A };

/** Renders a parsed document, or a raw markdown string (the chat blocks pass streaming text). */
export function Md({
  doc,
  className,
}: {
  doc: MarkdownInput;
  className?: string;
}) {
  return (
    <div className={cn("prose-pensieve", className)}>
      <Markdown components={components}>{doc}</Markdown>
    </div>
  );
}
