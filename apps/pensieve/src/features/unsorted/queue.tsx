/**
 * The corrections queue — what `marauder ingest` could not attach on its own, with the one
 * click that fixes it (LIA-160 AC3, AC5).
 *
 * A click writes `decisions/marauder/<id>.json` and nothing else. The next `marauder
 * ingest` reads that file, applies it through the correction functions, drops the entry
 * from `workstreams/_unsorted.json` and commits — so the row stays in the list until then,
 * wearing the verdict it was given. That is the one-writer rule holding: this app writes
 * decision files, the sweep writes the record.
 *
 * The click has to be cheap or the list grows and the guesses stop being corrected, so the
 * select of workstreams is on the row already with the model's suggestion chosen, and
 * Attach is one press. New and Dismiss each need a word first — a name, and a reason —
 * so they open a field and commit on submit.
 *
 * A `split` proposal is not an entry that can attach anywhere: it proposes cutting one
 * workstream in two. It shows its groups and the command that would apply it, and offers
 * only Dismiss, until splitting from here is common enough to deserve buttons.
 */

import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, EyeOff, GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import type { UnsortedPage, UnsortedVerdict } from "#/lib/api";
import { decideUnsorted } from "#/lib/api";
import type { MarauderDecision } from "#/lib/marauder";
import { decisionSlug } from "#/lib/marauder";
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
function Decided({ decision }: { decision: MarauderDecision }) {
  const word =
    decision.action === "attach"
      ? `attached to ${decision.slug}`
      : decision.action === "new"
        ? `opening “${decision.name}”`
        : decision.action === "stage"
          ? `${decision.side} set to ${decision.stage}`
          : "dismissed";
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

/**
 * The command a reader would run to apply this split. The first group keeps the workstream
 * it came from, so there is one `split` per group after it.
 */
function splitCommands(item: UnsortedItem): string[] {
  const groups = item.groups ?? [];
  return groups.slice(1).map((g) => {
    const events = g.events.join(",");
    return `marauder split ${item.slug} --into ${decisionSlug(g.name)} --name "${g.name}"${events ? ` --events ${events}` : ""}`;
  });
}

type Mode = "dismiss" | "idle" | "new";

function Row({
  item,
  decision,
  open,
}: {
  decision?: MarauderDecision;
  item: UnsortedItem;
  open: UnsortedPage["open"];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [slug, setSlug] = useState(item.suggest ?? "");
  const [name, setName] = useState(item.name ?? item.summary);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSplit = item.kind === "split";

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
        setMode("idle");
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

  const toggle = (m: Mode) => {
    setMode(mode === m ? "idle" : m);
    setError(null);
  };

  return (
    <li className="border-border border-b py-5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {isSplit && (
          <Tag tone="hold">
            <GitBranch className="size-3" strokeWidth={2} />
            split
          </Tag>
        )}
        <p className="font-medium text-[15px] text-foreground leading-snug">
          {item.summary}
        </p>
      </div>

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
            could be {item.candidates.map((c) => c.slug).join(", ")}
          </span>
        )}
      </p>

      {isSplit && item.groups && (
        <div className="mt-3 max-w-[60ch] rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <ul className="flex flex-col gap-1 text-sm">
            {item.groups.map((g) => (
              <li key={g.name}>
                <span className="font-medium text-foreground">{g.name}</span>
                {g.events.length > 0 && (
                  <span className="mono ml-2 text-subtle text-xs">
                    {g.events.join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {splitCommands(item).length > 0 && (
            <pre className="mono mt-2.5 overflow-x-auto text-subtle text-xs leading-relaxed">
              {splitCommands(item).join("\n")}
            </pre>
          )}
        </div>
      )}

      {decision ? (
        <Decided decision={decision} />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isSplit && (
              <>
                <div className="relative">
                  <select
                    aria-label="Workstream to attach it to"
                    className={cn(
                      FIELD_CLASS,
                      "w-auto cursor-pointer appearance-none pr-9",
                      !slug && "text-subtle"
                    )}
                    onChange={(e) => setSlug(e.target.value)}
                    value={slug}
                  >
                    <option value="">choose a workstream…</option>
                    {open.map((w) => (
                      <option key={w.slug} value={w.slug}>
                        {w.name}
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
                    slug
                      ? commit({ action: "attach", id: item.id, slug })
                      : setError("choose the workstream it belongs to")
                  }
                  size="sm"
                >
                  Attach
                </Button>
                <Button
                  aria-pressed={mode === "new"}
                  onClick={() => toggle("new")}
                  size="sm"
                  variant={mode === "new" ? "secondary" : "outline"}
                >
                  <Plus strokeWidth={1.75} />
                  New workstream
                </Button>
              </>
            )}
            <Button
              aria-pressed={mode === "dismiss"}
              onClick={() => toggle("dismiss")}
              size="sm"
              variant={mode === "dismiss" ? "secondary" : "outline"}
            >
              <EyeOff strokeWidth={1.75} />
              Dismiss
            </Button>
          </div>

          {mode === "new" && (
            <form
              className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
              onSubmit={(e) => {
                e.preventDefault();
                void commit({ action: "new", id: item.id, name });
              }}
            >
              <label className="kicker" htmlFor={`name-${item.id}`}>
                What to call it
              </label>
              <input
                className={FIELD_CLASS}
                id={`name-${item.id}`}
                onChange={(e) => setName(e.target.value)}
                value={name}
              />
              <p className="text-sm text-subtle leading-snug">
                It opens as{" "}
                <span className="mono">{decisionSlug(name) || "…"}</span>, with
                this entry as its first event.
              </p>
              <div>
                <Button disabled={busy} size="sm" type="submit">
                  Open it
                </Button>
              </div>
            </form>
          )}

          {mode === "dismiss" && (
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
                workstream.
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
  return (
    <ul className="flex flex-col">
      {page.items.map((item) => (
        <Row
          decision={decided.get(item.id)}
          item={item}
          key={item.id}
          open={page.open}
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
      {page.open.length === 0 && (
        <>
          {" · "}
          <Link className="text-primary hover:underline" to="/">
            no workstreams to attach to yet
          </Link>
        </>
      )}
    </>
  );
}
