import { forwardRef, useId } from 'react'
import { TICKET as T } from './tear'

// The valet ticket, drawn flat: Valet's red-and-cream mark as a session ticket.
// The perforation mask is in each half's own coordinates, so the holes travel with the halves when it tears.
export const Ticket = forwardRef<SVGSVGElement>(function Ticket(_, ref) {
  const mask = `perf-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const holes = T.bridges.slice(0, -1).map((b) => b.y1 + T.hole / 2)

  return (
    <svg ref={ref} className="ticket" viewBox={`0 0 ${T.w} ${T.h}`} aria-hidden="true">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="-400" y="-400" width="1000" height="900">
          <rect x="-400" y="-400" width="1000" height="900" fill="#fff" />
          {holes.map((cy) => (
            <circle key={cy} cx={T.x} cy={cy} r={T.hole / 2} fill="#000" />
          ))}
          <circle cx={T.x} cy="0" r={T.notch} fill="#000" />
          <circle cx={T.x} cy={T.h} r={T.notch} fill="#000" />
        </mask>
      </defs>
      <g className="body">
        <path
          mask={`url(#${mask})`}
          fill="#e2412f"
          d={`M12 0 H${T.x} V${T.h} H12 A12 12 0 0 1 0 ${T.h - 12} V12 A12 12 0 0 1 12 0Z`}
        />
        <g className="words">
          <text x="18" y="40" fill="#fbf3e3" fontFamily="Funnel Display, sans-serif" fontWeight="800" fontSize="24" letterSpacing="-0.5">
            Valet
          </text>
          <text x="18" y="60" fill="#f6b8ad" fontFamily="Geist Mono, monospace" fontSize="8.5" letterSpacing="0.6">
            SESSION NO. 0042
          </text>
          <text x="18" y="76" fill="#f6b8ad" fontFamily="Geist Mono, monospace" fontSize="8.5" letterSpacing="0.6">
            60 MIN · 3 GRANTS
          </text>
        </g>
      </g>
      <g className="fibres" fill="none" stroke="#b98a4b" strokeLinecap="round" />
      <g className="stub">
        <path
          mask={`url(#${mask})`}
          fill="#efd09b"
          d={`M${T.x} 0 H${T.w - 12} A12 12 0 0 1 ${T.w} 12 V${T.h - 12} A12 12 0 0 1 ${T.w - 12} ${T.h} H${T.x}Z`}
        />
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
