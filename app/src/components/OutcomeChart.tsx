import { useState } from 'react'

export type Slice = { key: string; label: string; value: number }

const R = 36
const C = 2 * Math.PI * R
const GAP = 2.5

export function OutcomeChart({ total, slices }: { total: number; slices: Slice[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const shown = slices.filter((s) => s.value > 0)
  const sum = shown.reduce((a, s) => a + s.value, 0)
  let offset = 0
  return (
    <div className="outcomes">
      <svg className="donut" viewBox="0 0 88 88" role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        <circle className="donut-track" cx="44" cy="44" r={R} />
        {shown.map((s) => {
          const len = (s.value / sum) * C
          const dash = shown.length > 1 ? Math.max(len - GAP, 0.5) : C
          const arc = (
            <circle
              key={s.key}
              className={`donut-arc is-${s.key}`}
              cx="44"
              cy="44"
              r={R}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              data-dim={hover !== null && hover !== s.key}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          offset += len
          return arc
        })}
        <text x="44" y="44" className="donut-total">
          {total}
        </text>
        <text x="44" y="58" className="donut-unit">
          {total === 1 ? 'action' : 'actions'}
        </text>
      </svg>
      <ul className="outcome-legend">
        {slices.map((s) => (
          <li
            key={s.key}
            className={`is-${s.key}`}
            data-dim={hover !== null && hover !== s.key}
            onMouseEnter={() => s.value > 0 && setHover(s.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span>{s.label}</span>
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
