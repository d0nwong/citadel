/**
 * The three lists on the home page, and the two clicks two of them offer. Done closes an
 * ask with a reason; Place puts an unplaced message on a feature. Each click runs one
 * argus verb through the server and re-reads every loader on success, so the row leaves
 * because the record changed, not because the page pretended.
 */

import { Check, Send as SendIcon } from "lucide-react";
import { useState } from "react";
import { Empty, Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import {
  CommitError,
  Confirm,
  FIELD_CLASS,
  useCommit,
} from "#/features/work/controls";
import type { LedgerWrite, PlaceWrite } from "#/lib/api";
import { closeAsk, placeUnplaced } from "#/lib/api";
import type { Unplaced } from "#/lib/ledger";
import type { HomeAsk, HomeTicket } from "#/server/ledger";
import { FeatureName, Status } from "./bits";

function AskRow({ ask }: { ask: HomeAsk }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, commit, error } = useCommit<LedgerWrite>();
  const done = () =>
    commit(
      () => closeAsk({ data: { ask: ask.id, dir: ask.dir, reason } }),
      () => setOpen(false)
    );
  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Status status={ask.status} />
        <span className="text-muted-foreground text-xs">
          {ask.by}, {ask.at}
        </span>
        <FeatureName dir={ask.dir} feature={ask.feature} />
        {!open && (
          <Button
            className="ml-auto"
            onClick={() => setOpen(true)}
            size="xs"
            type="button"
            variant="outline"
          >
            <Check />
            Done
          </Button>
        )}
      </div>
      <p className="mt-1 text-[15px] text-foreground leading-relaxed">
        {ask.text}
      </p>
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
      {open && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            done();
          }}
        >
          <input
            autoFocus
            className={FIELD_CLASS}
            id={`done-${ask.feature}-${ask.id}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="How it got done, in a few words"
            value={reason}
          />
          <Confirm
            busy={busy}
            label="Close it"
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

export function NeedsMe({ asks }: { asks: HomeAsk[] }) {
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
        <AskRow ask={a} key={`${a.feature}/${a.id}`} />
      ))}
    </ul>
  );
}

export function Ready({
  tickets,
  asks,
}: {
  tickets: HomeTicket[];
  asks: HomeAsk[];
}) {
  if (tickets.length === 0 && asks.length === 0) {
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
          <span className="text-[15px] text-foreground leading-relaxed">
            {a.text}
          </span>
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
        <li
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-border border-b py-3 last:border-b-0"
          key={`${t.feature}/${t.key}`}
        >
          <span className="mono text-sm">{t.key}</span>
          <span className="min-w-0 flex-1 text-foreground text-sm">
            {t.title}
          </span>
          <FeatureName dir={t.dir} feature={t.feature} />
          {t.sent?.length ? (
            <Tag tone="implemented">sent</Tag>
          ) : (
            <Button
              disabled
              size="xs"
              title="Send comes with the tickets phase"
              type="button"
              variant="outline"
            >
              <SendIcon />
              Send
            </Button>
          )}
        </li>
      ))}
    </ul>
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
