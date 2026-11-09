import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { startSmoothScroll } from '#/lib/smooth-scroll'
import { Ticket } from './Ticket'
import { createTear } from './tear'
import { InstallSkill } from '../Links'

// where each shred of paper flies from the tear: x as a share of the scene's width, y of its frame's height, and its spin
const SHREDS = [
  { x: 0.16, y: -0.9, r: 220 }, { x: -0.12, y: -1.1, r: -160 }, { x: 0.22, y: 0.7, r: 300 },
  { x: -0.2, y: 0.8, r: -240 }, { x: 0.08, y: -1.4, r: 140 }, { x: -0.05, y: 1.2, r: -320 },
  { x: 0.28, y: -0.3, r: 180 }, { x: -0.26, y: -0.5, r: -200 }, { x: 0.12, y: 1.5, r: 260 },
  { x: -0.15, y: -1.6, r: -120 }, { x: 0.3, y: 0.3, r: 340 }, { x: -0.3, y: 0.2, r: -280 },
]
// each shape's turn, in degrees, and its depth: how fast it scrolls past against the page, so nearer (bigger)
// shapes travel further than the small ones behind them
const SHAPE_TURN = [0, 12, -14, 8, 0, 0, 0, 18, -10]
const SHAPE_DEPTH = [1.15, 1.3, 1.2, 0.95, 0.75, 0.9, 0.7, 0.8, 0.75]

function Sparkle({ className, left, top }: { className: string; left: string; top: string }) {
  return (
    <svg className={`shape sparkle ${className}`} style={{ left, top }} viewBox="0 0 24 24">
      <path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0Z" />
    </svg>
  )
}

