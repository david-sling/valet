// The valet ticket's shape and its tear, in the ticket's own viewBox units.
// Body 0..x is red and goes to the agent; stub x..w is cream and goes to the client.
// Paper bridges join them between the perforation holes; tearing stretches them into fibres that snap.

export type Bridge = { y0: number; y1: number; mid: number }

export const TICKET = (() => {
  const w = 200
  const h = 96
  const x = 138
  const notch = 6
  const hole = 4.4
  const holes = 9
  const span = h - 2 * notch
  const bridge = (span - holes * hole) / (holes + 1)
  const bridges: Bridge[] = []
  for (let i = 0; i <= holes; i += 1) {
    const y0 = notch + i * (bridge + hole)
    bridges.push({ y0, y1: y0 + bridge, mid: y0 + bridge / 2 })
  }
  return {
    w,
    h,
    x,
    notch,
    hole,
    bridges,
    stretch: 10, // how far a fibre stretches before it snaps
    limit: (26 * Math.PI) / 180, // how far the stub swings open
    hinge: { x, y: h - notch }, // the stub swings open from the bottom of the perforation
  }
})()

type Offset = { x: number; y: number }
export type TearTargets = { body: Offset; stub: Offset }

const f = (n: number) => n.toFixed(2)

// Returns a function that draws the tear for a scroll position. tear 0..1 swings the stub open while the
// fibres stretch and snap; part 0..1 carries each half's centre to an offset in pixels from where it started,
// easing it down in size by `shrinkBy` on the way. The two overlap, so the tear runs straight on into the halves
// travelling.
export function createTear(svg: SVGSVGElement) {
  const T = TICKET
  const body = svg.querySelector<SVGGElement>('.body')!
  const stub = svg.querySelector<SVGGElement>('.stub')!
  const layer = svg.querySelector<SVGGElement>('.fibres')!
  const ns = 'http://www.w3.org/2000/svg'
  layer.replaceChildren()
  const fibres = T.bridges.map(() => [0, 1].map(() => layer.appendChild(document.createElementNS(ns, 'path'))))

  return (tear: number, part: number, to: TearTargets, shrinkBy = 0.22) => {
    const k = svg.clientWidth / T.w || 1 // px per unit
    const th = tear * T.limit
    const slack = 12 * tear * tear // the stub also pulls away a little, so the last fibres by the hinge go too
    const cos = Math.cos(th)
    const sin = Math.sin(th)
    const shrink = 1 - shrinkBy * part // each half eases down in size as it travels
    const sc = (cx: number, cy: number) => `translate(${cx} ${cy}) scale(${f(shrink)}) translate(${-cx} ${-cy})`

    // the stub turns about the hinge, so its centre drifts; aim the centre, not the hinge, at its target
    const turn = th + (part * 12 * Math.PI) / 180
    const cx = (T.x + T.w) / 2 - T.hinge.x
    const cy = T.h / 2 - T.hinge.y
    const aimX = cx - (cx * Math.cos(turn) - cy * Math.sin(turn)) + to.stub.x / k
    const aimY = cy - (cx * Math.sin(turn) + cy * Math.cos(turn)) + to.stub.y / k
    const sx = slack + (aimX - slack) * part
    const sy = aimY * part
    stub.setAttribute(
      'transform',
      `translate(${f(sx)} ${f(sy)}) rotate(${f((turn * 180) / Math.PI)} ${T.hinge.x} ${T.hinge.y}) ${sc((T.x + T.w) / 2, T.h / 2)}`,
    )
    body.setAttribute(
      'transform',
      `translate(${f((part * to.body.x) / k)} ${f((part * to.body.y) / k)}) rotate(${f(part * -8)} ${T.x / 2} ${T.h / 2}) ${sc(T.x / 2, T.h / 2)}`,
    )

    const fade = Math.max(0, 1 - part * 5) // any last fibres let go as the halves start to travel
    T.bridges.forEach((b, i) => {
      const [near, far] = fibres[i]
      // where this bridge's stub edge has moved to, against where it was torn from
      const dy = b.mid - T.hinge.y
      const tx = T.hinge.x - dy * sin + slack
      const ty = T.hinge.y + dy * cos
      const gx = tx - T.x
      const gy = ty - b.mid
      const gap = Math.hypot(gx, gy)
      const show = (opacity: number, width: number) => {
        near.style.opacity = far.style.opacity = String(opacity)
        near.style.strokeWidth = far.style.strokeWidth = String(width)
      }
      if (fade === 0 || gap < 0.3) return show(0, 0)
      if (gap < T.stretch) {
        // still holding: two fibres stretch and thin across the gap, sagging slightly
        const sag = gap * 0.18
        near.setAttribute('d', `M${f(T.x)},${f(b.mid - 1.4)}Q${f(T.x + gx / 2)},${f(b.mid - 1.4 + gy / 2 + sag)} ${f(tx)},${f(ty - 1.4)}`)
        far.setAttribute('d', `M${f(T.x)},${f(b.mid + 1.4)}Q${f(T.x + gx / 2)},${f(b.mid + 1.4 + gy / 2 - sag)} ${f(tx)},${f(ty + 1.4)}`)
        return show(fade, 1.7 - 1.15 * (gap / T.stretch))
      }
      // snapped: the loose ends curl back towards their own edges as the gap widens
      const left = Math.max(0, 1 - (gap - T.stretch) / T.stretch) ** 2
      const len = T.stretch * 0.5 * left
      const ux = gx / gap
      const uy = gy / gap
      near.setAttribute('d', `M${f(T.x)},${f(b.mid)}L${f(T.x + ux * len)},${f(b.mid + uy * len)}`)
      far.setAttribute('d', `M${f(tx)},${f(ty)}L${f(tx - ux * len)},${f(ty - uy * len)}`)
      show(left * fade, 0.9)
    })
  }
}
