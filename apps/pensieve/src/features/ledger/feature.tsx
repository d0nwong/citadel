/**
 * One feature's page, in the order a founder would ask: the five questions, then the
 * requirements by status, the asks with their history, the tickets with their blockers,
 * the proposals waiting to be filed, and the landings. Confirm and Contradict on a
 * requirement and Close on an ask each run one argus verb; the reload is the record's.
 */

import {
  ArrowRightLeft,
  Check,
  FilePlus2,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useState } from "react";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import {
  CommitError,
  Confirm,
  FIELD_CLASS,
  useCommit,
} from "#/features/work/controls";
import type { FileProposalResult, LedgerWrite, MoveWrite } from "#/lib/api";
import {
  closeAsk,
  confirmAll,
  confirmRequirement,
  dropAsk,
  fileAsk,
  fileProposal,
  moveAsk,
} from "#/lib/api";
import {
  type Ask,
  isOpen,
  type Landing,
  type Ledger,
  type Proposal,
  type Requirement,
  type StoryText,
  type Ticket,
  ticketDone,
} from "#/lib/ledger";
import { EvidenceLine, Status } from "./bits";

const QUESTIONS: { key: keyof Ledger["story"]; label: string }[] = [
  { key: "health", label: "Is it going well?" },
  { key: "gaps", label: "Do the two codebases agree?" },
  { key: "requirements", label: "Does the code do what was asked?" },
  { key: "architecture", label: "Is the architecture sound?" },
];

function Answer({ label, text }: { label: string; text: StoryText }) {
  return (
    <div className="py-3">
      <p className="kicker">{label}</p>
      <p className="mt-1 text-[16px] text-foreground leading-relaxed">
        {text.text || (
          <span className="text-muted-foreground">Nothing written yet.</span>
        )}
      </p>
      <EvidenceLine evidence={text.evidence} />
    </div>
  );
}

