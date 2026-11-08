import { useEffect, useRef, useState } from 'react'

export type MoreItem = { key: string; label: string; hint?: string; icon: React.ReactNode; danger?: boolean; onPick: () => void }

export function MoreMenu({ label, items }: { label: string; items: MoreItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close, true)
    }
  }, [open])

  return (
    <div className="more" ref={ref}>
      <button className="mbtn mbtn-ghost mbtn-sm more-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.1" />
          <circle cx="8" cy="8" r="1.1" />
          <circle cx="12.5" cy="8" r="1.1" />
        </svg>
      </button>
      {open && (
        <div className="split-menu more-menu" role="menu">
          {items.map((i) => (
            <button
              key={i.key}
              role="menuitem"
              className={i.danger ? 'is-danger' : undefined}
              onClick={() => {
                setOpen(false)
                i.onPick()
              }}
            >
              <span className="more-icon" aria-hidden="true">
                {i.icon}
              </span>
              <b>{i.label}</b>
              {i.hint && <small>{i.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
