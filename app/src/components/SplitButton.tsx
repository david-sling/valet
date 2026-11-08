import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type SplitOption<K extends string> = { key: K; label: string; hint?: string }

// The left side runs the current choice; the arrow opens a menu to change it.
export function SplitButton<K extends string>({
  label,
  icon,
  ink,
  disabled,
  menuLabel,
  options,
  value,
  onRun,
  onPick,
}: {
  label: string
  icon?: React.ReactNode
  ink?: boolean
  disabled?: boolean
  menuLabel: string
  options: SplitOption<K>[]
  value: K
  onRun: () => void
  onPick: (k: K) => void
}) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !ref.current || !menuRef.current) return setUp(false)
    let top = 0
    let bottom = window.innerHeight
    for (let el = ref.current.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowY === 'visible') continue
      const r = el.getBoundingClientRect()
      top = Math.max(top, r.top)
      bottom = Math.min(bottom, r.bottom)
    }
    const r = ref.current.getBoundingClientRect()
    const need = menuRef.current.offsetHeight + 6
    setUp(bottom - r.bottom < need && r.top - top > bottom - r.bottom)
  }, [open])

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
    <div className={ink ? 'split is-ink' : 'split'} ref={ref}>
      <button className="split-main" onClick={onRun} disabled={disabled}>
        {icon}
        {label}
      </button>
      <button className="split-more" aria-label={menuLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className={up ? 'split-menu is-up' : 'split-menu'} role="menu" ref={menuRef}>
          {options.map((o) => (
            <button
              key={o.key}
              role="menuitemradio"
              aria-checked={o.key === value}
              onClick={() => {
                setOpen(false)
                onPick(o.key)
              }}
            >
              <b>{o.label}</b>
              {o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
