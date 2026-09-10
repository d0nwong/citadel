/**
 * The two things a reader can do from a workstream page (LIA-162 AC2, AC3), and the one
 * rule both obey: the click writes one file under `decisions/` and nothing else. The next
 * `marauder ingest` reads it back, applies it, and commits — so a row stays where it is
 * until then, wearing the verdict it was given. That is Pensieve's one-writer rule holding.
 *
 * **Send** hands a ticket to Foundry. It is offered on a ticket nobody has started —
 * Linear's Backlog or Todo — that has no `decisions/send/<ticket>.json` yet; the
 * idempotency key is the ticket, so a second click replays the first job rather than
 * queueing another.
 *
 * **Verify** answers what a `directed-at-person` event asked. That is the one thing the
 * loop works out and then refuses to apply on its own — a held edit on a ticket Foundry is
 * running, a fact that may have unsaid a Scope bullet — and the confirmation is what lifts
 * the hold: the next ingest stamps the event, and the ticket pass makes the edit it named.
 */

import { Send as SendIcon, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Tag, TicketLink } from "#/components/bits";
import { Button } from "#/components/ui/button";
import type {
  SendResult,
  VerifyResult,
  WorkstreamAsk,
  WorkstreamTicket,
} from "#/lib/api";
import { sendTicket, verifyEvent } from "#/lib/api";
import { REPO_REQUIRED } from "#/lib/send";
import type { FoundryConfig, FoundryRepo } from "#/server/foundry";
import {
  CommitError,
  Confirm,
  FIELD_CLASS,
  JobLine,
  RepoField,
  useCommit,
  when,
} from "./controls";

// ── send ───────────────────────────────────────────────────────────────────────

function TicketRow({
  foundry,
  repos,
  row,
}: {
  foundry: FoundryConfig;
  repos: FoundryRepo[];
  row: WorkstreamTicket;
}) {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const { busy, commit, error, setError } = useCommit<SendResult>();

  const send = () => {
    if (!repo.trim()) {
      return setError({ error: REPO_REQUIRED, ok: false });
    }
    return commit(
      () => sendTicket({ data: { repo, ticket: row.ticket } }),
      () => setOpen(false)
    );
  };

  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <TicketLink ticket={row.ticket} />
        {row.title && (
          <span className="min-w-0 flex-1 truncate text-foreground text-sm">
            {row.title}
          </span>
        )}
        {row.state && <Tag tone="neutral">{row.state}</Tag>}
        {row.sent ? (
          <Tag tone="implemented">sent</Tag>
        ) : (
          row.sendable &&
          (foundry.configured ? (
            <Button
              aria-pressed={open}
              className="ml-auto"
              onClick={() => {
                setOpen(!open);
                setError(null);
              }}
              size="sm"
              variant={open ? "secondary" : "outline"}
            >
              <SendIcon strokeWidth={1.75} />
              Send to Foundry
            </Button>
          ) : (
            <Button
              className="ml-auto"
              disabled
              size="sm"
              title={foundry.reason}
              variant="outline"
            >
              <SendIcon strokeWidth={1.75} />
              Send to Foundry
              <span className="font-normal text-subtle">
                · {foundry.reason?.split(" — ")[0] ?? "off"}
              </span>
            </Button>
          ))
        )}
      </div>

      {row.sent && (
        <>
          <p className="mt-0.5 text-subtle text-xs">
            sent {when(row.sent.at)} by {row.sent.by}
          </p>
          <JobLine id={row.sent.job.id} url={row.sent.job.url || foundry.url} />
        </>
      )}

      {open && !row.sent && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <RepoField
            autoFocus
            id={`repo-${row.ticket}`}
            onChange={setRepo}
            repos={repos}
            value={repo}
          />
          <p className="text-sm text-subtle leading-snug">
            Foundry composes the brief from{" "}
            <span className="mono">{row.ticket}</span> and claims it in Linear.
            The idempotency key is the ticket, so this cannot queue twice.
          </p>
          <Confirm
            busy={busy}
            label={`Send ${row.ticket}`}
            onCancel={() => setOpen(false)}
          />
          <CommitError v={error} />
        </form>
      )}
    </li>
  );
}

