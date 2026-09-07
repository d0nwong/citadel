/**
 * The verdict on a Needs-you point, as one component each page renders: the Ignore / Verify
 * / Send controls while it is open (`VerdictControls`), and what a decided point looks like
 * afterwards (`DecidedLine`). Lifted out of `/points` so the Ask conversation opened on a
 * point can give the same verdict without going back to the list (LIA-109).
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
  EyeOff,
  LoaderCircle,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { Verdict } from "#/lib/api";
import { decidePoint, jobStatus, sendPoint, verifyPoint } from "#/lib/api";
import { cn } from "#/lib/utils";
import type { Point, PointDecision } from "#/server/workspace";

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
 * Ignore (with a reason), Verify (with an optional note, on a Verify-group point only) and
 * Send to Foundry (when the point names a ticket and Foundry is configured), with the form
 * each opens. `lead` goes first in the action row, so a page with its own action there (the
 * Points list's Ask) keeps one row of actions rather than two. `onDecided` runs after the
 * verdict landed and the router was invalidated — the caller's chance to close whatever
 * opened these controls.
 */
export function VerdictControls({
  point,
  foundryOk,
  foundryReason,
  lead,
  onDecided,
}: {
  point: Point;
  foundryOk: boolean;
  foundryReason?: string;
  lead?: ReactNode;
  onDecided?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [repo, setRepo] = useState(point.repo ?? "");
  const { busy, commit: run, error, setError } = useVerdictCommit();

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
      return setError({
        error: "which repo? Foundry needs a tracked path or name",
        ok: false,
      });
    }
    return commit(() => sendPoint({ data: { point: point.id, repo } }));
  };

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        {lead}
        <ActionButton
          active={mode === "ignore"}
          icon={EyeOff}
          onClick={() => open("ignore")}
        >
          Ignore
        </ActionButton>
        {point.group === "verify" && (
          <ActionButton
            active={mode === "verify"}
            icon={BadgeCheck}
            onClick={() => open("verify")}
          >
            Verify
          </ActionButton>
        )}
        {point.ticket &&
          (foundryOk ? (
            <ActionButton
              active={mode === "send"}
              icon={Send}
              onClick={() => open("send")}
            >
              Send to Foundry
            </ActionButton>
          ) : (
            <span
              className="inline-flex cursor-not-allowed items-center gap-1.5 text-ink-faint text-sm"
              title={foundryReason}
            >
              <Send className="size-3.5" strokeWidth={1.75} />
              Send to Foundry
              <span className="italic">
                — {foundryReason?.split(" — ")[0] ?? "off"}
              </span>
            </span>
          ))}
      </div>

      {mode === "ignore" && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-thread-soft border-l-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ignore();
          }}
        >
          <label className="kicker" htmlFor={`reason-${point.id}`}>
            Why ignore it
          </label>
          <textarea
            autoFocus
            className="w-full rounded-md border border-rule bg-paper-2/60 px-3 py-1.5 text-ink text-sm placeholder:text-ink-faint focus:border-thread focus:outline-none"
            id={`reason-${point.id}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="not worth a ticket / already handled in … / decided otherwise on …"
            rows={2}
            value={reason}
          />
          <Confirm
            busy={busy}
            label="Ignore this point"
            onCancel={() => open("idle")}
          />
          <VerdictError v={error} />
        </form>
      )}

      {mode === "verify" && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-thread-soft border-l-2 pl-3"
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
            className="w-full rounded-md border border-rule bg-paper-2/60 px-3 py-1.5 text-ink text-sm placeholder:text-ink-faint focus:border-thread focus:outline-none"
            id={`note-${point.id}`}
            onChange={(e) => setNote(e.target.value)}
            placeholder="anything the edit should know — the point's own text is the instruction"
            rows={1}
            value={note}
          />
          <p className="text-ink-faint text-sm leading-snug">
            Confirms the sweep's reading. Its next tick makes the edit this
            point names and records it against the point id.
          </p>
          <Confirm
            busy={busy}
            label="Verify this point"
            onCancel={() => open("idle")}
          />
          <VerdictError v={error} />
        </form>
      )}

      {mode === "send" && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-thread-soft border-l-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="kicker" htmlFor={`repo-${point.id}`}>
            Repo the work lands in
          </label>
          <input
            autoFocus
            className="mono w-full rounded-md border border-rule bg-paper-2/60 px-3 py-1.5 text-ink placeholder:text-ink-faint focus:border-thread focus:outline-none"
            id={`repo-${point.id}`}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="a repo Foundry tracks — its path, or its name"
            value={repo}
          />
          <p className="text-ink-faint text-sm leading-snug">
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

export function ActionButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Send;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 text-sm transition-colors",
        active
          ? "text-ink underline underline-offset-4"
          : "text-thread hover:underline"
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {children}
    </button>
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
    <div className="flex items-center gap-3">
      <button
        className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-paper text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        disabled={busy}
        type="submit"
      >
        {busy && <LoaderCircle className="size-3.5 animate-spin" />}
        {label}
      </button>
      <button
        className="text-ink-faint text-sm hover:text-ink disabled:opacity-50"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        cancel
      </button>
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

/** One row per verdict — green for a confirmation, blue for a send, grey for a dismissal. */
const ACTION_CLASS: Record<PointDecision["action"], string> = {
  ignored: "border-st-superseded/40 text-st-superseded",
  sent: "border-st-implemented/40 text-st-implemented",
  verified: "border-st-documented/40 text-st-documented",
};

/**
 * The verdict on a point that has one: the action, when, why, and — for a sent point — its
 * Foundry job live until it settles. `head` is what the page puts on the first row beside
 * the pill: the subject and ticket, plus whatever else that page offers there.
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
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]",
            ACTION_CLASS[d.action]
          )}
        >
          {d.action}
        </span>
        {head}
        <span className="mono ml-auto text-ink-faint">{when(d.at)}</span>
      </div>
      {d.reason && (
        <p className="mt-1 text-ink-dim text-sm italic leading-snug">
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
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-dim text-sm">
      <a
        className="inline-flex items-center gap-1 text-thread hover:underline"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        job <span className="mono">{shortId(id)}</span>
        <ArrowUpRight className="size-3" />
      </a>
      {!d && (
        <span className="text-ink-faint">
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
          <JobStatusPill
            live={d.job.status === "queued" || d.job.status === "running"}
            status={d.job.status}
          />
          {d.job.step &&
            (d.job.status === "queued" || d.job.status === "running") && (
              <span className="mono text-ink-faint">{d.job.step}</span>
            )}
          {d.job.prUrl && (
            <a
              className="inline-flex items-center gap-1 text-thread hover:underline"
              href={d.job.prUrl}
              rel="noreferrer"
              target="_blank"
            >
              PR <ArrowUpRight className="size-3" />
            </a>
          )}
          {d.job.status === "failed" && d.job.exitCode !== undefined && (
            <span className="mono text-ink-faint">exit {d.job.exitCode}</span>
          )}
        </>
      )}
    </p>
  );
}

const JOB_CLASS: Record<string, string> = {
  cancelled: "text-st-superseded border-st-superseded/40",
  failed: "text-st-hold border-st-hold/40",
  queued: "text-ink-faint border-rule",
  running: "text-st-implemented border-st-implemented/40",
  succeeded: "text-st-documented border-st-documented/40",
};

function JobStatusPill({ status, live }: { status: string; live: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]",
        JOB_CLASS[status] ?? "border-rule text-ink-dim"
      )}
    >
      {live && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </span>
  );
}
