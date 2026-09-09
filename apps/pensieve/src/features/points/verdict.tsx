/**
 * The verdict on a Needs-you point, as one component each surface renders: the Approve /
 * Send / Dismiss controls while it is open (`VerdictControls`), and what a decided point
 * looks like afterwards (`DecidedLine`). Shared by the home page's queue and the Ask
 * conversation opened on a point, so a verdict given from either lands the same way
 * (LIA-109).
 *
 * The labels are the reader's: Approve writes `action: "verified"` (the user confirming the
 * sweep's inference, which licenses its next tick to make the edit the point names —
 * LIA-114/115), Dismiss writes `action: "ignored"`, Send writes `action: "sent"`. The file
 * shapes and the server's checks are argus's contract and do not change with the words.
 *
 * The repo a Send lands in is a field of its own (`RepoField`), since Ask's proposal card
 * asks for the same thing on a different surface: a select over the repos Foundry answered
 * with for this page load, and the free-text box as the fallback for a Foundry that could
 * not answer with a list (LIA-120).
 *
 * All three write through `decidePoint` / `verifyPoint` / `sendPoint` in `lib/api` —
 * `decisions/` stays the app's only write — and invalidate the router afterwards, so
 * whichever loader is on screen re-reads `points.json` + `decisions/` and the point moves
 * to its decided state. That commit is `useVerdictCommit`, which Ask's proposal card reuses
 * (LIA-111): a verdict confirmed on a card and one given here take the same path and write
 * the same file.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  EyeOff,
  LoaderCircle,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { Tone } from "#/components/bits";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import type { Verdict } from "#/lib/api";
import { decidePoint, jobStatus, sendPoint, verifyPoint } from "#/lib/api";
import { pickRepo, REPO_REQUIRED, repoOptions } from "#/lib/points";
import { cn } from "#/lib/utils";
import type { FoundryRepo } from "#/server/foundry";
import type { Point, PointDecision } from "#/server/workspace";
import { primaryAction } from "./sections";

export const shortId = (id: string) => id.slice(0, 8);

function when(iso: string) {
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

/** One field style for every input the verdict forms and the Ask cards show. */
export const FIELD_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-foreground text-sm placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

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

// ── committing a verdict ───────────────────────────────────────────────────────

/**
 * The one way a verdict is committed, wherever it is given: a busy guard so a second click
 * while the first is in flight is the same click, the router invalidated on success so
 * every loader on screen re-reads `points.json` + `decisions/`, and the refusal held for
 * display. Shared by the controls below and by Ask's proposal card (LIA-111), so the two
 * paths cannot drift.
 */
export function useVerdictCommit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Verdict | null>(null);

  const commit = async (
    run: () => Promise<Verdict>,
    onDecided?: (v: Extract<Verdict, { ok: true }>) => void | Promise<void>
  ) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await run();
      if (v.ok) {
        // The loader re-reads points.json + decisions/, so the point lands in Decided.
        await router.invalidate();
        await onDecided?.(v);
      } else {
        setError(v);
      }
    } finally {
      setBusy(false);
    }
  };

  return { busy, commit, error, setError };
}

// ── an open point ──────────────────────────────────────────────────────────────

type Mode = "idle" | "ignore" | "verify" | "send";

/**
 * Approve (with an optional note, on a Verify-group point only), Send to Foundry (when the
 * point names a ticket and Foundry is configured) and Dismiss (with a reason), with the
 * form each opens. The row leads with the one primary verdict `primaryAction` picks, then
 * Dismiss, then whatever the caller adds in `extra` (the queue's Ask). `onDecided` runs
 * after the verdict landed and the router was invalidated — the caller's chance to close
 * whatever opened these controls.
 */