/**
 * The workstream's tickets, with Send beside each one that can take it. A ticket with no
 * state is one Linear could not be asked about — the list is shown, and Send is not
 * offered on a guess.
 */
export function Tickets({
  foundry,
  repos,
  tickets,
}: {
  foundry: FoundryConfig;
  repos: FoundryRepo[];
  tickets: WorkstreamTicket[];
}) {
  if (tickets.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <h2 className="mb-1 border-border border-b pb-1.5 font-semibold text-base">
        Tickets
      </h2>
      <ul className="flex flex-col">
        {tickets.map((row) => (
          <TicketRow
            foundry={foundry}
            key={row.ticket}
            repos={repos}
            row={row}
          />
        ))}
      </ul>
    </section>
  );
}

// ── verify ─────────────────────────────────────────────────────────────────────

function AskRow({ ask }: { ask: WorkstreamAsk }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { busy, commit, error } = useCommit<VerifyResult>();

  // No pre-flight guard: an empty note is a valid confirmation — the event's own text is
  // the instruction, and the note is only anything the edit should also know.
  const verify = () =>
    commit(
      () => verifyEvent({ data: { event: ask.event, note } }),
      () => setOpen(false)
    );

  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 font-medium text-[15px] text-foreground leading-snug">
          {ask.summary}
        </p>
        {ask.ticket && <TicketLink ticket={ask.ticket} />}
        <span className="mono shrink-0 text-subtle text-xs">
          {ask.at.slice(0, 10)}
        </span>
      </div>
      {ask.edit && (
        <p className="mt-1 max-w-[70ch] text-muted-foreground text-sm leading-snug">
          {ask.edit}
        </p>
      )}

      {ask.verified ? (
        <p className="mt-2 flex flex-wrap items-baseline gap-2 text-sm">
          <Tag tone="documented">confirmed</Tag>
          {ask.verified.reason && (
            <span className="text-muted-foreground">{ask.verified.reason}</span>
          )}
          <span className="text-subtle text-xs">
            waiting for the next run to apply it
          </span>
        </p>
      ) : (
        <>
          <div className="mt-2.5">
            <Button
              aria-pressed={open}
              onClick={() => setOpen(!open)}
              size="sm"
              variant={open ? "secondary" : "default"}
            >
              <ShieldCheck strokeWidth={1.75} />
              Verify
            </Button>
          </div>
          {open && (
            <form
              className="mt-3 flex max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <label className="kicker" htmlFor={`note-${ask.event}`}>
                Note (optional)
              </label>
              <textarea
                autoFocus
                className={FIELD_CLASS}
                id={`note-${ask.event}`}
                onChange={(e) => setNote(e.target.value)}
                placeholder="anything the edit should know — the event's own text is the instruction"
                rows={1}
                value={note}
              />
              <p className="text-sm text-subtle leading-snug">
                Confirms what this event asked. The next run stamps it and the
                ticket pass makes the edit it named.
              </p>
              <Confirm
                busy={busy}
                label="Confirm it"
                onCancel={() => setOpen(false)}
              />
              <CommitError v={error} />
            </form>
          )}
        </>
      )}
    </li>
  );
}

/** The events on this workstream that asked the user something and are still unanswered. */
export function Asks({ asks }: { asks: WorkstreamAsk[] }) {
  if (asks.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <h2 className="mb-1 border-border border-b pb-1.5 font-semibold text-base">
        Waiting on you
      </h2>
      <ul className="flex flex-col">
        {asks.map((ask) => (
          <AskRow ask={ask} key={ask.event} />
        ))}
      </ul>
    </section>
  );
}
