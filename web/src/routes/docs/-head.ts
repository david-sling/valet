import docsCss from '#/docs.css?url'
import type { Doc } from '#/lib/docs'

const SITE = 'https://valet.davidsling.in'

const THEME = `try{var t=localStorage.getItem('docs-theme');document.documentElement.dataset.docsTheme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.docsSide=localStorage.getItem('docs-side')||'open'}catch(e){}`

export function docHead(doc: Doc | undefined) {
  if (!doc) return {}
  const title = `${doc.title} · Valet docs`
  return {
    meta: [
      { title },
      { name: 'description', content: doc.description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: doc.description },
      { property: 'og:url', content: `${SITE}${doc.href}` },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: doc.description },
    ],
    scripts: [{ children: THEME }],
    links: [
      { rel: 'stylesheet', href: docsCss },
      { rel: 'canonical', href: `${SITE}${doc.href}` },
    ],
  }
}
