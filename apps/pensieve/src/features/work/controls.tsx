/**
 * The bits both actions on a feature page share: the field a Send's repo is chosen in,
 * the one way either click is committed, the sentence a refusal is shown in, the
 * submit/cancel pair, and the live job line a sent ticket wears.
 *
 * This is what `features/points/verdict` was before the points went (LIA-161), re-keyed and
 * cut down: a verdict used to be given on a point and is now given on a ticket or on an
 * event, so nothing here knows what it is committing — the caller passes the call.
 * Ask's proposal card reuses the same commit, so a Send confirmed on a card and one pressed
 * on the page take the same path and write the same file.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Tone } from "#/components/bits";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import { jobStatus } from "#/lib/api";
import { NO_BLUEPRINT, repoOptions } from "#/lib/send";
import { cn } from "#/lib/utils";
import type { FoundryBlueprint, FoundryRepo } from "#/server/foundry";

export const shortId = (id: string) => id.slice(0, 8);

/** One field style for every input the two forms show. */
export const FIELD_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-foreground text-sm placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

export function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-GB", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

// ── the repo a send lands in ───────────────────────────────────────────────────

/**
 * Where the work lands, as the Send form and Ask's proposal card both ask it: a select over
 * the repos `GET /api/repos` answered for this page load, or — for a Foundry that could not
 * answer with a list at all — the free-text box that was here before (LIA-120, AC4).
 *
 * The value is always what travels as `repo`: a chosen row contributes its `name`, which
 * `POST /api/jobs` accepts verbatim, so nothing here has to re-validate a choice Foundry
 * itself supplied. The chosen row's path is shown under it — the names are short, and which
 * checkout the job will run in is the thing worth being sure of before pressing Send.
 */
export function RepoField({
  autoFocus,
  className,
  id,
  onChange,
  repos,
  value,
}: {
  autoFocus?: boolean;
  className?: string;
  id: string;
  onChange: (repo: string) => void;
  repos: FoundryRepo[];
  value: string;
}) {
  const options = repoOptions(repos);
  const picked = options.find((o) => o.value === value);
  return (
    <>
      <label className="kicker" htmlFor={id}>
        Repo the work lands in
      </label>
      {options.length > 0 ? (
        <>
          {/* Native, so it is a picker on a phone and with a keyboard — but wearing the
              page's own chevron, since a select styled like the text field it replaced
              reads as one. */}
          <div className="relative">
            <select
              autoFocus={autoFocus}
              className={cn(
                FIELD_CLASS,
                "mono",
                className,
                "cursor-pointer appearance-none pr-9",
                !value && "text-subtle"
              )}
              id={id}
              onChange={(e) => onChange(e.target.value)}
              value={value}
            >
              <option value="">choose a repo Foundry tracks…</option>
              {options.map((o) => (
                <option key={o.path} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-subtle"
              strokeWidth={1.75}
            />
          </div>
          {picked && picked.value !== picked.path && (
            <p className="mono text-subtle">{picked.path}</p>
          )}
        </>
      ) : (
        <input
          autoFocus={autoFocus}
          className={cn(FIELD_CLASS, "mono", className)}
          id={id}
          onChange={(e) => onChange(e.target.value)}
          placeholder="a repo Foundry tracks — its path, or its name"
          value={value}
        />
      )}
    </>
  );
}

/**
 * Which blueprint the job runs, as the Send form asks it: a select over what
 * `GET /api/blueprints` answered, on top of two choices that are not blueprints — the empty
 * string, Foundry's own default for a ticket (the seeded "Spec → QA"), and "none", the
 * absence of one, one bare step on the forge's default model.
 *
 * The empty choice is where it starts (CTD-284): Foundry maps a ticket-driven job with no
 * `blueprintId` to its own default rather than a bare step, so nobody choosing is nobody
 * choosing, not "none" picked on their behalf. A Foundry that could not answer with a list
 * leaves the field out altogether rather than offering a choice of one: the send still goes,
 * carrying whatever `value` already was.
 */
export function BlueprintField({
  blueprints,
  id,
  onChange,
  value,
}: {
  blueprints: FoundryBlueprint[];
  id: string;
  onChange: (blueprintId: string) => void;
  value: string;
}) {
  if (blueprints.length === 0) {
    return null;
  }
  const picked = blueprints.find((b) => b.id === value);
  return (
    <>
      <label className="kicker" htmlFor={id}>
        How Foundry runs it
      </label>
      <div className="relative">
        <select
          className={cn(
            FIELD_CLASS,
            "mono",
            "cursor-pointer appearance-none pr-9"
          )}
          id={id}
          onChange={(e) => onChange(e.target.value)}
          value={value}
        >
          <option value="">Foundry's default for the ticket</option>
          <option value={NO_BLUEPRINT}>
            none — one step, the forge's default model
          </option>
          {blueprints.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} v{b.version}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-subtle"
          strokeWidth={1.75}
        />
      </div>
      {/* The steps, so which models run — and how many — is visible before pressing Send. */}
      {picked && <p className="mono text-subtle">{picked.summary}</p>}
    </>
  );
}

// ── committing ─────────────────────────────────────────────────────────────────

/** Why a click was refused, in the shape every writer here answers with. */
export interface Refused {
  error: string;
  job?: { id: string; status: string };
  ok: false;
  status?: number;
}

/** What any of the writers answers: the file was written (or was already there), or not. */
export type Outcome = { ok: true } | Refused;

/**
 * The one way a click is committed, wherever it is made: a busy guard so a second click
 * while the first is in flight is the same click, the router invalidated on success so
 * every loader on screen re-reads the ledgers, and the refusal held for display. Shared by
 * the page's controls and by Ask's proposal card, so the two paths cannot drift.
 */
export function useCommit<R extends Outcome>() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Refused | null>(null);

  const commit = async (
    run: () => Promise<R>,
    onDone?: (v: Extract<R, { ok: true }>) => void | Promise<void>
  ) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await run();
      if (v.ok) {
        await router.invalidate();
        await onDone?.(v as Extract<R, { ok: true }>);
      } else {
        setError(v);
      }
    } finally {
      setBusy(false);
    }
  };

  return { busy, commit, error, setError };
}

