/**
 * /arcs/<slug> — one initiative's running story (LIA-149 AC2–AC4). The file's three
 * sections, in the file's order: the sweep's "Where we are" paragraph, the Landed table
 * with every Evidence cell a link into Pensieve, and Open — where the file's rows are
 * replaced by the live points behind them, so the verdict controls are the Points page's
 * and a decision given here writes the same file (`features/points/queue`).
 *
 * The page adds two things the file cannot carry: Close, which writes `decisions/arc/
 * <slug>.json` with `action: "closed"` (LIA-147's `closeArc` — the arc file itself is never
 * touched by this app), and Ask, which opens Argus with the arc as its subject.
 */

import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { CircleCheck, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { Empty, Inline, PageHeader, Tag } from "#/components/bits";
import { Md } from "#/components/md";
import { DocLayout } from "#/components/toc";
import { Button } from "#/components/ui/button";
import { newThreadId } from "#/features/ask";
import { openPointsOf, otherOpenRows } from "#/features/points/arcs";
import { Sections } from "#/features/points/queue";
import { FIELD_CLASS } from "#/features/points/verdict";
import type { CloseArcResult } from "#/lib/api";
import { closeArc, getArc } from "#/lib/api";
import { evidenceOf } from "#/lib/arcs";
import { pointAnchor } from "#/lib/points";
import { prettyDay, prettyStamp } from "#/lib/utils";
import type { ArcLanded } from "#/server/workspace";

export const Route = createFileRoute("/arcs/$slug")({
  staticData: { crumb: "Arcs" },
  loader: async ({ params }) => {
    const page = await getArc({ data: params.slug });
    return { ...page, crumb: page.arc?.meta.title ?? params.slug };
  },
  component: ArcPage,
});

/**
 * The question the conversation opens with. `/ask` in front loads argus's `ask` skill
 * explicitly, whose Arcs section retrieves with `accio arc <slug>` — the same recipe the
 * point's Ask uses for `accio point`.
 */
const arcQuestion = (slug: string, title: string) =>
  `/ask About the arc "${title}" (arcs/${slug}.md): where does it stand, what moved most recently, and what is the next step still open?`;

function ArcPage() {
  const { slug } = Route.useParams();
  const { arc, closed, foundry, points, repos } = Route.useLoaderData();
  const navigate = useNavigate();

  if (!arc) {
    return (
      <>
        <PageHeader title={slug} />
        <Empty title="No arc on file">
          There is no <span className="mono">arcs/{slug}.md</span>. The sweep
          writes an arc's file on the tick after it is opened — until then only{" "}
          <span className="mono">decisions/arc/{slug}.json</span> exists.{" "}
          <Link className="text-primary hover:underline" to="/arcs">
            All arcs
          </Link>
          .
        </Empty>
      </>
    );
  }

  const { meta } = arc;
  const isClosed = meta.status === "closed" || closed !== null;
  const open = openPointsOf(slug, arc.open, points);
  const rest = otherOpenRows(arc.open, open);
  const ask = () =>
    navigate({
      params: { id: newThreadId() },
      search: { arc: slug, from: "arcs", q: arcQuestion(slug, meta.title) },
      to: "/ask/$id",
    });

  return (
    <DocLayout>
      <PageHeader
        actions={
          <>
            <span className="mono text-subtle">{meta.path}</span>
            <Button onClick={ask} size="sm" variant="outline">
              <MessageCircleQuestion strokeWidth={1.75} />
              Ask
            </Button>
            {!isClosed && <CloseArc slug={slug} title={meta.title} />}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {isClosed && (
              <Tag tone="superseded">
                closed{closed?.at ? ` ${prettyStamp(closed.at)}` : ""}
              </Tag>
            )}
            <span>
              {open.length === 0
                ? "nothing open"
                : `${open.length} open point${open.length === 1 ? "" : "s"}`}
            </span>
            {meta.updated && (
              <span className="text-subtle">
                rewritten {prettyDay(meta.updated, { weekday: false })}
              </span>
            )}
          </span>
        }
        title={meta.title}
      />

      <section>
        <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
          Where we are
        </h2>
        {arc.doc.children.length > 0 ? (
          <Md doc={arc.doc} />
        ) : (
          <p className="text-muted-foreground text-sm">
            The sweep writes this paragraph on the tick that opens the arc.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
          Open
        </h2>
        {open.length === 0 && rest.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing is open against this arc. Only you close an arc — an
            initiative with no open step is not necessarily finished.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <Sections foundry={foundry} nested points={open} repos={repos} />
            {rest.length > 0 && (
              <ul className="flex flex-col gap-1.5 text-sm">
                {rest.map((row) => (
                  <li className="text-muted-foreground" key={row.text}>
                    <Inline text={row.text} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 border-border border-b pb-1.5 font-semibold text-base">
          Landed
        </h2>
        {arc.landed.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing has landed against this arc yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {arc.landed.map((row) => (
              <LandedRow key={`${row.when}-${row.evidence}`} row={row} />
            ))}
          </ul>
        )}
      </section>
    </DocLayout>
  );
}

/** One landing: when, what, and the file that says so — as a link wherever Pensieve has a page. */
function LandedRow({ row }: { row: ArcLanded }) {
  const evidence = evidenceOf(row.evidence);
  const label = <span className="mono text-xs">{evidence.path}</span>;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
      <span className="mono shrink-0 text-subtle text-xs">{row.when}</span>
      <span className="min-w-0 flex-1 text-sm leading-snug">
        <Inline text={row.what} />
      </span>
      {evidence.kind === "journal" && (
        <Link
          className="text-primary hover:underline"
          params={{ _splat: evidence.id }}
          to="/journal/$"
        >
          {label}
        </Link>
      )}
      {evidence.kind === "decision" && (
        // Pensieve has no page per decision file; the row on Today is where that verdict
        // is shown, under Decided, for as long as the point is in the tick.
        <Link
          className="text-primary hover:underline"
          hash={pointAnchor(evidence.point)}
          to="/"
        >
          {label}
        </Link>
      )}
      {evidence.kind === "plain" && (
        <span className="text-subtle">{label}</span>
      )}
    </li>
  );
}

/**
 * Close, with the confirmation the verdict deserves: closing is the one thing that sets an
 * arc's `status: closed`, and a decision file is never edited afterwards. What it writes is
 * `decisions/arc/<slug>.json`; the sweep rewrites `arcs/<slug>.md` from it on its next tick,
 * so the page says the verdict is in rather than pretending the file already changed.
 */
function CloseArc({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    let result: CloseArcResult;
    try {
      result = await closeArc({ data: { reason, slug } });
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      setAsking(false);
      await router.invalidate();
    } else {
      setError(result.error);
    }
  };

  if (!asking) {
    return (
      <Button onClick={() => setAsking(true)} size="sm" variant="outline">
        <CircleCheck strokeWidth={1.75} />
        Close
      </Button>
    );
  }
  return (
    <form
      className="flex w-full max-w-[60ch] flex-col gap-2 border-primary/30 border-l-2 pl-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <label className="kicker" htmlFor={`close-${slug}`}>
        Why close “{title}”? (optional)
      </label>
      <textarea
        autoFocus
        className={FIELD_CLASS}
        id={`close-${slug}`}
        onChange={(e) => setReason(e.target.value)}
        placeholder="shipped / folded into … / not happening"
        rows={2}
        value={reason}
      />
      <p className="text-sm text-subtle leading-snug">
        Writes <span className="mono">decisions/arc/{slug}.json</span>. The
        sweep marks the arc closed on its next tick; the file itself is never
        edited from here.
      </p>
      <div className="flex items-center gap-2">
        <Button disabled={busy} size="sm" type="submit">
          Close this arc
        </Button>
        <Button
          disabled={busy}
          onClick={() => setAsking(false)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-st-hold leading-snug">{error}</p>}
    </form>
  );
}
