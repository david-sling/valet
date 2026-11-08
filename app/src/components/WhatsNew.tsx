import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ReleaseNote } from '../api'

// Release notes are Markdown; only headings, lists, paragraphs, **bold** and `code` are drawn, everything else stays text.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
    return part
  })
}

function blocks(body: string): ReactNode[] {
  const out: ReactNode[] = []
  let items: string[] = []
  let para: string[] = []
  const flush = () => {
    if (items.length) out.push(<ul key={out.length}>{items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>)
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '))}</p>)
    items = []
    para = []
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const item = line.match(/^[-*]\s+(.*)$/)
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (item) {
      if (para.length) flush()
      items.push(item[1])
    } else if (heading) {
      flush()
      out.push(<h3 key={out.length}>{inline(heading[1])}</h3>)
    } else if (!line) {
      flush()
    } else {
      if (items.length) flush()
      para.push(line)
    }
  }
  flush()
  return out
}

export function WhatsNew({ notes, onClose }: { notes: ReleaseNote[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="whats-new" aria-labelledby="whats-new-title" onClose={onClose}>
      <h2 id="whats-new-title" className="m-title">
        What’s new in Valet {notes[0].version}
      </h2>
      <div className="whats-new-notes">
        {notes.map((n) => (
          <section key={n.version}>
            {notes.length > 1 && <p className="m-label">{n.version}</p>}
            {blocks(n.body)}
          </section>
        ))}
      </div>
      <form method="dialog">
        <button className="mbtn mbtn-ink mbtn-sm" autoFocus>
          Got it
        </button>
      </form>
    </dialog>
  )
}
