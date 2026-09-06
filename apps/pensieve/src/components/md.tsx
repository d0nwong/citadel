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
    return (
      <Link to={href as "/"} {...(rest as object)}>
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
