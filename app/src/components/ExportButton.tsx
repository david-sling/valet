import { useEffect, useState } from 'react'
import { SplitButton, type SplitOption } from './SplitButton'

type Format = 'pdf' | 'json'

const FORMATS: SplitOption<Format>[] = [
  { key: 'pdf', label: 'Export PDF', hint: 'A report to read, print or share' },
  { key: 'json', label: 'Export JSON', hint: 'The full record, for other tools' },
]

function storedFormat(): Format {
  try {
    return localStorage.getItem('export-format') === 'json' ? 'json' : 'pdf'
  } catch {
    return 'pdf'
  }
}

export function ExportButton({ onExport }: { onExport: (f: Format) => Promise<boolean> }) {
  const [format, setFormat] = useState(storedFormat)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(t)
  }, [saved])

  const run = (f: Format) => onExport(f).then(setSaved, () => undefined)

  return (
    <SplitButton
      label={saved ? 'Saved' : FORMATS.find((f) => f.key === format)!.label}
      icon={
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
        </svg>
      }
      menuLabel="Choose export format"
      options={FORMATS}
      value={format}
      onRun={() => run(format)}
      onPick={(f) => {
        setFormat(f)
        try {
          localStorage.setItem('export-format', f)
        } catch {
          // storage can be unavailable
        }
        run(f)
      }}
    />
  )
}
