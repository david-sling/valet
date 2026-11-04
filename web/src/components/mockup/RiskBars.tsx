import { RISK_WORD } from './engine'
import type { Risk } from './engine'

// Risk as a meter: one green bar for low, two yellow for medium, three red for high. The count carries the level
// without colour; critical adds its word, because it's rare and can never be pre-granted.
const FILLED: Record<Risk, number> = { low: 1, medium: 2, high: 3, critical: 3 }

export function RiskBars({ risk }: { risk: Risk }) {
  return (
    <span className={`bars is-${risk}`} role="img" aria-label={`${RISK_WORD[risk]} risk`} title={`${RISK_WORD[risk]} risk`}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= FILLED[risk] ? 'on' : undefined} />
      ))}
      {risk === 'critical' && <b>Critical</b>}
    </span>
  )
}
