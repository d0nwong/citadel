/**
 * TanStack Devtools, dev only — the root route lazy-loads this behind `import.meta.env.DEV`
 * so none of it reaches the production bundle. The AI panel shows each `useChat` client
 * with its `threadId`, runs, chunks and custom events (the Claude session id among them);
 * the Router panel the matches and loader data.
 */

import { aiDevtoolsPlugin } from "@tanstack/react-ai-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

export default function Devtools() {
  return (
    <TanStackDevtools
      plugins={[
        aiDevtoolsPlugin(),
        { name: "Router", render: <TanStackRouterDevtoolsPanel /> },
      ]}
    />
  );
}
