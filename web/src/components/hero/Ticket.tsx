import { forwardRef } from 'react'
import { TICKET as T } from './tear'

// The valet ticket, drawn flat: Valet's red-and-cream mark as a session ticket.
// Each half's outline is cut to shape: the notches at both ends of the perforation, a semicircular bite for each
// half of a hole along it, and, on the red half, the logo's slot. Cut into the outlines rather than masked, so a
// phone has nothing extra to redraw as the halves move.
const R = 12 // the ticket's corner radius
const n = T.notch
const r = T.hole / 2
const holes = T.bridges.slice(0, -1).map((b) => b.y1 + r)
// the red half: round the corners, then down the perforation, biting into the red side for each hole
const BODY =
  `M${R} 0 H${T.x - n} A${n} ${n} 0 0 0 ${T.x} ${n} ` +
  holes.map((cy) => `V${cy - r} A${r} ${r} 0 0 0 ${T.x} ${cy + r} `).join('') +
  `V${T.h - n} A${n} ${n} 0 0 0 ${T.x - n} ${T.h} H${R} A${R} ${R} 0 0 1 0 ${T.h - R} V${R} A${R} ${R} 0 0 1 ${R} 0Z ` +
  // the logo's slot, near the red end: a rounded bar across the ticket, at the logo's proportions
  'M18 42.1 A6.5 6.5 0 0 1 31 42.1 V53.9 A6.5 6.5 0 0 1 18 53.9Z'
// the stub: round its corners, then back up the perforation, biting into the cream side for each hole
const STUB =
  `M${T.x + n} 0 H${T.w - R} A${R} ${R} 0 0 1 ${T.w} ${R} V${T.h - R} A${R} ${R} 0 0 1 ${T.w - R} ${T.h} H${T.x + n} ` +
  `A${n} ${n} 0 0 0 ${T.x} ${T.h - n} ` +
  [...holes].reverse().map((cy) => `V${cy + r} A${r} ${r} 0 0 0 ${T.x} ${cy - r} `).join('') +
  `V${n} A${n} ${n} 0 0 0 ${T.x + n} 0Z`

export const Ticket = forwardRef<SVGSVGElement>(function Ticket(_, ref) {
  return (
    <svg ref={ref} className="ticket" viewBox={`0 0 ${T.w} ${T.h}`} aria-hidden="true">
      <g className="body">
        <path fill="#e2412f" fillRule="evenodd" d={BODY} />
        <g className="words">
          <text x="40" y="40" fill="#fbf3e3" fontFamily="Funnel Display, sans-serif" fontWeight="800" fontSize="24" letterSpacing="-0.5">
            Valet
          </text>
          <text x="40" y="60" fill="#f6b8ad" fontFamily="Geist Mono, monospace" fontSize="8.5" letterSpacing="0.3">
            SESSION NO. 0042
          </text>
          <text x="40" y="76" fill="#f6b8ad" fontFamily="Geist Mono, monospace" fontSize="8.5" letterSpacing="0.3">
            60 MIN · 3 GRANTS
          </text>
        </g>
      </g>
      <g className="fibres" fill="none" stroke="#b98a4b" strokeLinecap="round" />
      <g className="stub">
        <path fill="#efd09b" d={STUB} />
        <g className="words">
          <text
            transform={`translate(${T.x + 26} ${T.h / 2}) rotate(-90)`}
            textAnchor="middle"
            fill="#8a6a35"
            fontFamily="Geist Mono, monospace"
            fontSize="8"
            letterSpacing="0.8"
          >
            CLIENT COPY
          </text>
          <text
            transform={`translate(${T.x + 42} ${T.h / 2}) rotate(-90)`}
            textAnchor="middle"
            fill="#5c4520"
            fontFamily="Funnel Display, sans-serif"
            fontWeight="800"
            fontSize="12"
          >
            0042
          </text>
        </g>
      </g>
    </svg>
  )
})
