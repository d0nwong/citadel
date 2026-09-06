/**
 * The Ask chat, bound once (LIA-103): `createChatHook` from `@tanstack/ai-react/ui` with the
 * shadcn.io/ai blocks (LIA-101) as its widgets and `askChat` (LIA-102) as its transport.
 * The route calls `useAppChat({ threadId, initialMessages })` and renders `<chat.AppChat />`.
 *
 * Transport: the hook holds the full transcript (the stored turns from the route loader
 * plus whatever was said since) and the fetcher sends all of it every turn — the server's
 * "full transcript, or none of it" rule; `[]` would only work once the new question was
 * already on disk, and it never is. Hydration is `initialMessages`: a fetcher-based
 * connection has no `hydrate`, so `persistence: true` here means "keyed by threadId,
 * nothing cached in the browser" and no more.
 *
 * The harness's built-in tools come through as tool-call parts named `Read`, `Grep`,
 * `Glob`, `Bash`; the UI kit dispatches those to `toolsComponents[name]` only (a fallback
 * part never sees a tool call), so every name that can appear is registered against one
 * Tool block. A matched tool result reaches that block as `result`; only an orphan result
 * reaches the `toolResult` part.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { createChatHook, createChatHookContexts } from '@tanstack/ai-react/ui'
import type { LayoutProps, MessageProps, PartProps, QueueProps, ToolProps } from '@tanstack/ai-react/ui'
import type { ChatFetcher } from '@tanstack/ai-react'
import type { StreamChunk } from '@tanstack/ai'
import { SquareIcon, XIcon } from 'lucide-react'
import { askChat } from '#/lib/api'
import type { AskStatus } from '#/server/ask'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '#/components/ai/conversation'
import { Message, MessageContent, MessageResponse } from '#/components/ai/message'
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  preventEmptySubmit,
} from '#/components/ai/prompt-input'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '#/components/ai/reasoning'
import { Tool, ToolContent, ToolHeader, ToolInput } from '#/components/ai/tool'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { parseArguments, toolResultText, toolSummary } from './tool-summary'

// ── options ────────────────────────────────────────────────────────────────────

/** `threadId` is the hook's own (the per-call override), so nothing here closes over state. */
const fetcher: ChatFetcher = ({ messages, threadId }, { signal }) => askChat({ data: { threadId, messages }, signal })

// ── how the last run ended ─────────────────────────────────────────────────────
//
// `RUN_FINISHED` carries a `finishReason`; the hook keeps nothing of it. When the reason is
// `length` the claude CLI hit the adapter's `maxTurns` and the answer stops mid-thought,
// which deserves a line under it. Kept per thread in a module-level store, read with
// `useSyncExternalStore`, because the options are bound once at module scope.

const finishReasons = new Map<string, string>()
const finishListeners = new Set<() => void>()
const noteFinish = (threadId: string, reason: string | undefined) => {
  if (reason) finishReasons.set(threadId, reason)
  else finishReasons.delete(threadId)
  for (const l of finishListeners) l()
}
const subscribeFinish = (l: () => void) => {
  finishListeners.add(l)
  return () => finishListeners.delete(l)
}
const useFinishReason = (threadId: string | undefined) =>
  useSyncExternalStore(
    subscribeFinish,
    () => (threadId ? finishReasons.get(threadId) : undefined),
    () => undefined,
  )

const options = {
  fetcher,
  persistence: true as const,
  devtools: { name: 'Ask argus' },
  onChunk: (chunk: StreamChunk) => {
    if (chunk.type === 'RUN_STARTED' && chunk.threadId) noteFinish(chunk.threadId, undefined)
    if (chunk.type === 'RUN_FINISHED' && chunk.threadId) noteFinish(chunk.threadId, chunk.finishReason ?? undefined)
  },
}
type Opts = typeof options

/**
 * Widgets read the chat through these scoped contexts rather than the `useChatContext`
 * that `createChatHook` returns below — the documented way around the module-level
 * circularity (the widgets are arguments to the call that defines that hook).
 */
const contexts = createChatHookContexts()
const useChat = contexts.useChatContext

// ── availability (AC4) ─────────────────────────────────────────────────────────

