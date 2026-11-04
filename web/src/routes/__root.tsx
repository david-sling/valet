import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

import appCss from '../styles.css?url'

// What a shared link shows: the title, the description, and the share card rendered from og/og-image.html
// (pnpm og). Share cards need absolute URLs, so they're built on the production address.
const SITE = 'https://valet.davidsling.in'
const TITLE = 'Valet · Secure remote control for agents'
const DESCRIPTION =
  "Valet lets an AI agent run commands on your customer's machine: only what they approve, enforced on their machine, logged for both of you."
const IMAGE = { url: `${SITE}/og.png`, width: '1200', height: '630', alt: 'Valet: Let your agent drive. Keep the trunk locked.' }

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'theme-color', content: '#fbfaf6' },
      // Open Graph: link previews in Slack, LinkedIn, iMessage, WhatsApp and most others
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Valet' },
      { property: 'og:url', content: `${SITE}/` },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: IMAGE.url },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: IMAGE.width },
      { property: 'og:image:height', content: IMAGE.height },
      { property: 'og:image:alt', content: IMAGE.alt },
      { property: 'og:locale', content: 'en_US' },
      // X (Twitter) reads most of the above, but needs its own card type to show the large image
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: IMAGE.url },
      { name: 'twitter:image:alt', content: IMAGE.alt },
    ],
    links: [
      { rel: 'canonical', href: `${SITE}/` },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
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
        {/* the devtools' floating button; the devtools Vite plugin strips it from production builds */}
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }]}
        />
        <Scripts />
      </body>
    </html>
  )
}
