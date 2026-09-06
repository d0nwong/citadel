import type { LayoutProps } from '@tanstack/ai-react/ui'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '#/components/ai/conversation'
import { useChat } from '../model/chat-options'
import type { Opts } from '../model/chat-options'
import { useAskContext } from '../model/ask-context'
import { useFinishReason, useRanHere } from '../model/finish-reason'
import type { AskInput } from './input'

/** The conversation, the run's end state under it, and the composer. */
export function AskLayout({ Messages, Queue, Interrupts, Input }: LayoutProps<Opts, typeof AskInput>) {
  const chat = useChat()
  const empty = chat.messages.length === 0
  const { threadId, finishReason, lastError } = useAskContext()
  const finish = useFinishReason(threadId, finishReason)
  // The stored error stands until a run happens on this page; then the hook's own error does.
  const ranHere = useRanHere(threadId)
  const error = chat.error?.message ?? (!ranHere && !chat.isLoading ? lastError?.message : undefined)
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
      {error && (
        <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-st-hold">
          {error}
        </p>
      )}
      {finish === 'length' && !chat.isLoading && (
        <p role="status" className="mt-3 text-sm text-ink-dim">
          Stopped at the turn limit before it was done. Ask it to continue — the session picks up where it left off.
        </p>
      )}
      <Input />
    </>
  )
}
