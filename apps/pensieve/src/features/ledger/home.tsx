/**
 * The three lists on the home page, and the two clicks two of them offer. Done closes an
 * ask with a reason; Place puts an unplaced message on a feature. Each click runs one
 * argus verb through the server and re-reads every loader on success, so the row leaves
 * because the record changed, not because the page pretended.
 */

import {
  ArrowRightLeft,
  Check,
  FilePlus2,
  Send as SendIcon,
  X,
} from "lucide-react";
import { useState } from "react";
import { Empty, Tag, TicketLink } from "#/components/bits";
import { Button } from "#/components/ui/button";
import {
  CommitError,
  Confirm,
  FIELD_CLASS,
  JobLine,
  RepoField,
  useCommit,
} from "#/features/work/controls";
import type {
  DismissWrite,
  FileProposalResult,
  LedgerWrite,
  PlaceWrite,
  SendReadyResult,
} from "#/lib/api";
import {
  closeAsk,
  dismissUnplaced,
  dropAsk,
  fileAsk,
  placeUnplaced,
  sendReady,
} from "#/lib/api";
import type { Unplaced } from "#/lib/ledger";
import type { FoundryRepo } from "#/server/foundry";
import type { HomeAsk, HomeFiledTicket, HomeTicket } from "#/server/ledger";
import { FeatureName, Status } from "./bits";
import { MoveForm } from "./feature";

