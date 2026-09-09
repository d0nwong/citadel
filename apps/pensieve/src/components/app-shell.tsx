/**
 * The shell: shadcn's Sidebar on the left — grouped nav, with every feature doc listed
 * under its app the way a docs site lists its pages — and, over the content, a sticky top
 * bar with the breadcrumb, the theme switch, the workspace path and a way to ask Argus.
 * Below `md` the sidebar is a sheet behind the trigger in the top bar.
 *
 * The docs tree and the workspace path come from the root route's loader
 * (`getNavigation`), so a feature added to argus is in the sidebar on the next load. The
 * breadcrumb is read off the matched routes: a route names its section in
 * `staticData.crumb`, and a dynamic page returns its own `crumb` from its loader.
 */

import {
  Link,
  useLoaderData,
  useMatches,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  BookOpenText,
  ChevronRight,
  FileText,
  FolderIcon,
  Inbox,
  MessageCircleQuestion,
  MessagesSquare,
  ScrollText,
  SparklesIcon,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "#/components/theme";
import { Button } from "#/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "#/components/ui/sidebar";
import { newThreadId } from "#/features/ask/lib/thread-id";
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

// ── the sidebar ────────────────────────────────────────────────────────────────

const READING = [
  { icon: FileText, label: "Reports", to: "/reports" },
  { icon: MessagesSquare, label: "Digests", to: "/digests" },
  { icon: ScrollText, label: "Journal", to: "/journal" },
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

const isActive = (pathname: string, to: string) =>
  to === "/" ? pathname === "/" : pathname.startsWith(to);

function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { docs } = useLoaderData({ from: "__root__" });
  const { setOpenMobile } = useSidebar();
  // The sheet closes on navigation; shadcn leaves that to the app.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not an input
  useEffect(() => setOpenMobile(false), [pathname]);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="h-14 justify-center border-sidebar-border border-b px-4">
        <Link
          className="flex items-center gap-2 font-semibold text-[15px] text-foreground"
          to="/"
        >
          <Basin className="size-6 text-primary" />
          Pensieve
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-0 py-2">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/"}>
                <Link to="/">
                  <Inbox />
                  <span>Today</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {/* Beside Today, not under Reading: the points on one and the initiatives on
                the other are the same work, asked about at two altitudes (LIA-149). */}
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive(pathname, "/arcs")}>
                <Link to="/arcs">
                  <Waypoints />
                  <span>Arcs</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Reading</SidebarGroupLabel>
          <SidebarMenu>
            {READING.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={isActive(pathname, to)}>
                  <Link to={to}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Docs</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === "/docs" || pathname === "/docs/"}
              >
                <Link to="/docs">
                  <BookOpenText />
                  <span>All features</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {docs.map(({ app, features }) => {
              const inApp = pathname.startsWith(`/docs/${app}/`);
              return (
                <Collapsible
                  asChild
                  className="group/collapsible"
                  defaultOpen={inApp || docs.length === 1}
                  key={app}
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton>
                        <FolderIcon />
                        <span className="truncate">{app}</span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {features.map((f) => (
                          <SidebarMenuSubItem key={f.feature}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === `/docs/${f.feature}`}
                            >
                              <Link params={{ _splat: f.feature }} to="/docs/$">
                                <span className="truncate">{f.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Argus</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive(pathname, "/ask")}>
                <Link to="/ask">
                  <MessageCircleQuestion />
                  <span>Conversations</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

// ── the top bar ────────────────────────────────────────────────────────────────

/** `/reports/$day` → `/reports`, `/docs/$` → `/docs`: the section a dynamic page sits under. */
const sectionPath = (fullPath: string) => fullPath.split("/$")[0] || "/";

/**
 * The trail of matched routes that name themselves. A route's `staticData.crumb` is its
 * section; a dynamic page's loader adds its own `crumb`, and then the section links to
 * the route's static part and the page is the last, current crumb.
 */
function Breadcrumb() {
  const matches = useMatches();
  const crumbs: Array<{ label: string; to: string }> = [];
  const push = (label: string, to: string) => {
    const last = crumbs.at(-1);
    if (last?.to === to) {
      last.label = label;
    } else {
      crumbs.push({ label, to });
    }
  };
  for (const m of matches) {
    const fromLoader = (m.loaderData as { crumb?: unknown } | undefined)?.crumb;
    const page = typeof fromLoader === "string" ? fromLoader : undefined;
    const section = m.staticData.crumb;
    const to = m.pathname.replace(/\/$/, "") || "/";
    if (section) {
      push(section, page ? sectionPath(m.fullPath) : to);
    }
    if (page) {
      push(page, to);
    }
  }
  if (crumbs.length === 0) {
    return null;
  }
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span className="flex min-w-0 items-center gap-1" key={c.to}>
            {i > 0 && (
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 text-subtle"
                strokeWidth={1.75}
              />
            )}
            {last ? (
              <span
                aria-current="page"
                className="truncate rounded-md bg-muted px-2 py-1 font-medium text-foreground"
              >
                {c.label}
              </span>
            ) : (
              <Link
                className="truncate px-1 py-1 font-medium text-muted-foreground hover:text-foreground"
                to={c.to as "/"}
              >
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function TopBar() {
  const { workspace } = useLoaderData({ from: "__root__" });
  const navigate = useNavigate();
  const ask = () => navigate({ params: { id: newThreadId() }, to: "/ask/$id" });
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-border border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <SidebarTrigger className="-ml-1 md:hidden" />
      <Breadcrumb />
      <div className="ml-auto flex items-center gap-2">
        <span className="mono hidden text-subtle md:inline" title={workspace}>
          {workspace.replace(/^\/Users\/[^/]+/, "~")}
        </span>
        <ThemeToggle />
        <Button onClick={ask} size="sm">
          <SparklesIcon />
          Ask Argus
        </Button>
      </div>
    </header>
  );
}

// ── the shell ──────────────────────────────────────────────────────────────────

/** The chat detail page (`/ask/<id>`) keeps its own scroll and may have a run in flight. */
const isChatDetail = (pathname: string) => /^\/ask\/[^/]+\/?$/.test(pathname);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <TopBar />
        <PullToRefresh enabled={!isChatDetail(pathname)}>
          <div className="mx-auto w-full max-w-[1080px] px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
            {children}
          </div>
        </PullToRefresh>
      </SidebarInset>
    </SidebarProvider>
  );
}
