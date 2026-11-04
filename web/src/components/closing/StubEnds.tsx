import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Ticket } from '../hero/Ticket'
import { createTear } from '../hero/tear'
import { EARLY_ACCESS_FORM } from '#/lib/links'

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void }
  }
}

const TALLY_WIDGET = 'https://tally.so/widgets/embed.js'

// The early-access form, embedded from Tally. Tally's widget script loads the frame and keeps its height matched
// to the form; if the script can't load, the frame is loaded directly at its starting height instead.
function EarlyAccessForm() {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const fallback = () => {
      if (!frame.src) frame.src = frame.dataset.tallySrc ?? ''
    }
    if (window.Tally) return window.Tally.loadEmbeds()
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TALLY_WIDGET}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = TALLY_WIDGET
      script.async = true
      document.body.appendChild(script)
    }
    const load = () => (window.Tally ? window.Tally.loadEmbeds() : fallback())
    script.addEventListener('load', load)
    script.addEventListener('error', fallback)
    return () => {
      script.removeEventListener('load', load)
      script.removeEventListener('error', fallback)
    }
  }, [])

  return (
    <div className="early-form">
      <iframe ref={frameRef} data-tally-src={EARLY_ACCESS_FORM} loading="lazy" width="100%" height="300" title="Valet early access sign-up" />
      <noscript>
        <a className="btn btn-ink" href="https://tally.so/r/VpGgdv">
          Get early access
        </a>
      </noscript>
    </div>
  )
}

// The closing: the ticket story ends where it began. The two halves come back in from either side and meet at the
// perforation, the hero's tear run backwards, because at the end of a session both sides hold matching halves: the
// same signed record. Then the one action the page asks for, the early-access form, and the footer.
// The markup is the finished state, the ticket whole, which is what shows without the scroll animation.

export function StubEnds() {
  const rootRef = useRef<HTMLElement>(null)
  const ticketRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const svg = ticketRef.current
    if (!root || !svg) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const tear = createTear(svg)
    const mm = gsap.matchMedia()
    // how far the scroll has brought the halves together: 1 apart, 0 whole
    const ticket = { p: 0 }

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const hold = q('.rejoin')[0] as HTMLElement
      // where each half starts, in pixels from its place in the whole ticket: well apart, the stub a little lower
      const apart = () => ({
        body: { x: -Math.min(innerWidth * 0.3, hold.offsetWidth * 0.9), y: -18 },
        stub: { x: Math.min(innerWidth * 0.3, hold.offsetWidth * 0.9), y: 26 },
      })
      const smooth = (a: number, b: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      // p runs from 1, apart, to 0, whole: the halves travel in first, and the perforation closes as they meet
      const draw = () => tear(smooth(0, 0.62, ticket.p), smooth(0.4, 1, ticket.p), apart(), 0)
      ScrollTrigger.addEventListener('refresh', draw)
      gsap
        .timeline({ scrollTrigger: { trigger: hold, start: 'top 90%', end: 'center 50%', scrub: 0.8 } })
        .fromTo(ticket, { p: 1 }, { p: 0, duration: 1, ease: 'none', onUpdate: draw })
      draw()
      return () => {
        ScrollTrigger.removeEventListener('refresh', draw)
        ticket.p = 0
        tear(0, 0, { body: { x: 0, y: 0 }, stub: { x: 0, y: 0 } }, 0)
      }
    })

    // Once whole, the stub can be pulled off by hand: dragging it first swings it open from the perforation while
    // the fibres stretch, then, further out, they snap and the stub follows the pointer. Let go and it springs back.
    const stub = svg.querySelector<SVGGElement>('.stub')!
    const pull = { x: 0, y: 0 }
    const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
    const drawPull = () => {
      const reach = Math.hypot(pull.x, pull.y)
      const part = Math.min(1, Math.max(0, (reach - 60) / 140))
      tear(Math.min(1, reach / 90), part, { body: { x: 0, y: 0 }, stub: { x: pull.x, y: pull.y } }, 0, 0) // the body stays put
    }
    let start: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (ticket.p > 0.01) return // only once the scroll has brought it back together
      gsap.killTweensOf(pull)
      start = { x: e.clientX - pull.x, y: e.clientY - pull.y }
      stub.setPointerCapture(e.pointerId)
      root.dataset.pulling = ''
    }
    const onMove = (e: PointerEvent) => {
      if (!start) return
      pull.x = e.clientX - start.x
      pull.y = e.clientY - start.y
      drawPull()
    }
    const onUp = () => {
      if (!start) return
      start = null
      delete root.dataset.pulling
      gsap.to(pull, { x: 0, y: 0, duration: still() ? 0 : 0.9, ease: 'elastic.out(1, 0.6)', onUpdate: drawPull })
    }
    stub.addEventListener('pointerdown', onDown)
    stub.addEventListener('pointermove', onMove)
    stub.addEventListener('pointerup', onUp)
    stub.addEventListener('pointercancel', onUp)

    return () => {
      stub.removeEventListener('pointerdown', onDown)
      stub.removeEventListener('pointermove', onMove)
      stub.removeEventListener('pointerup', onUp)
      stub.removeEventListener('pointercancel', onUp)
      gsap.killTweensOf(pull)
      mm.revert()
    }
  }, [])

  return (
    <section className="closing" id="access" ref={rootRef}>
      <div className="closing-inner">
        <div className="rejoin">
          <Ticket ref={ticketRef} />
        </div>
        <h2 className="h2">Every session ends with the stub.</h2>
        <p className="lead">
          When it’s over, the customer and your agent hold matching halves: the same signed record of every step.
        </p>
        <EarlyAccessForm />
      </div>

      <footer className="site-foot">
        <a className="brand" href="/">
          <img src="/brand/valet-mark.svg" alt="" width="22" height="22" />
          Valet
        </a>
        <nav aria-label="Footer">
          <a href="#how">How it works</a>
          <a href="#clients">For clients</a>
          <a href="#vendors">For vendors</a>
          <a href="#security">Security</a>
        </nav>
        <p>© 2026 Valet</p>
      </footer>
    </section>
  )
}
