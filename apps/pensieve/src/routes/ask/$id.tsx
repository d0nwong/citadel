/**
 * /ask/$id — one conversation. The loader brings the stored turns (none for a thread the
 * list page just minted) and whether a credential is available; the page hands both to
 * the bound chat from `#/features/ask` and adds the title, Delete, and a footer with the
 * thread and Claude session ids.
 *
 * Reload during an answer behaves like Stop: the request drops, the server kills the
 * claude process, and what was persisted while streaming is what comes back (AC2, AC7).
 * The next question resumes the same session — the id is stored server-side, never sent
 * from here (AC3).
 *
 * Opened from a point (`?q=…&from=points&point=<id>`): the question is sent as soon as a
 * credential is known to be available — or left in the composer when it is not — and the
 * kicker is a breadcrumb back to the points. The point itself travels with the run and is
 * stored as the conversation's own (`metadata.point`), so the card above the transcript
 * survives a reload; `q` and `point` leave the URL once the first answer has landed and
 * the file carries them (LIA-109).
 */

import type { UIMessage } from "@tanstack/ai";
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { ArrowLeftIcon, Trash2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { AskStatusProvider, useAppChat } from "#/features/ask";
import { PointCard } from "#/features/ask/components/point-card";
import {
  askStatus,
  deleteConversation,
  getConversation,
  getPoint,
} from "#/lib/api";
import { isPointId } from "#/lib/points";

type From = "points";

export const Route = createFileRoute("/ask/$id")({
  validateSearch: (
    s: Record<string, unknown>
  ): { q?: string; from?: From; point?: string } => ({
    ...(typeof s.q === "string" && s.q.trim() ? { q: s.q } : {}),
    ...(s.from === "points" ? { from: "points" as const } : {}),
    ...(isPointId(s.point) ? { point: s.point } : {}),
  }),
  loaderDeps: ({ search }) => ({ point: search.point }),
  loader: async ({ params, deps }) => {
    // The server refuses anything that is not a thread id (path-like, too long); that is a 404 here, not a crash.
    const [conversation, status] = await Promise.all([
      getConversation({ data: params.id }).catch(() => undefined),
      askStatus(),
    ]);
    if (conversation === undefined) {
      throw notFound();
    }
    // The stored point wins: it is what this thread was opened on, whatever the URL says.
    const pointId = conversation?.point ?? deps.point;
    const point = pointId ? await getPoint({ data: pointId }) : null;
    return { conversation, point, status };
  },
  component: AskConversationPage,
  notFoundComponent: () => (
    <p className="text-ink-dim">That is not a conversation id.</p>
  ),
});

/**
 * The page fills the viewport from wherever it starts down to the bottom padding of
 * `<main>`, so the conversation scrolls and the composer stays on screen. Measured rather
 * than subtracted: above `lg` the shell's nav sits on top and its height is not a constant.
 * Until measured (and on the server) a lg-sized guess applies.
 */
function useFillToBottom() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<string>();
  useLayoutEffect(() => {
    const el = ref.current;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Biome types the ref from its `null` initialiser; it is set once mounted
    if (!el) {
      return;
    }
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bottom =
        Number.parseFloat(
          getComputedStyle(el.parentElement ?? el).paddingBottom
        ) || 0;
      setHeight(
        `calc(100dvh - ${Math.round(top)}px - ${Math.round(bottom)}px)`
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, style: height ? { height } : undefined };
}

/** The first user turn, one line — the same title the list shows. */
const firstQuestion = (messages: UIMessage[]): string =>
  (messages.find((m) => m.role === "user")?.parts ?? [])
    .flatMap((p) => (p.type === "text" ? [p.content] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

function AskConversationPage() {
  const { id } = Route.useParams();
  const { q, from, point: urlPoint } = Route.useSearch();
  const { conversation, point, status } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  // The point rides with every run of a thread opened on one; the server keeps the first
  // it is told and ignores the rest, so a later send cannot re-point the conversation.
  // Hook-level rather than per-send, so the question the composer holds when no credential
  // was available (`draft`) carries it too.
  const pointId = conversation?.point ?? urlPoint;
  const body = useMemo(
    () => (pointId ? { point: pointId } : undefined),
    [pointId]
  );

  // `messages` crossed the wire as JSON (see `ConversationWire`); the bytes are UIMessages.
  const chat = useAppChat({
    body,
    threadId: id,
    initialMessages: (conversation?.messages ?? []) as unknown as UIMessage[],
  });

  // When an answer finishes, re-run the loader: the footer learns the session id and the
  // list / Inbox counts are fresh on the way back. The chat itself is keyed on the thread
  // id, so new loader data never resets it.
  //
  // Then the URL sheds what it was seeded with. Only after the invalidate: by then the
  // reloaded conversation carries `metadata.point`, so dropping `point` from the search
  // cannot pull the card out from under the page. A run that never started — no credential
  // — never reaches here, and the question and its point stay in the URL.
  const wasLoading = useRef<boolean>(false);
  useEffect(() => {
    const wasLoadingBefore = wasLoading.current;
    wasLoading.current = chat.isLoading;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Biome types the ref from its `false` initialiser and misses the assignment above
    if (!(wasLoadingBefore && !chat.isLoading)) {
      return;
    }
    void (async () => {
      await router.invalidate();
      if (q || urlPoint) {
        await navigate({
          params: { id },
          replace: true,
          search: (prev) => ({ ...prev, point: undefined, q: undefined }),
          to: "/ask/$id",
        });
      }
    })();
  }, [chat.isLoading, router, navigate, id, q, urlPoint]);

  // A question that arrived with the URL (a point's Ask) goes out by itself, once. Not on the
  // first effect pass: after a client-side navigation React commits this tree, something below
  // suspends, and the effects are cleaned up and re-run on the same instance — `useChat`'s
  // cleanup detaches the client and aborts whatever it was sending. A short timer that the
  // cleanup cancels means the send happens only once the tree has settled. A reload cannot
  // send it twice: the stored turns hydrate `messages`, and the guard sees them. Without a
  // credential the question waits in the composer instead.
  const seeded = useRef(false);
  useEffect(() => {
    if (
      !q ||
      seeded.current ||
      !status.available ||
      chat.isLoading ||
      chat.messages.length > 0
    ) {
      return;
    }
    const t = setTimeout(() => {
      seeded.current = true;
      void chat.sendMessage(q);
    }, 50);
    return () => clearTimeout(t);
  }, [q, status.available, chat]);

  const remove = async () => {
    if (
      // biome-ignore lint/suspicious/noAlert: a native confirm is the intended guard for delete
      !window.confirm(
        "Delete this conversation? Its file under PENSIEVE_HOME is removed."
      )
    ) {
      return;
    }
    setDeleting(true);
    if (chat.isLoading) {
      chat.stop();
    }
    try {
      await deleteConversation({ data: id });
    } finally {
      setDeleting(false);
    }
    await router.invalidate();
    await navigate({ to: "/ask" });
  };

  const title =
    firstQuestion(chat.messages as UIMessage[]) || "New conversation";
  const fill = useFillToBottom();

  return (
    <div
      className="flex h-[calc(100dvh-5rem)] min-h-0 flex-col"
      ref={fill.ref}
      style={fill.style}
    >
      {/* On a phone the header is one row — back, the question on one line, a delete icon — so the
          conversation keeps the screen; from `sm` up it is the page title with its breadcrumb. */}
      <header className="rise mb-3 flex items-center gap-2 border-rule border-b pb-2 sm:mb-8 sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-6 sm:gap-y-2 sm:pb-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:block">
          <p className="kicker shrink-0 sm:mb-2">
            {from === "points" ? (
              <span className="inline-flex items-center gap-1.5">
                <Link
                  className="inline-flex items-center gap-1 hover:text-thread"
                  to="/points"
                >
                  <ArrowLeftIcon className="size-3" />{" "}
                  <span className="hidden sm:inline">Points</span>
                </Link>
                <span aria-hidden className="hidden sm:inline">
                  ›
                </span>
                <Link className="hidden hover:text-thread sm:inline" to="/ask">
                  Argus
                </Link>
              </span>
            ) : (
              <Link
                className="inline-flex items-center gap-1 hover:text-thread"
                to="/ask"
              >
                <ArrowLeftIcon className="size-3" />{" "}
                <span className="hidden sm:inline">Argus</span>
              </Link>
            )}
          </p>
          <h1 className="display min-w-0 truncate text-[17px] leading-tight sm:line-clamp-2 sm:whitespace-normal sm:text-[28px]">
            {title}
          </h1>
        </div>
        <Button
          className="shrink-0 text-ink-dim hover:text-st-hold"
          disabled={deleting}
          onClick={remove}
          size="sm"
          title="Delete"
          variant="ghost"
        >
          <Trash2Icon />
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </header>
      <PointCard page={point} />
      <AskStatusProvider
        draft={q && !status.available ? q : undefined}
        finishReason={conversation?.finishReason}
        lastError={conversation?.lastError}
        status={status}
        threadId={id}
      >
        <chat.AppChat />
      </AskStatusProvider>
      <p
        className="mono mt-2 truncate text-ink-faint"
        title={
          conversation?.sessionId
            ? `session ${conversation.sessionId}`
            : undefined
        }
      >
        thread {id}
        {conversation?.sessionId && <> · session {conversation.sessionId}</>}
      </p>
    </div>
  );
}
