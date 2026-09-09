import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn, LINEAR_ISSUE } from "#/lib/utils";
import type { JournalStatus } from "#/server/workspace";

/**
 * The top of every page: an optional eyebrow (a breadcrumb or a section name), the title,
 * an optional one-line description under it, and whatever the page keeps at the right —
 * a count, a path, a button.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-border border-b pb-5">
      <div className="min-w-0">
        {eyebrow && (
          <p className="kicker mb-1.5 flex flex-wrap items-center gap-x-1.5">
            {eyebrow}
          </p>
        )}
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {aside && <div className="text-muted-foreground text-sm">{aside}</div>}
    </header>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border border-dashed px-6 py-10 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {children && (
        <div className="mx-auto mt-1.5 max-w-md text-muted-foreground text-sm">
          {children}
        </div>
      )}
    </div>
  );
}

// ── tags ───────────────────────────────────────────────────────────────────────

export type Tone =
  | "decided"
  | "implemented"
  | "documented"
  | "superseded"
  | "hold"
  | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  decided: "bg-st-decided/10 text-st-decided",
  documented: "bg-st-documented/10 text-st-documented",
  hold: "bg-st-hold/10 text-st-hold",
  implemented: "bg-st-implemented/10 text-st-implemented",
  neutral: "bg-muted text-muted-foreground",
  superseded:
    "bg-st-superseded/10 text-st-superseded line-through decoration-1",
};

/** A small tinted label — a status, a verdict, a job state. `live` adds a pulsing dot. */
export function Tag({
  tone = "neutral",
  live,
  title,
  className,
  children,
}: {
  tone?: Tone;
  live?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-xs leading-5",
        TONE_CLASS[tone],
        className
      )}
      title={title}
    >
      {live && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  hold,
}: {
  status?: JournalStatus;
  hold?: string;
}) {
  const key = hold ? "hold" : status;
  if (!key) {
    return null;
  }
  return (
    <Tag title={hold ? `hold: ${hold}` : undefined} tone={key}>
      {key}
    </Tag>
  );
}

/** A frontmatter key/value, laid out as marginalia. */
export function Fact({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  if (children === undefined || children === null || children === "") {
    return null;
  }
  return (
    <div className="flex flex-col gap-0.5 border-border border-t py-2 first:border-t-0">
      <dt className="kicker">{label}</dt>
      <dd className="text-foreground text-sm leading-snug">{children}</dd>
    </div>
  );
}

export function TicketLink({ ticket }: { ticket?: string }) {
  if (!ticket || ticket === "null") {
    return <span className="text-subtle">unattributed</span>;
  }
  return (
    <a
      className="mono text-primary hover:underline"
      href={`${LINEAR_ISSUE}${ticket}`}
      rel="noreferrer"
      target="_blank"
    >
      {ticket}
    </a>
  );
}

export function PrLink({ pr, url }: { pr?: string; url?: string }) {
  if (!pr || pr === "null") {
    return null;
  }
  const inner = <span className="mono">{pr}</span>;
  return url ? (
    <a
      className="text-primary hover:underline"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

/**
 * A feature key is `<app>/<dir>`. Pass the app to show only the part that varies within
 * it — the link still carries the whole key, so it never becomes ambiguous.
 */
export function FeatureLink({
  feature,
  app,
  className,
}: {
  feature: string;
  app?: string;
  className?: string;
}) {
  const label =
    app && feature.startsWith(`${app}/`)
      ? feature.slice(app.length + 1)
      : feature;
  return (
    <Link
      className={cn("mono text-muted-foreground hover:text-primary", className)}
      params={{ _splat: feature }}
      to="/docs/$"
    >
      {label}
    </Link>
  );
}

/**
 * A one-line markdown string — a point's subject, ask or detail — with its `code` spans
 * rendered and nothing else interpreted. The sweep writes these as markdown, and a
 * backtick on screen reads as a typo.
 */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code
            className="rounded border border-border bg-muted px-1 py-px font-mono text-[0.85em]"
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts are positional text, with no identity of their own
            key={i}
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
