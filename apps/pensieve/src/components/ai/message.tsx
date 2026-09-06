/**
 * shadcn.io/ai Message block, vendored from TanStack/ai `examples/ts-react-ui-chatbot`.
 * One change from upstream: `MessageResponse` renders markdown through Pensieve's own
 * `Md` (@tanstack/markdown + `.prose-pensieve`) instead of react-markdown, so an
 * assistant reply has the same typography as a journal entry or a digest.
 */
import type { HTMLAttributes } from 'react'
import { memo } from 'react'
import { Md } from '#/components/md'
import { cn } from '#/lib/utils'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant' | 'system'
}

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        'group flex w-full max-w-[95%] flex-col gap-2',
        from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
        className,
      )}
      data-role={from}
      {...props}
    />
  )
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export function MessageContent({ children, className, ...props }: MessageContentProps) {
  return (
    <div
      className={cn(
        'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm',
        'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type MessageAvatarProps = {
  name?: string
  src?: string
  className?: string
}

export function MessageAvatar({ name, src, className }: MessageAvatarProps) {
  const initials = (name ?? '?').slice(0, 1).toUpperCase()
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs text-muted-foreground',
        'group-[.is-user]:ml-auto',
        className,
      )}
    >
      {src ? <img alt={name} className="size-full object-cover" src={src} /> : initials}
    </div>
  )
}

/** Markdown body of a message. Memoised because it re-renders on every streamed delta. */
export const MessageResponse = memo(function MessageResponse({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  const text = typeof children === 'string' ? children : String(children ?? '')
  return (
    <Md
      doc={text}
      className={cn('size-full max-w-none text-[15px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
    />
  )
})
