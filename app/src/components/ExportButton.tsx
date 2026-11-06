import { useEffect, useRef, useState } from 'react'

type Format = 'pdf' | 'json'

const FORMATS: Record<Format, { label: string; hint: string }> = {
  pdf: { label: 'Export PDF', hint: 'A report to read, print or share' },
  json: { label: 'Export JSON', hint: 'The full record, for other tools' },
}

function storedFormat(): Format {
  try {
    return localStorage.getItem('export-format') === 'json' ? 'json' : 'pdf'
  } catch {
    return 'pdf'
  }
}

export function ExportButton({ onExport }: { onExport: (f: Format) => Promise<boolean> }) {
  const [format, setFormat] = useState(storedFormat)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(t)
  }, [saved])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const pick = (f: Format) => {
    setFormat(f)
    setOpen(false)
    try {
      localStorage.setItem('export-format', f)
    } catch {
      // storage can be unavailable
    }
    run(f)
  }

  const run = (f: Format) => onExport(f).then(setSaved, () => undefined)

  return (
    <div className="split" ref={ref}>
      <button className="split-main" onClick={() => run(format)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
        </svg>
        {saved ? 'Saved' : FORMATS[format].label}
      </button>
      <button className="split-more" aria-label="Choose export format" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className="split-menu" role="menu">
          {(Object.keys(FORMATS) as Format[]).map((f) => (
            <button key={f} role="menuitemradio" aria-checked={f === format} onClick={() => pick(f)}>
              <b>{FORMATS[f].label}</b>
              <small>{FORMATS[f].hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
