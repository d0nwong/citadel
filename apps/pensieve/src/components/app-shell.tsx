import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BookOpenText,
  FileText,
  Inbox,
  MenuIcon,
  MessageCircleQuestion,
  MessagesSquare,
  ScrollText,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "#/components/theme";
import { cn } from "#/lib/utils";

// ── pull to refresh ────────────────────────────────────────────────────────────
//
// The blackboard changes under the app (the sweep writes a report, a digest lands), and
// every page reads it in its route loader. Dragging the page down from the top — a touch
// or a mouse — past the threshold re-runs the loaders (`router.invalidate()`), the same
// as a reload without losing the scroll position or the shell. Off on the chat page: its
// conversation has its own scroll container and a run in flight.

const PULL_THRESHOLD = 72;
const PULL_MAX = 110;
/** Finger travel is damped so a long drag reads as resistance, not as the page leaving. */
const damp = (dy: number) => Math.min(PULL_MAX, dy * 0.45);

function PullToRefresh({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const setPullBoth = useCallback((v: number) => {
    pullRef.current = v;
    setPull(v);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPullBoth(PULL_THRESHOLD * 0.6);
    try {
      await router.invalidate();
    } finally {
      setRefreshing(false);
      setPullBoth(0);
    }
  }, [router, setPullBoth]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const atTop = () => window.scrollY <= 0;
    const begin = (y: number) => {
      if (!atTop() || refreshing) {
        return;
      }
      startY.current = y;
    };
    const move = (y: number, ev: Event) => {
      if (startY.current === null) {
        return;
      }
      const dy = y - startY.current;
      if (dy <= 0 || !atTop()) {
        if (pullRef.current !== 0) {
          setPullBoth(0);
        }
        return;
      }
      // We own the gesture from here: no text selection, no native overscroll.
      if (ev.cancelable) {
        ev.preventDefault();
      }
      setPullBoth(damp(dy));
    };
    const end = () => {
      if (startY.current === null) {
        return;
      }
      startY.current = null;
      if (pullRef.current >= PULL_THRESHOLD) {
        void refresh();
      } else {
        setPullBoth(0);
      }
    };
    const onTouchStart = (e: TouchEvent) => begin(e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientY, e);
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      begin(e.clientY);
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientY, e);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", end);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", end);
    };
  }, [enabled, refreshing, refresh, setPullBoth]);

  // The browser's own pull-to-refresh (Android Chrome) would fire alongside ours.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const prev = document.documentElement.style.overscrollBehaviorY;
    document.documentElement.style.overscrollBehaviorY = "contain";
    return () => {
      document.documentElement.style.overscrollBehaviorY = prev;
    };
  }, [enabled]);

  const armed = pull >= PULL_THRESHOLD;
  const label = refreshing
    ? "Refreshing…"
    : armed
      ? "Release to refresh"
      : "Pull to refresh";
  const visible = enabled && (pull > 0 || refreshing);
  return (
    <div className="relative min-w-0 flex-1">
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex justify-center transition-opacity duration-150",
          visible ? "opacity-100" : "opacity-0"
        )}
        style={{ transform: `translateY(${Math.max(0, pull - 40)}px)` }}
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 font-medium text-muted-foreground text-xs shadow-sm">
          <Basin
            className={cn(
              "size-3.5 text-primary transition-transform",
              refreshing && "animate-spin",
              armed && !refreshing && "rotate-180"
            )}
          />
          {label}
        </span>
      </div>
      <div
        className={cn(
          startY.current === null &&
            "transition-transform duration-200 ease-out"
        )}
        style={{ transform: pull > 0 ? `translateY(${pull}px)` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}

const NAV = [
  { icon: Inbox, label: "Today", to: "/" },
  { icon: FileText, label: "Reports", to: "/reports" },
  { icon: ScrollText, label: "Journal", to: "/journal" },
  { icon: MessagesSquare, label: "Digests", to: "/digests" },
  { icon: BookOpenText, label: "Docs", to: "/docs" },
  { icon: MessageCircleQuestion, label: "Argus", to: "/ask" },
] as const;

function Basin({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 28 28">
      <circle
        cx="14"
        cy="15"
        fill="none"
        r="9"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 15c3-3 9-3 12 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
      <path
        d="M14 3v6"
        opacity=".55"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/** The chat detail page (`/ask/<id>`) keeps its own scroll and may have a run in flight. */
const isChatDetail = (pathname: string) => /^\/ask\/[^/]+\/?$/.test(pathname);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Below `lg` the sidebar is a drawer behind a menu button; it closes on navigation and Escape.
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not an input
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const wordmark = (
    <Link
      className="flex items-center gap-2 font-semibold text-[15px] text-foreground"
      to="/"
    >
      <Basin className="size-6 text-primary" />
      Pensieve
    </Link>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="flex items-center justify-between border-border border-b px-4 py-2.5 lg:hidden">
        {wordmark}
        <button
          aria-controls="app-nav"
          aria-expanded={open}
          aria-label="Open navigation"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(true)}
          type="button"
        >
          <MenuIcon className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-foreground/30 lg:hidden"
          onClick={() => setOpen(false)}
          type="button"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col border-border border-r bg-background shadow-xl transition-transform duration-200 ease-out",
          "lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[240px] lg:translate-x-0 lg:bg-muted/40 lg:shadow-none lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        id="app-nav"
      >
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          {wordmark}
          <button
            aria-label="Close navigation"
            className="rounded-md p-1 text-subtle hover:text-foreground lg:hidden"
            onClick={() => setOpen(false)}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <nav className="flex flex-col gap-px px-2.5">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
                key={to}
                to={to}
              >
                <Icon
                  className={cn(
                    "size-4",
                    active ? "text-foreground" : "text-subtle"
                  )}
                  strokeWidth={1.75}
                />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center justify-between px-4 py-4">
          <ThemeToggle />
          <span className="kicker">reads argus</span>
        </div>
      </aside>
      <PullToRefresh enabled={!isChatDetail(pathname)}>
        <main className="mx-auto min-w-0 max-w-[1040px] px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          {children}
        </main>
      </PullToRefresh>
    </div>
  );
}
