/**
 * One feature's page, in the order a founder would ask: the five questions, then the
 * requirements by status, the asks with their history, the tickets with their blockers,
 * the proposals waiting to be filed, and the landings. Confirm and Contradict on a
 * requirement and Close on an ask each run one argus verb; the reload is the record's.
 */

import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Tag } from "#/components/bits";
import { Button } from "#/components/ui/button";
import {
  CommitError,
  Confirm,
  FIELD_CLASS,
  useCommit,
} from "#/features/work/controls";
import type { LedgerWrite } from "#/lib/api";
import { closeAsk, confirmAll, confirmRequirement } from "#/lib/api";
import {
  type Ask,
  isOpen,
  type Landing,
  type Ledger,
  type Proposal,
  type Requirement,
  type StoryText,
  type Ticket,
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

function AskRow({ ask, dir }: { ask: Ask; dir: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, commit, error } = useCommit<LedgerWrite>();
  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="mono text-muted-foreground text-xs">{ask.id}</span>
        <Status status={ask.status} />
        <span className="text-muted-foreground text-xs">
          {ask.by}
          {ask.to ? ` → ${ask.to}` : ""} · {ask.at}
        </span>
        {ask.ticket && <span className="mono text-xs">{ask.ticket}</span>}
        {ask.blockers?.length ? (
          <Tag tone={ask.ready ? "documented" : "decided"}>
            {ask.ready ? "unblocked" : "waiting"}
          </Tag>
        ) : null}
        {isOpen(ask) && !open && (
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
      <p className="mt-0.5 text-[15px] text-foreground leading-relaxed">
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
      {open && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            commit(
              () => closeAsk({ data: { ask: ask.id, dir, reason } }),
              () => setOpen(false)
            );
          }}
        >
          <input
            autoFocus
            className={FIELD_CLASS}
            id={`close-${dir}-${ask.id}`}
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

export function Asks({ ledger, dir }: { ledger: Ledger; dir: string }) {
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
          <AskRow ask={a} dir={dir} key={a.id} />
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

export function Tickets({ tickets }: { tickets: Ticket[] }) {
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
              <Tag tone={t.ready ? "documented" : "decided"}>
                {t.ready ? "ready" : "blocked"}
              </Tag>
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

export function Proposals({ proposals }: { proposals: Proposal[] }) {
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
              <Button
                className="ml-auto"
                disabled
                size="xs"
                title="File comes with the tickets phase"
                type="button"
                variant="outline"
              >
                File
              </Button>
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
