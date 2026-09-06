import { useEffect, useRef } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { SquareIcon } from 'lucide-react'
import { PromptInput, PromptInputSubmit, PromptInputTextarea, PromptInputToolbar, PromptInputTools, preventEmptySubmit } from '#/components/ai/prompt-input'
import { Button } from '#/components/ui/button'
import { useChat } from '../model/chat-options'
import { useAskContext } from '../model/ask-context'

/** The composer: Enter sends, Shift+Enter breaks a line, Stop while an answer streams; disabled without a credential. */
export function AskInput() {
  const chat = useChat()
  const { status, draft } = useAskContext()
  const busy = chat.isLoading

  // Focus the composer on arrival only where a keyboard is already there: on a phone,
  // `autoFocus` would open the on-screen keyboard over the conversation being read.
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (window.matchMedia('(min-width: 640px) and (hover: hover)').matches) field.current?.focus()
  }, [])

  const submit = (e: FormEvent<HTMLFormElement>) => {
    preventEmptySubmit(e)
    if (e.defaultPrevented) return
    e.preventDefault()
    const form = e.currentTarget
    const textarea = form.elements.namedItem('message') as HTMLTextAreaElement
    const text = textarea.value.trim()
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

  const authLabel = status.available ? (status.authMode === 'api-key' ? 'api key' : 'host login') : ''
  const kicker = status.available ? ['claude-code', authLabel, status.probe.authMethod, 'read-only'].filter(Boolean).join(' · ') : 'unavailable'
  // On a phone the full line wraps the toolbar onto two rows; the short form keeps what matters.
  const kickerShort = status.available ? `${authLabel} · read-only` : 'unavailable'

  return (
    <PromptInput onSubmit={submit} className="mt-4">
      <PromptInputTextarea
        ref={field}
        name="message"
        defaultValue={draft}
        disabled={!status.available}
        onKeyDown={onKeyDown}
        placeholder={status.available ? 'Ask about the argus checkout…' : 'Ask needs a credential'}
      />
      <PromptInputToolbar>
        <PromptInputTools>
          <span className="kicker hidden px-2 sm:inline">{kicker}</span>
          <span className="kicker px-2 sm:hidden">{kickerShort}</span>
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
        <p className="border-t border-border px-4 py-2 text-sm leading-snug text-st-hold">
          {status.reason}. On this Mac, <code className="mono">claude login</code> — and if you are logged in already, a macOS Keychain dialog may be
          waiting for the <code className="mono">claude</code> process: choose Always Allow. In the container, set{' '}
          <code className="mono">ANTHROPIC_API_KEY</code>. Then reload.
          {status.claudePath === null && (
            <>
              {' '}
              (<code className="mono">claude</code> is not on Pensieve's PATH.)
            </>
          )}
        </p>
      )}
    </PromptInput>
  )
}
