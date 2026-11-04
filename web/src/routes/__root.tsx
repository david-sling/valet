import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Valet · Secure remote control for agents' },
      {
        name: 'description',
        content:
          "Valet lets an AI agent run commands on your customer's machine: only what they approve, enforced on their machine, logged for both of you.",
      },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Funnel+Display:wght@400;700;800&family=Albert+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* the hero scene waits for its script to place it; without JavaScript it shows in its resting layout */}
        <noscript dangerouslySetInnerHTML={{ __html: '<style>.tear-hero .hands-wrap{visibility:visible}</style>' }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
