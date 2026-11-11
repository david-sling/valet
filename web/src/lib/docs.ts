import type { ComponentType } from 'react'
import type { MDXComponents } from 'mdx/types'
import GithubSlugger from 'github-slugger'
import { REPO_URL } from '#/lib/github'
import { installMarkdown } from '#/components/Links'

type Frontmatter = { title: string; description: string }
type Module = { default: ComponentType<{ components?: MDXComponents }>; frontmatter: Frontmatter }

export type Heading = { depth: 2 | 3; text: string; id: string }
export type Doc = Frontmatter & {
  slug: string
  href: string
  Content: Module['default']
  markdown: string
  headings: Heading[]
  history: string | null
}

export const SECTIONS: Array<{ title: string; side?: 'agent' | 'client'; pages: string[] }> = [
  { title: 'Start here', pages: ['', 'how-it-works'] },
  { title: 'For vendors', side: 'agent', pages: ['vendors/quickstart', 'vendors/tools', 'vendors/permissions', 'vendors/sessions'] },
  { title: 'For clients', side: 'client', pages: ['clients/joining', 'clients/approvals', 'clients/after-a-session'] },
  { title: 'For IT and security', pages: ['security'] },
  { title: 'Reference', pages: ['reference/api', 'reference/limits'] },
  { title: 'Legal', pages: ['privacy', 'terms'] },
]

const WITH_HISTORY = new Set(['privacy', 'terms'])

const modules = import.meta.glob<Module>('../docs/**/*.mdx', { eager: true })
const sources = import.meta.glob<string>('../docs/**/*.mdx', { eager: true, query: '?raw', import: 'default' })

const slugOf = (path: string) => path.replace(/^\.\.\/docs\//, '').replace(/\.mdx$/, '').replace(/(^|\/)index$/, '')

function body(source: string) {
  return source
    .replace(/^---\n[\s\S]*?\n---\n+/, '')
    .replace(/<InstallSkill skill="([^"]+)"[^>]*\/>/g, (_, skill: string) => installMarkdown(skill))
    .trim()
}

function plain(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
}

function headingsOf(md: string): Heading[] {
  const slugger = new GithubSlugger()
  const out: Heading[] = []
  let fenced = false
  for (const line of md.split('\n')) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced
    const m = !fenced && /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (!m) continue
    const text = plain(m[2])
    const id = slugger.slug(text)
    const depth = m[1].length
    if (depth === 2 || depth === 3) out.push({ depth, text, id })
  }
  return out
}

const DOCS = new Map<string, Doc>(
  Object.entries(modules).map(([path, mod]) => {
    const slug = slugOf(path)
    const content = body(sources[path])
    const { title, description } = mod.frontmatter
    return [
      slug,
      {
        slug,
        href: slug ? `/docs/${slug}` : '/docs',
        title,
        description,
        Content: mod.default,
        markdown: `# ${title}\n\n> ${description}\n\n${content}\n`,
        headings: headingsOf(content),
        history: WITH_HISTORY.has(slug) ? `${REPO_URL}/commits/main/web/src/docs/${slug}.mdx` : null,
      },
    ]
  }),
)

export const ORDER = SECTIONS.flatMap((s) => s.pages).filter((slug) => DOCS.has(slug))

export function getDoc(slug: string) {
  return DOCS.get(slug.replace(/\/+$/, ''))
}

export function neighbours(slug: string) {
  const i = ORDER.indexOf(slug)
  return { prev: i > 0 ? DOCS.get(ORDER[i - 1]) : undefined, next: i >= 0 ? DOCS.get(ORDER[i + 1]) : undefined }
}

export function absolutise(markdown: string, origin: string) {
  return markdown.replace(/\]\((\/[^)]*)\)/g, `](${origin}$1)`)
}
