import type { MessageProps } from '@tanstack/ai-react/ui'
import { Message, MessageContent } from '#/components/ai/message'
import type { Opts } from '../model/chat-options'

/** A user turn as typed (no markdown, so a path or a `*` stays literal); an assistant turn as its parts. */
export function AskMessage({ message, Parts }: MessageProps<Opts>) {
  if (message.role === 'user') {
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
