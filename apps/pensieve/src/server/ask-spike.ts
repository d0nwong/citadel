/**
 * Ask spike (LIA-100) — throwaway. Proves TanStack AI's Claude Code adapter streams
 * over a Start server function under `bun server.ts`. Deleted or renamed by LIA-103.
 *
 * Shape: `chat()` with `claudeCodeText` over the argus checkout, run through the
 * local-process sandbox provider (the adapter refuses to run without a sandbox —
 * `requires: [SandboxCapability]` — and local-process is the no-Docker one that runs
 * on this Mac). Read-only tools only; the checkout is never written by the spike.
 */
import { chat, convertMessagesToModelMessages, toServerSentEventsResponse } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai'
import { claudeCodeText } from '@tanstack/ai-claude-code'
import { SandboxCapability, defineSandbox, withSandbox } from '@tanstack/ai-sandbox'
import { localProcessSandbox } from '@tanstack/ai-sandbox-local-process'
import { getRequest } from '@tanstack/react-start/server'
import { WORKSPACE_DIR } from '#/server/workspace'

/** The claude binary's own model alias; the CLI resolves it. */
const MODEL = 'sonnet'

/**
 * One sandbox definition for the process. `dir` pins the workspace to the argus
 * checkout (no temp dir, never removed on destroy). `fileEvents: false` because the
 * default watcher would fs.watch the whole checkout — node_modules included — for a
 * spike that only needs text back.
 */
const sandbox = defineSandbox({
  id: 'ask-spike',
  provider: localProcessSandbox({
    dir: WORKSPACE_DIR,
    // Bill the Mac's `claude login`, not an API key that may be in the environment.
    scrubEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  }),
  fileEvents: false,
})

const adapter = claudeCodeText(MODEL, {
  // '/workspace' is the sandbox's virtual root; local-process maps it onto `dir`.
  cwd: '/workspace',
  permissionMode: 'default',
  allowedTools: ['Read', 'Grep', 'Glob'],
  // Nothing else is allowed to write or run — the spike must leave `git status` alone.
  disallowedTools: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
  authMode: 'host',
  // Left at the default (['project']) on purpose: AC3 records which skills that loads.
  maxTurns: 8,
  emitDiff: false,
})

/**
 * `@tanstack/ai-sandbox` 0.5.6 declares `provides: [SandboxCapability, ProjectionCapability]`
 * but only calls `provideWorkspaceProjection()` when the definition has a `workspace`,
 * so a bare sandbox (no workspace — we don't want bootstrap or a marker file written
 * into the argus checkout) fails compose's setup check: "Middleware "sandbox" declares
 * it provides "sandbox-projection" but never called provide() in setup()". Narrowing
 * the declared list to what it actually provides is enough; the adapter treats the
 * projection as optional.
 */
const sandboxMiddleware = { ...withSandbox(sandbox), provides: [SandboxCapability] as const }

export function askSpikeResponse(messages: Array<UIMessage>): Response {
  // Stop on the page (or a closed tab) aborts the request; that must kill the claude process.
  const abortController = new AbortController()
  getRequest().signal.addEventListener('abort', () => abortController.abort(), { once: true })
  const stream = chat({
    adapter,
    messages: convertMessagesToModelMessages(messages),
    middleware: [sandboxMiddleware],
    abortController,
  })
  return toServerSentEventsResponse(stream, { abortController })
}