// The hero: the valet ticket starts as the page's big card under the headline. On scroll it settles into the
// middle at the same size and tears along its perforation: the red body moves straight away from the stub, and the
// line appears in the gap. Lying flat, the body slides left and the stub stays; upright, on a phone, the body rises,
// the stub swings open. Last, on both, the stub falls away to the bottom right.
export function TearHero({ skill }: { skill: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const ticketRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const svg = ticketRef.current
    if (!root || !svg) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const tear = createTear(svg)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: reduce)', () => {
      root.dataset.motion = 'reduced'
      root.dataset.ready = ''
      return () => delete root.dataset.motion
    })

    // the scene is rebuilt when the screen crosses into or out of the upright layout, whose timing differs
    mm.add({ motion: '(prefers-reduced-motion: no-preference)', upright: '(max-width: 760px)' }, (ctx) => {
      if (!ctx.conditions?.motion) return
      const upright = Boolean(ctx.conditions.upright)
      const stopScroll = startSmoothScroll()
      const frame = q('.scene-wrap')[0] as HTMLElement
      const hold = q('.ticket-hold')[0] as HTMLElement
      const stage = q('.stage')[0] as HTMLElement
      const handover = q('.handover')[0] as HTMLElement
      // Sizes are measured once per layout and reused: reading them every frame, straight after the scene has moved,
      // would make the browser lay the page out again each time. They are measured afresh on every refresh.
      const measure = () => ({
        W: frame.offsetWidth,
        // the stage's height: the screen with the address bar showing, which holds still as the bar hides and shows
        SH: stage.offsetHeight,
        // the strip the phone's gesture bar covers at the bottom, if the page runs on under it
        BAR: parseFloat(getComputedStyle(stage).paddingBottom) || 0,
        H: frame.offsetHeight, // the scene's frame, which the shreds fly out to
        tw: hold.offsetWidth,
        lineW: handover.offsetWidth,
        lineH: handover.offsetHeight,
      })
      let sizes: ReturnType<typeof measure> | null = null
      const size = () => (sizes ??= measure())
      const forget = () => {
        sizes = null
      }
      ScrollTrigger.addEventListener('refreshInit', forget)
      const W = () => size().W
      const SH = () => size().SH
      const BAR = () => size().BAR
      const H = () => size().H
      const tw = () => size().tw
      // On a narrow screen the ticket stands upright, turned a quarter clockwise: the red body on top, the stub below.
      const vertical = () => upright
      // The big card first settles into the middle, whole and in view, and only then does it tear
      const T0 = 0.5
      // the timeline's landmarks: where the halves start to part, and where it ends, the next section having covered
      // the scene; the halves used to stop at T0 + 0.75, U_GAP of the way through the body's drift
      const PARTS = T0 + 0.75 * 0.4
      const END = 2.2
      const U_GAP = (T0 + 0.75 - PARTS) / (END - PARTS)
      // Measured from the layout, never the screen: the page can load (or refresh) scrolled anywhere, and the copy
      // carries a transform mid-scroll. The copy and the scene both sit in the pinned stage, which starts at the top.
      const copy = q('.copy')[0] as HTMLElement
      const copyBottom = () => copy.offsetTop + copy.offsetHeight
      // where the big ticket's top edge sits before scrolling: under the buttons, running on below the fold; a wide
      // screen leaves more room above it
      const cardTop = () => copyBottom() + (upright ? 64 : 88)

      gsap.set(frame, { yPercent: -50 })
      gsap.set(q('.handover, .shape'), { xPercent: -50, yPercent: -50 })
      gsap.set(q('.shape'), { opacity: 1, rotate: (i) => SHAPE_TURN[i] })
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        // the scene runs until the next section has fully covered it (see .track in styles.css)
        scrollTrigger: { trigger: q('.track')[0], start: 'top top', end: '+=300%', scrub: 0.8, invalidateOnRefresh: true },
      })

      // The ticket keeps one size throughout: upright, its full size; lying flat, as wide as the page's content, or
      // as large as fits between the header and the bottom of the screen, and never taller than MAX_H, so it does
      // not sprawl on a big screen
      const MAX_H = 560
      const scale = () =>
        vertical() ? 1 : Math.min(Math.min(innerWidth - 32, innerWidth * 0.84) / tw(), Math.min(SH() - 104, MAX_H) / (tw() * 0.48))
      // where it settles, in the middle of the space between the header and the bottom of the screen; y is from the
      // middle of the screen
      const settleY = () => (88 - 16 - BAR()) / 2
      const startY = () => {
        const centre = frame.offsetTop // the scene's frame is pulled up by half its height, so its top is its centre
        return cardTop() + (tw() * (vertical() ? 1 : 0.48) * scale()) / 2 - centre
      }
      // Then it tears, and the red body moves straight away from the stub, which stays: up when it stands upright,
      // left when it lies flat. The line appears in the gap. Then the stub falls away to the bottom right, before
      // the next section comes up.
      // the gap: room for the line, with air around it, and upright around the corner of the swung stub
      const gap = () => (vertical() ? size().lineH + 104 : size().lineW + 64)
      // the perforation's place on screen, against the ticket's centre: 0.19 of its length towards the stub
      const perf = () => tw() * 0.19 * scale()
      const fall = { p: 0 }
      // The body never stops: it gathers speed as it parts from the stub, then slows exponentially, drifting on until
      // the next section has covered the scene. u runs 0 to 1 over that time; the curve starts at rest, and has
      // opened the full gap by U_GAP, where the halves used to come to a stop.
      const drift = { u: 0 }
      const TAU = 0.12
      const curve = (u: number) => 1 - (1 + u / TAU) * Math.exp(-u / TAU)
      const shift = () => (gap() * curve(drift.u)) / curve(U_GAP) // on screen, from the perforation
      const to = () =>
        // in the ticket's own frame and size: upright, it is turned a quarter clockwise, so screen up is its -x
        vertical()
          ? { body: { x: -shift(), y: 0, at: 1 }, stub: { x: fall.p * SH(), y: -fall.p * W() * 0.3, turn: fall.p * 50 } }
          : {
              body: { x: -shift() / scale(), y: 0, at: 1 },
              stub: { x: (fall.p * W() * 0.2) / scale(), y: (fall.p * SH()) / scale(), turn: fall.p * 50 },
            }
      const smooth = (a: number, b: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      const ticket = { p: 0 }
      // The line rides on the red body's trailing edge, just below it upright and just right of it lying flat, and
      // shows only as much of itself as the gap has room for, so it never covers either half
      const AIR = 20 // between the line and each half
      const placeLine = (t: number, part: number) => {
        // how far the body's edge has moved from the perforation, on screen: lying flat it first draws back a little
        // as the fibres stretch (16 of the ticket's 200 units), then travels on
        const pull = vertical() ? 0 : 16 * t * t * (tw() / 200) * scale()
        const away = pull * (1 - part) + shift()
        if (vertical()) {
          const corner = 44 * t // the swung stub's corner rises into the gap
          const shown = Math.min(size().lineH, Math.max(0, away - AIR * 2 - corner))
          gsap.set(handover, {
            opacity: shown > 0 ? 1 : 0,
            x: 0,
            y: settleY() + perf() - away + AIR + size().lineH / 2,
            clipPath: `inset(-20% -10% ${size().lineH - shown}px -10%)`,
          })
        } else {
          const shown = Math.min(size().lineW, Math.max(0, away - AIR * 2))
          gsap.set(handover, {
            opacity: shown > 0 ? 1 : 0,
            x: perf() - away + AIR + size().lineW / 2,
            y: settleY(),
            clipPath: `inset(-20% ${size().lineW - shown}px -20% -10%)`,
          })
        }
      }
      // upright the stub swings open from the perforation; lying flat, nothing turns and the body pulls straight away
      const draw = () => {
        const t = smooth(0, 0.62, ticket.p)
        const part = smooth(0.4, 1, ticket.p)
        tear(t, part, to(), 0, 0, upright)
        placeLine(t, part)
      }
      // a refresh re-renders the timeline without firing onUpdate, so redraw the tear after every one
      ScrollTrigger.addEventListener('refresh', draw)
      const move = { duration: 0.5, ease: 'power2.inOut' }
      tl.to(q('.copy'), { y: -140, opacity: 0, duration: 0.25 }, 0)
        .fromTo(
          hold,
          { scale: () => scale(), y: () => startY(), rotate: () => (vertical() ? 90 : 0) },
          { scale: () => scale(), y: () => settleY(), rotate: () => (vertical() ? 90 : 0), ...move },
          0,
        )
        .to(ticket, { p: 1, duration: 0.75, onUpdate: draw }, T0)
      // once the line is in full view the stub falls away out of the bottom of the screen
      tl.to(fall, { p: 1, duration: 0.35, ease: 'power2.in', onUpdate: draw }, T0 + 0.9)
        // the body drifts from the moment it parts until the scene ends, under the next section
        .fromTo(drift, { u: 0 }, { u: 1, duration: END - PARTS, onUpdate: draw }, PARTS)

      // the shapes scroll through the pinned scene as if the page were moving under it, each at its own depth:
      // in from below, easing into their places as the line comes up, then only drifting on, so they stay in
      // frame until the next section slides over them. Durations are in screen heights of scroll: the pin lasts 3.6.
      gsap
        .timeline({
          scrollTrigger: { trigger: q('.track')[0], start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true },
        })
        .fromTo(q('.shape'), { y: (i) => SHAPE_DEPTH[i] * innerHeight * 1.3 }, { y: 0, duration: 1.2, ease: 'power1.out' })
        .to(q('.shape'), { y: (i) => -SHAPE_DEPTH[i] * innerHeight * 0.14, duration: 1.5, ease: 'none' })

      // shreds of paper burst from the perforation while it tears, and settle out of sight
      tl.fromTo(
        q('.shred'),
        // from the perforation: below the middle when upright, right of it lying flat
        { x: () => (vertical() ? 0 : perf()), y: () => settleY() + (vertical() ? perf() : 0), rotate: 0, opacity: 0, scale: 0.4 },
        {
          keyframes: {
            '0%': { opacity: 0 },
            '15%': { opacity: 1, scale: 1 },
            '100%': { opacity: 0 },
          },
          x: (i) => (vertical() ? 0 : perf()) + SHREDS[i].x * W(),
          y: (i) => settleY() + (vertical() ? perf() : 0) + SHREDS[i].y * H(),
          rotate: (i) => SHREDS[i].r,
          duration: 0.32,
          stagger: 0.012,
          ease: 'power2.out',
        },
        T0 + 0.18,
      )

      // the big ticket is placed under the copy, so measure again whenever its height changes,
      // as it does once the web fonts arrive
      let copyHeight = 0
      const watchCopy = new ResizeObserver(([entry]) => {
        if (Math.abs(entry.contentRect.height - copyHeight) < 1) return
        copyHeight = entry.contentRect.height
        ScrollTrigger.refresh()
      })
      watchCopy.observe(q('.copy')[0])
      root.dataset.ready = ''
      return () => {
        watchCopy.disconnect()
        ScrollTrigger.removeEventListener('refresh', draw)
        ScrollTrigger.removeEventListener('refreshInit', forget)
        stopScroll()
        fall.p = 0
        tear(0, 0, { body: { x: 0, y: 0 }, stub: { x: 0, y: 0 } })
      }
    })

    return () => mm.revert()
  }, [])

  return (
    <div className="tear-hero" ref={rootRef}>
      <div className="track">
        <div className="stage">
          <div className="copy">
            <h1 className="display">
              Let your agent drive.<b>Keep the trunk locked.</b>
            </h1>
            <p className="lead">
              Valet lets an AI agent run commands on your customer's machine: only what they approve, enforced on their
              machine, logged for both of you.
            </p>
            <InstallSkill skill={skill} />
          </div>

          <div className="scene-wrap">
            <div
              className="scene"
              role="img"
              aria-label="A valet ticket tearing in two along its perforation"
            >
              <div className="ticket-hold">
                <Ticket ref={ticketRef} />
              </div>
            </div>
          </div>

          <p className="h2 handover">
            <span>Every session starts</span> <span>with a handover.</span>
          </p>

          {/* the scene's confetti: shreds of ticket that fly from the tear, and shapes that come up around the halves */}
          <div className="shreds" aria-hidden="true">
            {SHREDS.map((_, i) => (
              <span key={i} className={`shred ${i % 3 === 0 ? 'is-red' : ''}`} />
            ))}
          </div>
          <div className="shapes" aria-hidden="true">
            <span className="shape circle sky" style={{ left: '12%', top: '24%' }} />
            <span className="shape block sun" style={{ left: '84%', top: '20%' }} />
            <span className="shape pill pink" style={{ left: '20%', top: '80%' }} />
            <span className="shape square night" style={{ left: '80%', top: '76%' }} />
            <span className="shape dot peach" style={{ left: '58%', top: '16%' }} />
            <span className="shape ring" style={{ left: '93%', top: '52%' }} />
            <Sparkle className="sun" left="34%" top="18%" />
            <Sparkle className="pink" left="66%" top="85%" />
            <Sparkle className="sky" left="6%" top="56%" />
          </div>
        </div>
      </div>
    </div>
  )
}