export function VerdictControls({
  point,
  foundryOk,
  foundryReason,
  extra,
  onDecided,
  repos = [],
}: {
  point: Point;
  foundryOk: boolean;
  foundryReason?: string;
  extra?: ReactNode;
  onDecided?: () => void;
  repos?: FoundryRepo[];
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  // With a list, the point's repo only survives as a choice within it; without one, the
  // field is free text again and the point's own string is the prefill it always was.
  const [repo, setRepo] = useState(
    repos.length > 0 ? pickRepo(repos, point.repo) : (point.repo ?? "")
  );
  const { busy, commit: run, error, setError } = useVerdictCommit();
  const primary = primaryAction(point, foundryOk);

  const open = (m: Mode) => {
    setMode(mode === m ? "idle" : m);
    setError(null);
  };

  const commit = (verdict: () => Promise<Verdict>) =>
    run(verdict, () => {
      setMode("idle");
      onDecided?.();
    });

  const ignore = () => {
    if (!reason.trim()) {
      return setError({
        error: "say why — the reason is what the sweep records",
        ok: false,
      });
    }
    return commit(() => decidePoint({ data: { point: point.id, reason } }));
  };
  // No pre-flight guard: an empty note is a valid confirmation, unlike an empty reason.
  const verify = () =>
    commit(() => verifyPoint({ data: { note, point: point.id } }));
  const send = () => {
    if (!repo.trim()) {
      return setError({ error: REPO_REQUIRED, ok: false });
    }
    return commit(() => sendPoint({ data: { point: point.id, repo } }));
  };

  const variant = (m: Mode, lead: boolean) =>
    mode === m ? "secondary" : lead ? "default" : "outline";

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {point.group === "verify" && (
          <Button
            aria-pressed={mode === "verify"}
            onClick={() => open("verify")}
            size="sm"
            variant={variant("verify", primary === "approve")}
          >
            <BadgeCheck strokeWidth={1.75} />
            Approve
          </Button>
        )}
        {point.ticket &&
          (foundryOk ? (
            <Button
              aria-pressed={mode === "send"}
              onClick={() => open("send")}
              size="sm"
              variant={variant("send", primary === "send")}
            >
              <Send strokeWidth={1.75} />
              Send to Foundry
            </Button>
          ) : (
            <Button disabled size="sm" title={foundryReason} variant="outline">
              <Send strokeWidth={1.75} />
              Send to Foundry
              <span className="font-normal text-subtle">
                · {foundryReason?.split(" — ")[0] ?? "off"}
              </span>
            </Button>
          ))}
        <Button
          aria-pressed={mode === "ignore"}
          onClick={() => open("ignore")}
          size="sm"
          variant={variant("ignore", false)}
        >
          <EyeOff strokeWidth={1.75} />
          Dismiss
        </Button>
        {extra}
      </div>

      {mode === "ignore" && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ignore();
          }}
        >
          <label className="kicker" htmlFor={`reason-${point.id}`}>
            Why dismiss it
          </label>
          <textarea
            autoFocus
            className={FIELD_CLASS}
            id={`reason-${point.id}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="not worth a ticket / already handled in … / decided otherwise on …"
            rows={2}
            value={reason}
          />
          <p className="text-sm text-subtle leading-snug">
            The reason is what the sweep records; the point leaves the report on
            its next tick.
          </p>
          <Confirm
            busy={busy}
            label="Dismiss this point"
            onCancel={() => open("idle")}
          />
          <VerdictError v={error} />
        </form>
      )}

      {mode === "verify" && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="kicker" htmlFor={`note-${point.id}`}>
            Note (optional)
          </label>
          <textarea
            autoFocus
            className={FIELD_CLASS}
            id={`note-${point.id}`}
            onChange={(e) => setNote(e.target.value)}
            placeholder="anything the edit should know — the point's own text is the instruction"
            rows={1}
            value={note}
          />
          <p className="text-sm text-subtle leading-snug">
            Confirms the sweep's reading. Its next tick makes the edit this
            point names and records it against the point id.
          </p>
          <Confirm
            busy={busy}
            label="Approve this point"
            onCancel={() => open("idle")}
          />
          <VerdictError v={error} />
        </form>
      )}

      {mode === "send" && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <RepoField
            autoFocus
            id={`repo-${point.id}`}
            onChange={setRepo}
            repos={repos}
            value={repo}
          />
          <p className="text-sm text-subtle leading-snug">
            Foundry composes the brief from{" "}
            <span className="mono">{point.ticket}</span> and claims it in
            Linear. The idempotency key is the point id, so this cannot queue
            twice.
          </p>
          <Confirm
            busy={busy}
            label={`Send ${point.ticket}`}
            onCancel={() => open("idle")}
          />
          <VerdictError v={error} />
        </form>
      )}
    </>
  );
}

function Confirm({
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

/** Why a verdict was refused, in the shape both the controls and Ask's card show it. */
export function VerdictError({ v }: { v: Verdict | null }) {
  if (!v || v.ok) {
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

// ── a decided point ────────────────────────────────────────────────────────────

/** The file's verb, in the reader's words, with a tone: green for approve, blue for send, grey for dismiss. */
const ACTION_TAG: Record<
  PointDecision["action"],
  { label: string; tone: Tone }
> = {
  ignored: { label: "dismissed", tone: "superseded" },
  sent: { label: "sent", tone: "implemented" },
  verified: { label: "approved", tone: "documented" },
};

/**
 * The verdict on a point that has one: the action, when, why, and — for a sent point — its
 * Foundry job live until it settles. `head` is what the page puts on the first row beside
 * the tag: the subject and ticket, plus whatever else that page offers there.
 */
export function DecidedLine({
  point,
  foundryUrl,
  head,
}: {
  point: Point;
  foundryUrl: string;
  head?: ReactNode;
}) {
  const d = point.decision;
  if (!d) {
    return null;
  }
  const tag = ACTION_TAG[d.action];
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Tag
          className={tag.tone === "superseded" ? "no-underline" : undefined}
          tone={tag.tone}
        >
          {tag.label}
        </Tag>
        {head}
        <span className="ml-auto text-subtle text-xs">{when(d.at)}</span>
      </div>
      {d.reason && (
        <p className="mt-1 text-muted-foreground text-sm leading-normal">
          {d.reason}
        </p>
      )}
      {d.action === "sent" && d.job && (
        <JobLine id={d.job.id} url={d.job.url || `${foundryUrl}/`} />
      )}
    </>
  );
}

/** The job's status from Foundry, refreshed every few seconds until it settles. */
function JobLine({ id, url }: { id: string; url: string }) {
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

const JOB_TONE: Record<string, Tone> = {
  cancelled: "superseded",
  failed: "hold",
  queued: "neutral",
  running: "implemented",
  succeeded: "documented",
};