export function Story({ ledger, dir }: { ledger: Ledger; dir: string }) {
  const mine = ledger.asks.filter((a) => isOpen(a) && a.to === "you");
  return (
    <section className="divide-y divide-border border-border border-l-2 pl-4">
      {QUESTIONS.slice(0, 3).map((q) => (
        <Answer key={q.key} label={q.label} text={ledger.story[q.key]} />
      ))}
      <div className="py-3">
        <p className="kicker">What is on you?</p>
        {mine.length === 0 ? (
          <p className="mt-1 text-[16px] text-foreground leading-relaxed">
            Nothing. Every ask aimed at you is closed.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-2">
            {mine.map((a) => (
              <li key={a.id}>
                <p className="text-[16px] text-foreground leading-relaxed">
                  {a.text}
                </p>
                <p className="text-muted-foreground text-xs">
                  <Status status={a.status} /> {a.by}, {a.at}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Answer label={QUESTIONS[3].label} text={ledger.story.architecture} />
      <p className="py-2 text-muted-foreground text-xs">
        As of {ledger.as_of.slice(0, 16).replace("T", " ")} ·{" "}
        <span className="mono">{dir}</span>
      </p>
    </section>
  );
}

function RequirementRow({ req, dir }: { req: Requirement; dir: string }) {
  const [mode, setMode] = useState<"confirm" | "contradict" | null>(null);
  const [reason, setReason] = useState("");
  const { busy, commit, error } = useCommit<LedgerWrite>();
  const go = () =>
    commit(
      () =>
        confirmRequirement({
          data: {
            contradict: mode === "contradict",
            dir,
            reason,
            requirement: req.id,
          },
        }),
      () => setMode(null)
    );
  return (
    <li className="border-border border-b py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="mono text-muted-foreground text-xs">{req.id}</span>
        <Status status={req.status} />
        {req.by && (
          <span className="text-muted-foreground text-xs">
            {req.by}
            {req.at ? `, ${req.at}` : ""}
          </span>
        )}
        {req.status !== "retired" && !mode && (
          <span className="ml-auto flex gap-1">
            {req.status !== "confirmed" && (
              <Button
                onClick={() => setMode("confirm")}
                size="xs"
                type="button"
                variant="ghost"
              >
                <ThumbsUp />
                Confirm
              </Button>
            )}
            {req.status !== "contradicted" && (
              <Button
                onClick={() => setMode("contradict")}
                size="xs"
                type="button"
                variant="ghost"
              >
                <ThumbsDown />
                Contradict
              </Button>
            )}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[15px] text-foreground leading-relaxed">
        {req.text}
      </p>
      <EvidenceLine evidence={req.evidence} />
      {mode && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <input
            autoFocus
            className={FIELD_CLASS}
            id={`req-${dir}-${req.id}`}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === "confirm"
                ? "Who confirmed it, or how you know"
                : "Who said otherwise, and what"
            }
            value={reason}
          />
          <Confirm
            busy={busy}
            label={mode === "confirm" ? "Confirm" : "Contradict"}
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

function Group({
  title,
  rows,
  dir,
  open,
  action,
}: {
  title: string;
  rows: Requirement[];
  dir: string;
  open?: boolean;
  action?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <details className="group" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm">
        <Status status={rows[0].status} />
        <span className="text-muted-foreground">
          {rows.length} {title}
        </span>
        {action && <span className="ml-auto">{action}</span>}
      </summary>
      <ul>
        {rows.map((r) => (
          <RequirementRow dir={dir} key={r.id} req={r} />
        ))}
      </ul>
    </details>
  );
}

function ConfirmAllButton({ dir, count }: { dir: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, commit, error } = useCommit<LedgerWrite>();
  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="xs"
        type="button"
        variant="outline"
      >
        <Check />
        Confirm all {count}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        commit(
          () => confirmAll({ data: { dir, reason } }),
          () => setOpen(false)
        );
      }}
    >
      <input
        autoFocus
        className={FIELD_CLASS}
        id={`confirm-all-${dir}`}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why they all hold"
        value={reason}
      />
      <Confirm
        busy={busy}
        label="Confirm all"
        onCancel={() => setOpen(false)}
      />
      <CommitError
        v={error?.ok === false ? { error: error.error, ok: false } : null}
      />
    </form>
  );
}

export function Requirements({ ledger, dir }: { ledger: Ledger; dir: string }) {
  const by = (s: Requirement["status"]) =>
    ledger.requirements.filter((r) => r.status === s);
  const assumed = by("assumed");
  return (
    <section>
      <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
        Requirements{" "}
        <span className="font-normal text-muted-foreground">
          {ledger.requirements.length}
        </span>
      </h2>
      <Group dir={dir} open rows={by("contradicted")} title="contradicted" />
      <Group dir={dir} open rows={by("confirmed")} title="confirmed" />
      <Group
        action={
          assumed.length > 0 && (
            <ConfirmAllButton count={assumed.length} dir={dir} />
          )
        }
        dir={dir}
        rows={assumed}
        title="assumed, nobody has confirmed them"
      />
      <Group dir={dir} rows={by("retired")} title="retired" />
    </section>
  );
}

function MoveForm({
  ask,
  dir,
  features,
  onDone,
}: {
  ask: Ask;
  dir: string;
  features: string[];
  onDone: () => void;
}) {
  const [to, setTo] = useState("");
  const move = useCommit<MoveWrite>();
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        move.commit(() => moveAsk({ data: { ask: ask.id, dir, to } }), onDone);
      }}
    >
      <select
        className={FIELD_CLASS}
        id={`move-${dir}-${ask.id}`}
        onChange={(e) => setTo(e.target.value)}
        value={to}
      >
        <option value="">Which feature?</option>
        {features
          .filter((f) => f !== dir)
          .map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
      </select>
      <Confirm busy={move.busy} label="Move it" onCancel={onDone} />
      <CommitError
        v={
          move.error?.ok === false
            ? { error: move.error.error, ok: false }
            : null
        }
      />
    </form>
  );
}

type AskMode = "close" | "drop" | "move";

/** the buttons on an open ask: Ticket files it, Done and Ignore settle it, Move re-homes it */
function AskActions({
  ask,
  dir,
  features,
  filed,
  onFiled,
  setMode,
}: {
  ask: Ask;
  dir: string;
  features: string[];
  filed: boolean;
  onFiled: (v: { key: string; url: string }) => void;
  setMode: (m: AskMode) => void;
}) {
  const ticket = useCommit<FileProposalResult>();
  return (
    <span className="ml-auto flex flex-col items-end gap-1">
      <span className="flex gap-1">
        {!filed && (
          <Button
            disabled={ticket.busy}
            onClick={() =>
              ticket.commit(
                () => fileAsk({ data: { ask: ask.id, dir } }),
                (v) => onFiled({ key: v.key, url: v.url })
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
        {features.length > 0 && (
          <Button
            onClick={() => setMode("move")}
            size="xs"
            type="button"
            variant="ghost"
          >
            <ArrowRightLeft />
            Move
          </Button>
        )}
      </span>
      <CommitError
        v={
          ticket.error?.ok === false
            ? { error: ticket.error.error, ok: false }
            : null
        }
      />
    </span>
  );
}

function AskRow({
  ask,
  dir,
  features = [],
}: {
  ask: Ask;
  dir: string;
  features?: string[];
}) {
  const [mode, setMode] = useState<AskMode | null>(null);
  const [reason, setReason] = useState("");
  const { busy, commit, error } = useCommit<LedgerWrite>();
  const [filed, setFiled] = useState<{ key: string; url: string } | null>(null);
  const settle = () =>
    commit(
      () =>
        mode === "drop"
          ? dropAsk({ data: { ask: ask.id, dir, reason } })
          : closeAsk({ data: { ask: ask.id, dir, reason } }),
      () => setMode(null)
    );
  const key = ask.ticket ?? filed?.key;
  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="mono text-muted-foreground text-xs">{ask.id}</span>
        <Status status={ask.status} />
        <span className="text-muted-foreground text-xs">
          {ask.by}
          {ask.to ? ` → ${ask.to}` : ""} · {ask.at}
        </span>
        {key &&
          (filed?.url ? (
            <a
              className="mono text-xs underline decoration-1 underline-offset-2"
              href={filed.url}
              rel="noreferrer"
              target="_blank"
            >
              {key}
            </a>
          ) : (
            <span className="mono text-xs">{key}</span>
          ))}
        {ask.blockers?.length ? (
          <Tag tone={ask.ready ? "documented" : "decided"}>
            {ask.ready ? "unblocked" : "waiting"}
          </Tag>
        ) : null}
        {isOpen(ask) && !mode && (
          <AskActions
            ask={ask}
            dir={dir}
            features={features}
            filed={Boolean(key)}
            onFiled={setFiled}
            setMode={setMode}
          />
        )}
      </div>
      <p className="mt-0.5 text-[15px] text-foreground leading-relaxed">
        {ask.text}
      </p>
      {mode === "move" && (
        <MoveForm
          ask={ask}
          dir={dir}
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
      {ask.blockers && ask.blockers.length > 0 && (
        <ul className="mt-1 ml-3 border-border border-l pl-3 text-xs">
          {ask.blockers.map((b, i) => (
            <li
              className={
                b.cleared
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              }
              key={i.toString()}
            >
              {b.kind === "landing" &&
                `${b.ref || "a PR"} on ${b.branch}${b.deployed ? ", deployed" : ", not deployed"}`}
              {b.kind === "answer" && `${b.from}: ${b.question}`}
              {b.kind === "ticket" && `after ${b.key}`}
            </li>
          ))}
        </ul>
      )}
      {ask.history.length > 0 && (
        <ol className="mt-1 ml-3 flex flex-col gap-0.5 border-border border-l pl-3 text-xs">
          {ask.history.map((h, i) => (
            <li key={`${h.at}-${h.status}-${i.toString()}`}>
              <span className="mono text-muted-foreground">{h.at}</span>{" "}
              {h.status}
              <EvidenceLine evidence={h.evidence} />
            </li>
          ))}
        </ol>
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
            id={`${mode}-${dir}-${ask.id}`}
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

export function Asks({
  ledger,
  dir,
  features = [],
}: {
  ledger: Ledger;
  dir: string;
  features?: string[];
}) {
  const open = ledger.asks.filter(isOpen);
  const done = ledger.asks.filter((a) => !isOpen(a));
  return (
    <section>
      <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
        Asks{" "}
        <span className="font-normal text-muted-foreground">
          {open.length} open
        </span>
      </h2>
      {open.length === 0 && (
        <p className="py-2 text-muted-foreground text-sm">Nothing open.</p>
      )}
      <ul>
        {open.map((a) => (
          <AskRow ask={a} dir={dir} features={features} key={a.id} />
        ))}
      </ul>
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 text-muted-foreground text-sm">
            {done.length} closed or dropped
          </summary>
          <ul>
            {done.map((a) => (
              <AskRow ask={a} dir={dir} key={a.id} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** done once its asks are settled, sent once Foundry has it, else ready or blocked */
function TicketState({
  ledger,
  ticket: t,
}: {
  ledger: Ledger;
  ticket: Ticket;
}) {
  if (t.sent?.length) {
    return <Tag tone="implemented">sent</Tag>;
  }
  if (ticketDone(ledger, t)) {
    return <Tag tone="superseded">done</Tag>;
  }
  return (
    <Tag tone={t.ready ? "documented" : "decided"}>
      {t.ready ? "ready" : "blocked"}
    </Tag>
  );
}

export function Tickets({
  tickets,
  ledger,
}: {
  tickets: Ticket[];
  ledger: Ledger;
}) {
  if (tickets.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
        Tickets
      </h2>
      <ul>
        {tickets.map((t) => (
          <li
            className="border-border border-b py-2.5 last:border-b-0"
            key={t.key}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-sm">{t.key}</span>
              <span className="text-foreground text-sm">{t.title}</span>
              <TicketState ledger={ledger} ticket={t} />
            </div>
            {t.blockers.length > 0 && (
              <ul className="mt-1 ml-3 border-border border-l pl-3 text-xs">
                {t.blockers.map((b, i) => (
                  <li
                    className={
                      b.cleared
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }
                    key={i.toString()}
                  >
                    {b.kind === "landing" &&
                      `${b.ref} on ${b.branch}${b.deployed ? ", deployed" : ", not deployed"}`}
                    {b.kind === "answer" && `${b.from}: ${b.question}`}
                    {b.kind === "ticket" && `after ${b.key}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FileButton({ dir, proposal }: { dir: string; proposal: string }) {
  const { busy, commit, error } = useCommit<FileProposalResult>();
  const [filed, setFiled] = useState<{ key: string; url: string } | null>(null);
  if (filed) {
    return (
      <a
        className="mono ml-auto text-xs underline decoration-1 underline-offset-2"
        href={filed.url}
        rel="noreferrer"
        target="_blank"
      >
        {filed.key}
      </a>
    );
  }
  return (
    <span className="ml-auto flex flex-col items-end gap-1">
      <Button
        disabled={busy}
        onClick={() =>
          commit(
            () => fileProposal({ data: { dir, proposal } }),
            (v) => setFiled({ key: v.key, url: v.url })
          )
        }
        size="xs"
        type="button"
        variant="outline"
      >
        {busy ? "Filing" : "File"}
      </Button>
      <CommitError
        v={error?.ok === false ? { error: error.error, ok: false } : null}
      />
    </span>
  );
}

export function Proposals({
  proposals,
  dir,
}: {
  proposals: Proposal[];
  dir: string;
}) {
  if (proposals.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
        Proposed tickets{" "}
        <span className="font-normal text-muted-foreground">
          {proposals.length}
        </span>
      </h2>
      <ul>
        {proposals.map((p) => (
          <li
            className="border-border border-b py-2.5 last:border-b-0"
            key={p.id}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-muted-foreground text-xs">{p.id}</span>
              <span className="text-foreground text-sm">{p.title}</span>
              <span className="text-muted-foreground text-xs">
                {p.at}
                {p.asks.length ? ` · serves ${p.asks.join(", ")}` : ""}
              </span>
              <FileButton dir={dir} proposal={p.id} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Landings({ landings }: { landings: Landing[] }) {
  if (landings.length === 0) {
    return null;
  }
  const rows = [...landings].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section>
      <h2 className="mb-1 border-border border-b pb-1 font-semibold text-[15px]">
        Landings{" "}
        <span className="font-normal text-muted-foreground">{rows.length}</span>
      </h2>
      <ul>
        {rows.map((l) => (
          <li
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-border border-b py-2 text-sm last:border-b-0"
            key={l.ref}
          >
            <span className="mono text-muted-foreground text-xs">
              {l.at.slice(0, 10)}
            </span>
            {l.url ? (
              <a
                className="mono text-xs underline decoration-1 underline-offset-2"
                href={l.url}
                rel="noreferrer"
                target="_blank"
              >
                {l.ref}
              </a>
            ) : (
              <span className="mono text-xs">{l.ref}</span>
            )}
            <span className="min-w-0 flex-1 text-foreground">{l.title}</span>
            <span className="text-muted-foreground text-xs">
              {l.by}
              {l.asks.length ? ` · served ${l.asks.join(", ")}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