function AskRow({ ask, features }: { ask: HomeAsk; features: string[] }) {
  const [mode, setMode] = useState<"close" | "drop" | "move" | null>(null);
  const [reason, setReason] = useState("");
  const { busy, commit, error } = useCommit<LedgerWrite>();
  const ticket = useCommit<FileProposalResult>();
  const [filed, setFiled] = useState<{ key: string; url: string } | null>(null);
  const settle = () =>
    commit(
      () =>
        mode === "drop"
          ? dropAsk({ data: { ask: ask.id, dir: ask.dir, reason } })
          : closeAsk({ data: { ask: ask.id, dir: ask.dir, reason } }),
      () => setMode(null)
    );
  const key = ask.ticket ?? filed?.key;
  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Status status={ask.status} />
        <span className="text-muted-foreground text-xs">
          {ask.by}, {ask.at}
        </span>
        <FeatureName dir={ask.dir} feature={ask.feature} />
        {key && (
          <span className="ml-auto">
            <TicketLink ticket={key} url={filed?.url} />
          </span>
        )}
      </div>
      <p className="mt-1 text-[15px] text-foreground leading-relaxed">
        {ask.text}
      </p>
      {mode === "move" && (
        <MoveForm
          ask={ask}
          dir={ask.dir}
          features={features}
          onDone={() => setMode(null)}
        />
      )}
      {ask.origin.kind !== "ticket" && (
        <a
          className="text-muted-foreground text-xs underline decoration-1 underline-offset-2 hover:text-foreground"
          href={ask.origin.url}
          rel="noreferrer"
          target="_blank"
        >
          the thread
        </a>
      )}
      <CommitError
        v={
          ticket.error?.ok === false
            ? { error: ticket.error.error, ok: false }
            : null
        }
      />
      {!mode && (
        <div className="mt-2 flex flex-wrap gap-1">
          {!key && (
            <Button
              disabled={ticket.busy}
              onClick={() =>
                ticket.commit(
                  () => fileAsk({ data: { ask: ask.id, dir: ask.dir } }),
                  (v) => setFiled({ key: v.key, url: v.url })
                )
              }
              size="xs"
              type="button"
              variant="outline"
            >
              <FilePlus2 />
              {ticket.busy ? "Filing" : "Ticket"}
            </Button>
          )}
          <Button
            onClick={() => setMode("close")}
            size="xs"
            type="button"
            variant="outline"
          >
            <Check />
            Done
          </Button>
          <Button
            onClick={() => setMode("drop")}
            size="xs"
            type="button"
            variant="ghost"
          >
            <X />
            Ignore
          </Button>
          <Button
            onClick={() => setMode("move")}
            size="xs"
            type="button"
            variant="ghost"
          >
            <ArrowRightLeft />
            Move
          </Button>
        </div>
      )}
      {(mode === "close" || mode === "drop") && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            settle();
          }}
        >
          <input
            autoFocus
            className={FIELD_CLASS}
            id={`${mode}-${ask.feature}-${ask.id}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === "drop"
                ? "Why it is not an ask, in a few words"
                : "How it got done, in a few words"
            }
            value={reason}
          />
          <Confirm
            busy={busy}
            label={mode === "drop" ? "Ignore it" : "Close it"}
            onCancel={() => setMode(null)}
          />
          <CommitError
            v={error?.ok === false ? { error: error.error, ok: false } : null}
          />
        </form>
      )}
    </li>
  );
}

export function NeedsMe({
  asks,
  features,
}: {
  asks: HomeAsk[];
  features: string[];
}) {
  if (asks.length === 0) {
    return (
      <Empty title="Nothing on you">
        Every ask aimed at you is closed. When someone asks for something in the
        channel, it appears here on the next run.
      </Empty>
    );
  }
  return (
    <ul>
      {asks.map((a) => (
        <AskRow ask={a} features={features} key={`${a.feature}/${a.id}`} />
      ))}
    </ul>
  );
}

export function Ready({
  tickets,
  asks,
  filed = [],
  send,
}: {
  tickets: HomeTicket[];
  asks: HomeAsk[];
  /** filed from Ask with no ledger: no Send, since Send records on a ledger */
  filed?: HomeFiledTicket[];
  send: SendOptions;
}) {
  if (tickets.length === 0 && asks.length === 0 && filed.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing is waiting on a landing or an answer that has since arrived.
      </p>
    );
  }
  return (
    <ul>
      {asks.map((a) => (
        <li
          className="flex flex-col gap-0.5 border-border border-b py-3 last:border-b-0"
          key={`${a.feature}/${a.id}`}
        >
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Tag tone="documented">unblocked</Tag>
            <span className="text-muted-foreground text-xs">
              {a.by}, {a.at}
            </span>
            <FeatureName dir={a.dir} feature={a.feature} />
          </span>
          <p className="mt-1 text-[15px] text-foreground leading-relaxed">
            {a.text}
          </p>
          {a.blockers?.map((b, i) => (
            <span className="text-muted-foreground text-xs" key={i.toString()}>
              {b.kind === "landing" &&
                `${b.ref} is on ${b.branch} and deployed`}
              {b.kind === "answer" && `${b.from} answered`}
              {b.kind === "ticket" && `${b.key} is done`}
            </span>
          ))}
        </li>
      ))}
      {tickets.map((t) => (
        <TicketRow key={`${t.feature}/${t.key}`} row={t} send={send} />
      ))}
      {filed.map((t) => (
        <li
          className="border-border border-b py-3 last:border-b-0"
          key={t.identifier}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Tag tone="documented">ready</Tag>
            <a
              className="text-muted-foreground text-xs hover:underline"
              href={`/ask/${t.threadId}`}
            >
              filed from Ask
            </a>
            <span className="ml-auto">
              <TicketLink ticket={t.identifier} url={t.url} />
            </span>
          </div>
          <p className="mt-1 text-[15px] text-foreground leading-relaxed">
            {t.title ?? t.identifier}
          </p>
        </li>
      ))}
    </ul>
  );
}

export interface SendOptions {
  configured: boolean;
  reason?: string;
  repos: FoundryRepo[];
}

function TicketRow({ row, send }: { row: HomeTicket; send: SendOptions }) {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const { busy, commit, error } = useCommit<SendReadyResult>();
  const [job, setJob] = useState<{ id: string; url: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sent = row.sent?.at(-1);
  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {sent || job ? (
          <Tag tone="implemented">sent</Tag>
        ) : (
          <Tag tone="documented">ready</Tag>
        )}
        <FeatureName dir={row.dir} feature={row.feature} />
        <span className="ml-auto">
          <TicketLink ticket={row.key} url={row.url} />
        </span>
      </div>
      <p className="mt-1 text-[15px] text-foreground leading-relaxed">
        {row.title}
      </p>
      {job && <JobLine id={job.id} url={job.url} />}
      {note && <p className="mt-1 text-st-hold text-xs">{note}</p>}
      {!(sent || job || open) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {send.configured ? (
            <Button
              onClick={() => setOpen(true)}
              size="xs"
              type="button"
              variant="outline"
            >
              <SendIcon />
              Send
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs" title={send.reason}>
              Foundry is off
            </span>
          )}
        </div>
      )}
      {open && !job && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            commit(
              () =>
                sendReady({ data: { dir: row.dir, repo, ticket: row.key } }),
              (v) => {
                setJob(v.job);
                setNote(v.note ?? null);
                setOpen(false);
              }
            );
          }}
        >
          <RepoField
            id={`send-repo-${row.feature}-${row.key}`}
            onChange={setRepo}
            repos={send.repos}
            value={repo}
          />
          <p className="text-muted-foreground text-xs">
            Foundry composes the brief from {row.key} and claims it in Linear.
            The idempotency key is the ticket, so this cannot queue twice.
          </p>
          <Confirm
            busy={busy}
            label="Send to Foundry"
            onCancel={() => setOpen(false)}
          />
          <CommitError
            v={error?.ok === false ? { error: error.error, ok: false } : null}
          />
        </form>
      )}
    </li>
  );
}

function UnplacedRow({
  item,
  features,
}: {
  item: Unplaced;
  features: string[];
}) {
  const [dir, setDir] = useState("");
  const { busy, commit, error } = useCommit<PlaceWrite>();
  const nothing = useCommit<DismissWrite>();
  const place = () =>
    commit(() => placeUnplaced({ data: { dir, id: item.id } }));
  const options = [...new Set([...item.candidates, ...features])];
  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <Tag tone="neutral">{item.kind}</Tag>
        <span>
          {item.by}, {item.at}
        </span>
        {item.thread && <span>reply in a thread</span>}
        {item.url && (
          <a
            className="underline decoration-1 underline-offset-2 hover:text-foreground"
            href={item.url}
            rel="noreferrer"
            target="_blank"
          >
            open
          </a>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[15px] text-foreground leading-relaxed">
        {item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text}
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          place();
        }}
      >
        <select
          className={FIELD_CLASS}
          id={`place-${item.id}`}
          onChange={(e) => setDir(e.target.value)}
          value={dir}
        >
          <option value="">Which feature?</option>
          {options.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <Button disabled={busy || !dir} size="sm" type="submit">
          Place
        </Button>
        <Button
          disabled={nothing.busy}
          onClick={() =>
            nothing.commit(() => dismissUnplaced({ data: { id: item.id } }))
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <X />
          Nothing
        </Button>
        <CommitError
          v={
            nothing.error?.ok === false
              ? { error: nothing.error.error, ok: false }
              : null
          }
        />
        <CommitError
          v={error?.ok === false ? { error: error.error, ok: false } : null}
        />
      </form>
    </li>
  );
}

export function UnplacedList({
  items,
  features,
}: {
  items: Unplaced[];
  features: string[];
}) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Everything found its feature.
      </p>
    );
  }
  return (
    <ul>
      {items.map((u) => (
        <UnplacedRow features={features} item={u} key={u.id} />
      ))}
    </ul>
  );
}
