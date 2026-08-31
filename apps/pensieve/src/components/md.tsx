import { Link } from '@tanstack/react-router'
import { Markdown } from '@tanstack/markdown/react'
import type { MarkdownDocument } from '@tanstack/markdown'
import type { AnchorHTMLAttributes } from 'react'
import { cn } from '#/lib/utils'

/** Internal links become router navigations; everything else opens in a new tab. */
function A({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href && href.startsWith('/')) {
    return (
      <Link to={href as '/'} {...(rest as object)}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  )
}

const components = { a: A }

export function Md({ doc, className }: { doc: MarkdownDocument; className?: string }) {
  return (
    <div className={cn('prose-pensieve', className)}>
      <Markdown components={components}>{doc}</Markdown>
    </div>
  )
}
