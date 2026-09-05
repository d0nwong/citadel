import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { AppShell } from '#/components/app-shell'
import appCss from '../styles.css?url'

interface RouterContext {
  queryClient: QueryClient
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='15' r='9' fill='none' stroke='%233a6a90' stroke-width='2'/%3E%3Cpath d='M8 15c3-3 9-3 12 0' fill='none' stroke='%233a6a90' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E"

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Pensieve' },
      { name: 'description', content: 'Reading room for the argus blackboard.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: FAVICON },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        <Scripts />
      </body>
    </html>
  )
}
