import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn, LINEAR_ISSUE } from "#/lib/utils";
import type { JournalStatus } from "#/server/workspace";

/**
 * The top of every page: an optional row of actions (a tier switch, a button, a count) at
 * the right, the title, and an optional one-line description — closed by a dashed rule,
 * the same rule that separates sections in prose. The breadcrumb lives in the top bar.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-10 border-border border-b border-dashed pb-8">
      {actions && (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2 text-muted-foreground text-sm">
          {actions}
        </div>
      )}
      <h1 className="font-semibold text-[28px] text-foreground leading-tight tracking-[-0.02em]">
        {title}
      </h1>
      {description && (
        <p className="mt-2 text-[16px] text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}
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
