/**
 * The corrections queue — what `marauder ingest` could not attach on its own, with the one
 * click that fixes it (LIA-160 AC3, AC5; over features since ARG-167).
 *
 * A click writes `decisions/marauder/<id>.json` and nothing else. The next `marauder
 * ingest` reads that file, applies it through the correction functions, drops the entry
 * from `queue/_unsorted.json` and commits — so the row stays in the list until then,
 * wearing the verdict it was given. That is the one-writer rule holding: this app writes
 * decision files, the sweep writes the record.
 *
 * The click has to be cheap or the list grows and the guesses stop being corrected, so the
 * select of features is on the row already with the sweep's suggestion chosen, and Attach
 * is one press. Dismiss needs a reason first, so it opens a field and commits on submit.
 * There is no New: a feature is a directory under `features/`, never opened from here.
 */

import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, EyeOff } from "lucide-react";
import { useState } from "react";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import type { UnsortedPage, UnsortedVerdict } from "#/lib/api";
import { decideUnsorted } from "#/lib/api";
import type { MarauderDecision } from "#/lib/marauder";
import { cn } from "#/lib/utils";
import type { UnsortedItem } from "#/server/marauder";

/** One field style for every input here — the verdict forms' (`features/points/verdict`). */
const FIELD_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-foreground text-sm placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

/** What the row calls the thing it came from, and where that thing is. */
function Source({ item }: { item: UnsortedItem }) {
  const label =
    item.source?.type === "pr"
      ? item.source.ref.startsWith("be")
        ? "the backend PR"
        : "the frontend PR"
      : item.source?.type === "huddle"
        ? "the huddle notes"
        : item.source?.type === "slack"
          ? "the message"
          : item.source?.ref;
  if (!(item.source && label)) {
    return null;
  }
  return item.source.url ? (
    <a
      className="text-primary hover:underline"
      href={item.source.url}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  ) : (
    <span className="mono text-subtle">{label}</span>
  );
}

/** What a decided row shows instead of its controls — the file that is now on disk. */
function Decided({
  decision,
  names,
}: {
  decision: MarauderDecision;
  names: Map<string, string>;
}) {
  const word =
    decision.action === "attach"
      ? `attached to ${names.get(decision.feature ?? "") ?? decision.feature}`
      : decision.action;
  return (
    <div className="mt-2.5 flex flex-wrap items-baseline gap-2 text-sm">
      <Tag tone="decided">{word}</Tag>
      {decision.reason && (
        <span className="text-muted-foreground">{decision.reason}</span>
      )}
      <span className="text-subtle text-xs">
        waiting for the next run to apply it
      </span>
    </div>
  );
}

function Row({
  item,
  decision,
  features,
  names,
}: {
  decision?: MarauderDecision;
  features: UnsortedPage["features"];
  item: UnsortedItem;
  names: Map<string, string>;
}) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState(false);
  // The sweep's suggestion is preselected only when it names a feature that exists.
  const [feature, setFeature] = useState(
    item.suggest && names.has(item.suggest) ? item.suggest : ""
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (
    draft: Parameters<typeof decideUnsorted>[0]["data"]
  ) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v: UnsortedVerdict = await decideUnsorted({ data: draft });
      if (v.ok) {
        setDismissing(false);
        // The loader re-reads `_unsorted.json` + `decisions/marauder/`, so the row lands
        // in its decided state whether this click wrote the file or found it already there.
        await router.invalidate();
      } else {
        setError(v.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-border border-b py-5 last:border-b-0">
      <p className="font-medium text-[15px] text-foreground leading-snug">
        {item.summary}
      </p>

      {item.why && (
        <p className="mt-1 text-muted-foreground text-sm leading-snug">
          {item.why}
        </p>
      )}

      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs">
        <Source item={item} />
        <span className="mono text-subtle">{item.at.slice(0, 10)}</span>
        {item.candidates.length > 0 && (
          <span className="text-subtle">
            could be{" "}
            {item.candidates
              .map((c) => names.get(c.feature) ?? c.feature)
              .join(", ")}
          </span>
        )}
      </p>

      {decision ? (
        <Decided decision={decision} names={names} />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                aria-label="Feature to attach it to"
                className={cn(
                  FIELD_CLASS,
                  "w-auto cursor-pointer appearance-none pr-9",
                  !feature && "text-subtle"
                )}
                onChange={(e) => setFeature(e.target.value)}
                value={feature}
              >
                <option value="">choose a feature…</option>
                {features.map((f) => (
                  <option key={f.feature} value={f.feature}>
                    {f.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-subtle"
                strokeWidth={1.75}
              />
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                feature
                  ? commit({ action: "attach", feature, id: item.id })
                  : setError("choose the feature it belongs to")
              }
              size="sm"
            >
              Attach
            </Button>
            <Button
              aria-pressed={dismissing}
              onClick={() => {
                setDismissing(!dismissing);
                setError(null);
              }}
              size="sm"
              variant={dismissing ? "secondary" : "outline"}
            >
              <EyeOff strokeWidth={1.75} />
              Dismiss
            </Button>
          </div>

          {dismissing && (
            <form
              className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
              onSubmit={(e) => {
                e.preventDefault();
                void commit({ action: "dismiss", id: item.id, reason });
              }}
            >
              <label className="kicker" htmlFor={`reason-${item.id}`}>
                Why it goes nowhere
              </label>
              <textarea
                autoFocus
                className={FIELD_CLASS}
                id={`reason-${item.id}`}
                onChange={(e) => setReason(e.target.value)}
                placeholder="chat / already on … / answered in the thread"
                rows={2}
                value={reason}
              />
              <p className="text-sm text-subtle leading-snug">
                The reason is all a later reader has for why this is not on a
                feature.
              </p>
              <div>
                <Button disabled={busy} size="sm" type="submit">
                  Dismiss it
                </Button>
              </div>
            </form>
          )}

          {error && (
            <p className="mt-2 text-destructive text-sm leading-snug">
              {error}
            </p>
          )}
        </>
      )}
    </li>
  );
}

export function UnsortedQueue({ page }: { page: UnsortedPage }) {
  const decided = new Map(page.decided);
  const names = new Map(page.features.map((f) => [f.feature, f.name]));
  return (
    <ul className="flex flex-col">
      {page.items.map((item) => (
        <Row
          decision={decided.get(item.id)}
          features={page.features}
          item={item}
          key={item.id}
          names={names}
        />
      ))}
    </ul>
  );
}

/** The line under the heading: what is left to do, and where the rest of it went. */
export function UnsortedSummary({ page }: { page: UnsortedPage }) {
  const decided = new Map(page.decided);
  const left = page.items.filter((i) => !decided.has(i.id)).length;
  const done = page.items.length - left;
  return (
    <>
      {left === 0
        ? "Nothing left to sort"
        : `${left} ${left === 1 ? "entry" : "entries"} to sort`}
      {done > 0 && ` · ${done} decided, waiting for the next run`}
      {page.features.length === 0 && (
        <>
          {" · "}
          <Link className="text-primary hover:underline" to="/">
            no features to attach to yet
          </Link>
        </>
      )}
    </>
  );
}
