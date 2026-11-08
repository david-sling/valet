import { useEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { Link } from '@tanstack/react-router'
import type { MDXComponents } from 'mdx/types'
import { StarButton } from '#/components/Links'
import { SECTIONS, absolutise, getDoc, neighbours } from '#/lib/docs'
import type { Doc, Heading } from '#/lib/docs'

function useCopy() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    )
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }
  return [state, copy] as const
}

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

const MarkdownIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
    <path d="M6.5 15V9l2.5 3 2.5-3v6M15.5 9v6m0 0-2-2m2 2 2-2" />
  </svg>
)

function CopyMarkdown({ doc }: { doc: Doc }) {
  const [state, copy] = useCopy()
  return (
    <button
      type="button"
      className="docs-copy-md"
      data-state={state}
      onClick={() => copy(absolutise(doc.markdown, window.location.origin))}
    >
      {state === 'copied' ? <CheckIcon /> : <MarkdownIcon />}
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : 'Copy as Markdown'}
      </span>
    </button>
  )
}

function CodeBlock(props: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [state, copy] = useCopy()
  return (
    <div className="docs-code">
      <pre {...props} ref={ref} />
      <button
        type="button"
        className="docs-code-copy"
        aria-label={state === 'copied' ? 'Copied' : 'Copy code'}
        onClick={() => copy(ref.current?.textContent ?? '')}
      >
        {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

const components: MDXComponents = {
  pre: CodeBlock,
  table: (props) => (
    <div className="docs-table">
      <table {...props} />
    </div>
  ),
  a: ({ href = '', ...props }) =>
    /^https?:/.test(href) ? <a href={href} target="_blank" rel="noreferrer" {...props} /> : <a href={href} {...props} />,
}

function Sidebar({ current }: { current: string }) {
  return (
    <nav className="docs-side" aria-label="Docs">
      {SECTIONS.map((section) => (
        <div className="docs-side-group" key={section.title} data-side={section.side}>
          <p className="docs-side-title">{section.title}</p>
          <ul>
            {section.pages.map((slug) => {
              const doc = getDoc(slug)
              if (!doc) return null
              return (
                <li key={slug}>
                  <Link to={doc.href} activeOptions={{ exact: true }} aria-current={slug === current ? 'page' : undefined}>
                    {doc.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function useActiveHeading(headings: Heading[]) {
  const [active, setActive] = useState(headings[0]?.id)
  useEffect(() => {
    const update = () => {
      let id = headings[0]?.id
      for (const h of headings) {
        const el = document.getElementById(h.id)
        if (el && el.getBoundingClientRect().top < 140) id = h.id
      }
      setActive(id)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [headings])
  return active
}

function Contents({ headings }: { headings: Heading[] }) {
  const active = useActiveHeading(headings)
  if (headings.length < 2) return <aside className="docs-toc" />
  return (
    <aside className="docs-toc">
      <nav aria-label="On this page">
        <p className="docs-side-title">On this page</p>
        <ul>
          {headings.map((h) => (
            <li key={h.id} data-depth={h.depth}>
              <a href={`#${h.id}`} aria-current={h.id === active ? 'location' : undefined}>
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

export function DocsPage({ doc, stars }: { doc: Doc; stars: number | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { prev, next } = neighbours(doc.slug)
  const { Content } = doc
  useEffect(() => setMenuOpen(false), [doc.slug])

  return (
    <div className="docs" data-menu={menuOpen ? 'open' : undefined}>
      <header className="docs-top">
        <div className="docs-top-start">
          <a className="docs-brand" href="/">
            <img src="/brand/valet-mark.svg" alt="" width="24" height="24" />
            Valet
          </a>
          <Link className="docs-crumb" to="/docs">
            Docs
          </Link>
        </div>
        <div className="docs-top-end">
          <StarButton stars={stars} label="Star" className="docs-star" />
          <button
            type="button"
            className="docs-menu-btn"
            aria-expanded={menuOpen}
            aria-controls="docs-side"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>

      <div className="docs-body">
        <div id="docs-side" className="docs-side-wrap">
          <Sidebar current={doc.slug} />
        </div>

        <main className="docs-main">
          <article className="docs-article">
            <header className="docs-head">
              <h1>{doc.title}</h1>
              <p className="docs-lead">{doc.description}</p>
              <div className="docs-actions">
                <CopyMarkdown doc={doc} />
              </div>
            </header>
            <div className="docs-prose">
              <Content components={components} />
            </div>
            {(prev || next) && (
              <nav className="docs-pager" aria-label="Previous and next">
                {prev ? (
                  <Link to={prev.href} className="docs-pager-link" rel="prev">
                    <span>Previous</span>
                    {prev.title}
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link to={next.href} className="docs-pager-link docs-pager-next" rel="next">
                    <span>Next</span>
                    {next.title}
                  </Link>
                )}
              </nav>
            )}
          </article>
        </main>

        <Contents headings={doc.headings} />
      </div>
    </div>
  )
}
