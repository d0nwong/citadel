import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AppShell } from "#/components/app-shell";
import { THEME_SCRIPT } from "#/components/theme";
import { getNavigation } from "#/lib/api";
import appCss from "../styles.css?url";

interface RouterContext {
  queryClient: QueryClient;
}

/** Dev only; the static `import.meta.env.DEV` keeps the panels out of the production bundle. */
const Devtools = import.meta.env.DEV
  ? lazy(() => import("#/components/devtools"))
  : null;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='15' r='9' fill='none' stroke='%233a6a90' stroke-width='2'/%3E%3Cpath d='M8 15c3-3 9-3 12 0' fill='none' stroke='%233a6a90' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E";

export const Route = createRootRouteWithContext<RouterContext>()({
  // The sidebar's docs tree; a minute old is fine, and a pull-to-refresh re-reads it.
  loader: () => getNavigation(),
  staleTime: 60_000,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Pensieve" },
      {
        name: "description",
        content: "Reading room for the argus blackboard.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: FAVICON },
    ],
    // Applies `.dark` from the stored choice or the system before first paint.
    scripts: [{ children: THEME_SCRIPT }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        {Devtools && (
          <Suspense fallback={null}>
            <Devtools />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  );
}
