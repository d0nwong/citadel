/**
 * /ask/$id — one conversation. The loader brings the stored turns (none for a thread the
 * list page just minted) and whether a credential is available; the page hands both to
 * the bound chat from `#/features/ask` and adds a footer with the thread and Claude session
 * ids. The title is the breadcrumb's last crumb alone; Delete lives in the list's row menu.
 *
 * Reload during an answer behaves like Stop: the request drops, the server kills the
 * claude process, and what was persisted while streaming is what comes back (AC2, AC7).
 * The next question resumes the same session — the id is stored server-side, never sent
 * from here (AC3).
 *
 * Opened from a feature page (`?feature=<dir>`, optionally with `?q=…`): the feature travels
 * with every run of the thread and is stored as the conversation's own (`metadata.feature`),
 * so the session's first retrieval is that feature's story and "it" in a question means
 * that feature (LIA-162 AC4, CTD-167 AC5). A question that arrived in the
 * URL is sent as soon as a credential is known to be available — or left in the composer
 * when it is not — and `q` and `feature` leave the URL once the first answer has landed
 * and the file carries them.
 */

import type { UIMessage } from "@tanstack/ai";
import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AskStatusProvider, useAppChat } from "#/features/ask";
import { FeatureLine } from "#/features/ask/components/feature-line";
import { askStatus, getConversation } from "#/lib/api";

/** a feature is its directory under an app's features/, one level of nesting at most */
const isFeature = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(v);

export const Route = createFileRoute("/ask/$id")({
  staticData: { crumb: "Argus" },
  validateSearch: (
    s: Record<string, unknown>
  ): { feature?: string; q?: string } => ({
    ...(typeof s.q === "string" && s.q.trim() ? { q: s.q } : {}),
    ...(isFeature(s.feature) ? { feature: s.feature } : {}),
  }),
  loader: async ({ params }) => {
    // The server refuses anything that is not a thread id (path-like, too long); that is a 404 here, not a crash.
    const [conversation, status] = await Promise.all([
      getConversation({ data: params.id }).catch(() => undefined),
      askStatus(),
    ]);
    if (conversation === undefined) {
      throw notFound();
    }
    return {
      conversation,
      // `messages` crossed the wire as JSON (see `ConversationWire`); the bytes are UIMessages.
      crumb:
        conversation?.title ??
        (firstQuestion(
          (conversation?.messages ?? []) as unknown as UIMessage[]
        ) ||
          "New conversation"),
      status,
    };
  },
  component: AskConversationPage,
  notFoundComponent: () => (
    <p className="text-muted-foreground">That is not a conversation id.</p>
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
  const { q, feature: urlFeature } = Route.useSearch();
  const { conversation, status } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();

  // The feature rides with every run of a thread opened on one; the server keeps the
  // first it is told and ignores the rest, so a later send cannot re-point the conversation.
  // Hook-level rather than per-send, so the question the composer holds when no credential
  // was available (`draft`) carries it too.
  const feature = conversation?.feature ?? urlFeature;
  const body = useMemo(() => (feature ? { feature } : undefined), [feature]);

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
  // reloaded conversation carries `metadata.feature`, so dropping it from the search
  // cannot pull the line out from under the page. A run that never started — no credential
  // — never reaches here, and the question and its feature stay in the URL.
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
      if (q || urlFeature) {
        await navigate({
          params: { id },
          replace: true,
          search: (prev) => ({ ...prev, feature: undefined, q: undefined }),
          to: "/ask/$id",
        });
      }
    })();
  }, [chat.isLoading, router, navigate, id, q, urlFeature]);

  // A question that arrived with the URL (a feature's Ask) goes out by itself, once. Not on the
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

  const fill = useFillToBottom();

  return (
    <div
      className="flex h-[calc(100dvh-5rem)] min-h-0 flex-col"
      ref={fill.ref}
      style={fill.style}
    >
      <FeatureLine feature={feature} />
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
        className="mono mt-2 truncate text-subtle"
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
