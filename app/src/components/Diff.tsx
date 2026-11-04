import { useState } from 'react'

// A file change as a git-style diff: removed lines on red, added on green. Long changes open collapsed to a few
// lines starting just before the first change, with the rest one click away; the +/− count beside the path always
// shows the full size.
const DIFF_PREVIEW = 6
export function Diff({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)
  const long = lines.length > DIFF_PREVIEW + 2
  const from = Math.max(0, lines.findIndex((l) => l[0] !== ' ') - 2)
  const shown = long && !open ? lines.slice(from, from + DIFF_PREVIEW) : lines
  return (
    <div className="diff">
      {shown.map((l, i) => (
        <code key={i} className={`diff-line${l[0] === '+' ? ' is-add' : l[0] === '-' ? ' is-del' : ''}`}>
          <span className="diff-sign">{l[0] === ' ' ? '' : l[0]}</span>
          {l.slice(1)}
        </code>
      ))}
      {long && (
        <button className="diff-more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  )
}

// the change's full size, "+6 −4", shown beside the file's path
export function DiffStat({ lines }: { lines: string[] }) {
  return (
    <span className="diff-stat">
      <span className="is-add">+{lines.filter((l) => l[0] === '+').length}</span>{' '}
      <span className="is-del">−{lines.filter((l) => l[0] === '-').length}</span>
    </span>
  )
}