interface AskContextValue {
  status: AskStatus
  /** The conversation on screen — the hook does not expose its own thread id. */
  threadId?: string
  /** Text to start the composer with — a question arriving from a point that could not be sent. */
  draft?: string
}

const AskStatusContext = createContext<AskContextValue>({ status: { available: true, authMode: 'host' } })

/** The route wraps `<chat.AppChat />` in this; the widgets read it (they take no props of their own). */
export function AskStatusProvider({ status, threadId, draft, children }: AskContextValue & { children: ReactNode }) {
  return <AskStatusContext.Provider value={{ status, threadId, draft }}>{children}</AskStatusContext.Provider>
}

// ── chrome: layout, message, input, queue ──────────────────────────────────────

function AskLayout({ Messages, Queue, Interrupts, Input }: LayoutProps<Opts, typeof AskInput>) {
  const chat = useChat()
  const empty = chat.messages.length === 0
  const finish = useFinishReason(useContext(AskStatusContext).threadId)
  return (
    <>
      <Conversation className="min-h-0">
        <ConversationContent className="px-0">
          {empty ? (
            <ConversationEmptyState
              title="Ask argus"
              description="Claude Code with the argus checkout open, read-only. Ask what the sweep found, what a journal entry decided, where a feature lives."
            />
          ) : (
            <Messages />
          )}
          <Queue />
          <Interrupts />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {chat.error && (
        <p role="alert" className="mt-3 text-[13px] text-st-hold">
          {chat.error.message}
        </p>
      )}
      {finish === 'length' && !chat.isLoading && (
        <p role="status" className="mt-3 text-[13px] text-ink-dim">
          Stopped at the turn limit before it was done. Ask it to continue — the session picks up where it left off.
        </p>
      )}
      <Input />
    </>
  )
}

function AskMessage({ message, Parts }: MessageProps<Opts>) {
  if (message.role === 'user') {
    // A question is shown as typed — no markdown, so a path or a `*` stays literal.
    const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.content] : [])).join('\n')
    return (
      <Message from="user">
        <MessageContent className="whitespace-pre-wrap">{text}</MessageContent>
      </Message>
    )
  }
  return (
    <Message from={message.role}>
      <Parts />
    </Message>
  )
}