export function Confirm({
  busy,
  label,
  onCancel,
}: {
  busy: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button disabled={busy} size="sm" type="submit">
        {busy && <LoaderCircle className="animate-spin" />}
        {label}
      </Button>
      <Button
        disabled={busy}
        onClick={onCancel}
        size="sm"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
    </div>
  );
}

/** The refusal, in the shape both the page's controls and Ask's card show it. */
export function CommitError({ v }: { v: Refused | null }) {
  if (!v) {
    return null;
  }
  return (
    <p className="text-sm text-st-hold leading-snug">
      {v.status ? <span className="mono mr-1.5">{v.status}</span> : null}
      {v.error}
      {v.job && (
        <>
          {" "}
          — held by job <span className="mono">{shortId(v.job.id)}</span> (
          {v.job.status})
        </>
      )}
    </p>
  );
}

// ── a job, once one is running ─────────────────────────────────────────────────

const JOB_TONE: Record<string, Tone> = {
  cancelled: "superseded",
  failed: "hold",
  pr_ready: "documented",
  queued: "neutral",
  running: "implemented",
  succeeded: "documented",
};

/** The job's status from Foundry, refreshed every few seconds until it settles. */
export function JobLine({ id, url }: { id: string; url: string }) {
  const q = useQuery({
    queryFn: () => jobStatus({ data: id }),
    queryKey: ["job", id],
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.ok && (d.job.status === "queued" || d.job.status === "running")
        ? 5000
        : false;
    },
  });
  const d = q.data;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-sm">
      <a
        className="inline-flex items-center gap-1 text-primary hover:underline"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        job <span className="mono">{shortId(id)}</span>
        <ArrowUpRight className="size-3" />
      </a>
      {!d && (
        <span className="text-subtle">
          {q.isError ? "status unavailable" : "looking…"}
        </span>
      )}
      {d && !d.ok && (
        <span className="text-st-hold">
          {d.status ? <span className="mono mr-1">{d.status}</span> : null}
          {d.error}
        </span>
      )}
      {d?.ok && (
        <>
          <Tag
            live={d.job.status === "queued" || d.job.status === "running"}
            tone={JOB_TONE[d.job.status] ?? "neutral"}
          >
            {d.job.status}
          </Tag>
          {d.job.step &&
            (d.job.status === "queued" || d.job.status === "running") && (
              <span className="mono text-subtle">{d.job.step}</span>
            )}
          {d.job.prUrl && (
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href={d.job.prUrl}
              rel="noreferrer"
              target="_blank"
            >
              PR <ArrowUpRight className="size-3" />
            </a>
          )}
          {d.job.status === "failed" && d.job.exitCode !== undefined && (
            <span className="mono text-subtle">exit {d.job.exitCode}</span>
          )}
        </>
      )}
    </p>
  );
}