function AskInput() {
  const chat = useChat()
  const { status, draft } = useContext(AskStatusContext)
  const busy = chat.isLoading

  const submit = (e: FormEvent<HTMLFormElement>) => {
    preventEmptySubmit(e)
    if (e.defaultPrevented) return
    e.preventDefault()
    const form = e.currentTarget
    const field = form.elements.namedItem('message') as HTMLTextAreaElement
    const text = field.value.trim()
    form.reset()
    // Sent while an answer streams, this queues (the hook's default) and shows in <Queue /> (AC6).
    void chat.sendMessage(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <PromptInput onSubmit={submit} className="mt-4">
      <PromptInputTextarea
        name="message"
        autoFocus
        defaultValue={draft}
        disabled={!status.available}
        onKeyDown={onKeyDown}
        placeholder={status.available ? 'Ask about the argus checkout…' : 'Ask needs a credential'}
      />
      <PromptInputToolbar>
        <PromptInputTools>
          <span className="kicker px-2">
            {status.available ? `claude-code · ${status.authMode === 'api-key' ? 'api key' : 'host login'} · read-only` : 'unavailable'}
          </span>
        </PromptInputTools>
        {busy ? (
          // Stop aborts the fetcher's signal, which aborts the request, which kills the claude
          // process (AC7). Its own button, not `PromptInputSubmit`, so it is named "Stop".
          <Button type="button" size="icon-sm" className="rounded-full" onClick={chat.stop} title="Stop">
            <SquareIcon className="size-3.5" />
            <span className="sr-only">Stop</span>
          </Button>
        ) : (
          <PromptInputSubmit status={chat.status === 'error' ? 'error' : 'ready'} disabled={!status.available} title="Send" />
        )}
      </PromptInputToolbar>
      {!status.available && (
        <p className="border-t border-border px-4 py-2 text-[12.5px] leading-snug text-st-hold">
          {status.reason}. On this Mac, <code className="mono">claude login</code>; in the container, set{' '}
          <code className="mono">ANTHROPIC_API_KEY</code>. Then reload.
        </p>
      )}
    </PromptInput>
  )
}

function AskQueue({ item }: QueueProps<Opts>) {
  const c = item.content
  const text = typeof c === 'string' ? c : typeof c.content === 'string' ? c.content : '…'
  return (
    <div className="ml-auto flex max-w-[95%] items-center gap-2 text-[13px] text-ink-faint">
      <span className="kicker">queued</span>
      <span className="truncate">{text}</span>
      <button
        type="button"
        onClick={item.cancelQueued}
        title="Cancel"
        className="rounded p-0.5 hover:bg-paper-2 hover:text-ink"
        aria-label="Cancel queued message"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

// ── parts ──────────────────────────────────────────────────────────────────────

function TextPart({ part }: PartProps<Opts, 'text'>) {
  return (
    <MessageContent>
      <MessageResponse>{part.content}</MessageResponse>
    </MessageContent>
  )
}

/** Open while the answer streams, closed once it has finished (and when hydrated from disk). */
function ThinkingPart({ part }: PartProps<Opts, 'thinking'>) {
  const chat = useChat()
  const [open, setOpen] = useState(chat.isLoading)
  useEffect(() => {
    if (!chat.isLoading) setOpen(false)
  }, [chat.isLoading])
  return (
    <Reasoning open={open} onOpenChange={setOpen}>
      <ReasoningTrigger />
      <ReasoningContent>{part.content}</ReasoningContent>
    </Reasoning>
  )
}

/** A result with no call to attach to — the kit hides matched results, they render in the call's block. */
function OrphanResultPart({ part }: PartProps<Opts, 'toolResult'>) {
  return (
    <Tool>
      <ToolHeader title={part.name ?? 'result'} state={part.state} className="font-mono" />
      <ToolContent>
        <Output value={part.error ?? toolResultText(part.content)} />
      </ToolContent>
    </Tool>
  )
}

function FallbackPart({ part }: PartProps<Opts>) {
  return (
    <details className="text-[12px] text-ink-faint">
      <summary className="kicker cursor-pointer">{part.type}</summary>
      <pre className="mt-1 overflow-x-auto font-mono text-[11px]">{JSON.stringify(part, null, 1)}</pre>
    </details>
  )
}

// ── tools ──────────────────────────────────────────────────────────────────────

const OUTPUT_CAP = 6_000

/** Text output as text (a file the session read, a grep listing); anything else as JSON. */
function Output({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const shown = text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}\n… ${text.length - OUTPUT_CAP} more characters` : text
  return <pre className={cn('overflow-x-auto whitespace-pre-wrap rounded-md bg-secondary p-2 font-mono text-xs', className)}>{shown}</pre>
}

/** One block per call, collapsed; the header names the tool and what it was about (AC1). */
function ToolCall({ part, result }: ToolProps<Opts>) {
  const input: unknown = part.input ?? parseArguments(part.arguments)
  const summary = toolSummary(part.name, input)
  const state = result ? (result.state === 'error' ? 'error' : 'output-complete') : part.state
  const output = result ? (result.error ?? toolResultText(result.content)) : part.output
  return (
    <Tool>
      <ToolHeader title={summary ? `${part.name} · ${summary}` : part.name} state={state} className="font-mono" />
      <ToolContent>
        <ToolInput input={input ?? part.arguments} />
        {output !== undefined && output !== '' && <Output value={output} />}
      </ToolContent>
    </Tool>
  )
}

/**
 * The adapter's allowlist, plus the harness tools a run can still name (they are denied,
 * and the denial arrives as a result). Anything else warns in dev and renders nothing.
 */
const TOOL_NAMES = ['Read', 'Grep', 'Glob', 'Bash', 'LS', 'TodoWrite', 'Task', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const
const toolsComponents: Record<string, typeof ToolCall> = Object.fromEntries(TOOL_NAMES.map((n) => [n, ToolCall]))

// ── the hook ───────────────────────────────────────────────────────────────────

export const { useAppChat, useChatContext } = createChatHook({
  options,
  context: contexts,
  components: { layout: AskLayout, message: AskMessage, input: AskInput, queue: AskQueue },
  partsComponents: { text: TextPart, thinking: ThinkingPart, toolResult: OrphanResultPart, fallback: FallbackPart },
  toolsComponents,
})
