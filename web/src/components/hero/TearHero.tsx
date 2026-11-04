import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { startSmoothScroll } from '#/lib/smooth-scroll'
import { Ticket } from './Ticket'
import { createTear } from './tear'

export type EmojiSet = 'noto' | 'fluent'

// where each shred of paper flies from the tear: x as a share of the scene's width, y of the hand size, and its spin
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

// The hero: the valet ticket starts as the page's big card under the headline. On scroll it shrinks into the
// middle, two yellow emoji hands slide in from the sides (posed after The Creation of Adam) and stop short of it,
// then draw apart, and only then does it tear: the red body comes to hover above the agent's open palm and the
// stub to hang below the client's fingers. Hands: Google's Noto (Apache 2.0) by default, Microsoft's Fluent 3D (MIT) as an option.
export function TearHero({ set = 'noto' }: { set?: EmojiSet }) {
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

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const stopScroll = startSmoothScroll()
      const hands = q('.hands-wrap')[0] as HTMLElement
      const hold = q('.ticket-hold')[0] as HTMLElement
      const W = () => hands.offsetWidth
      const H = () => hands.offsetHeight // the hand size
      const tw = () => hold.offsetWidth
      // how far each hand reaches in: fingertips stop just short of the ticket's ends, never touching it
      const reach = () => W() / 2 - tw() / 2 - 14 - H() * 0.95
      const PULL = 0.12 // how far, in hand sizes, each hand draws back as it tears the ticket
      // Before scrolling the hands sit in a row between the buttons and the big ticket, at the size they keep.
      // Measured on the images: once the client's hand is brought level, the row runs 0.62 of a hand size tall
      // and its lower edge sits 0.86 of a hand size below the top of the hands' frame.
      const row = () => H() * 0.62
      const copyBottom = () => q('.copy')[0].getBoundingClientRect().bottom
      // where the big ticket's top edge sits before scrolling: low, mostly below the fold, with room above it
      // for the hands' row and a clear gap either side of that row
      const cardTop = () => Math.max(copyBottom() + 72 + row() + 64, innerHeight * 0.82)

      gsap.set(hands, { yPercent: -50 })
      gsap.set(q('.handover, .shape'), { xPercent: -50, yPercent: -50 })
      gsap.set(q('.shape'), { opacity: 1, rotate: (i) => SHAPE_TURN[i] })
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: q('.track')[0], start: 'top top', end: '+=150%', scrub: 0.8, invalidateOnRefresh: true },
      })

      const big = () => {
        const wrap = hands.getBoundingClientRect()
        const scale = Math.min(innerWidth - 32, innerWidth * 0.84) / tw() // as wide as the page's content
        const height = tw() * 0.48 * scale
        const centre = wrap.top + wrap.height / 2 // ticket centre sits at the wrap's centre at scale 1
        // the row sits centred in the space between the buttons and the ticket
        const rowBottom = (copyBottom() + cardTop()) / 2 + row() / 2
        const handsY = rowBottom - (wrap.top + H() * 0.86)
        return { scale, y: cardTop() + height / 2 - centre, handsY }
      }
      // at rest the hands sit side by side in the middle of the row, fingertips just short of touching
      const restX = () => W() / 2 - 12 - H() * 0.95

      // 1. from the first scroll, everything moves at once: the copy lifts away, the big ticket shrinks into
      //    the middle, the hands come down level with it and draw apart, and the ticket starts tearing.
      //    The tear runs on into the halves travelling, in one motion: the red body comes to hover above the
      //    agent's open palm and the stub to hang below the client's fingers, never touching either hand.
      const agentX = () => reach() - H() * PULL // each hand's left edge once drawn back
      const clientX = () => W() - H() - reach() + H() * PULL
      const to = () => {
        const mid = H() * 0.5 // the ticket's centre line
        return {
          // the agent's thumb tops out near 0.35 of the hand; the body's lower edge stays clear of it
          body: { x: agentX() + H() * 0.58 - (W() / 2 - tw() * 0.155), y: H() * 0.3 - tw() * 0.19 - mid },
          // the client's fingers bottom out near 0.3; the stub hangs below them, inside the thumb
          stub: { x: clientX() + H() * 0.34 - (W() / 2 + tw() * 0.345), y: H() * 0.3 + tw() * 0.22 + 14 - mid },
        }
      }
      const smooth = (a: number, b: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      const ticket = { p: 0 }
      const draw = () => tear(smooth(0, 0.62, ticket.p), smooth(0.4, 1, ticket.p), to())
      // a refresh re-renders the timeline without firing onUpdate, so redraw the tear after every one
      ScrollTrigger.addEventListener('refresh', draw)
      const move = { duration: 0.5, ease: 'power2.inOut' }
      const part = { duration: 0.34, ease: 'power2.inOut' } // the hands draw apart quicker than the ticket settles
      tl.to(q('.copy'), { y: -140, opacity: 0, duration: 0.25 }, 0)
        .fromTo(hold, { scale: () => big().scale, y: () => big().y }, { scale: 1, y: 0, ...move }, 0)
        .fromTo(q('.hand-agent'), { x: () => restX(), y: () => big().handsY }, { x: () => agentX(), y: 0, ...part }, 0)
        // the client's hand hangs higher in its frame, so it comes down a further 0.24 to share the row
        .fromTo(q('.hand-client'), { x: () => -restX(), y: () => big().handsY + H() * 0.24 }, { x: () => -agentX(), y: 0, ...part }, 0)
        .to(ticket, { p: 1, duration: 0.75, onUpdate: draw }, 0)
        // the line comes up in the gap as the two halves part to either side of it
        .fromTo(q('.handover'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.16, ease: 'power2.out' }, 0.5)

      // the shapes scroll through the pinned scene as if the page were moving under it, each at its own depth:
      // in from below, easing into their places as the line comes up, then only drifting on, so they stay in
      // frame until the next section slides over them. Durations are in screen heights of scroll: the pin lasts 2.7.
      gsap
        .timeline({
          scrollTrigger: { trigger: q('.track')[0], start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true },
        })
        .fromTo(q('.shape'), { y: (i) => SHAPE_DEPTH[i] * innerHeight * 1.3 }, { y: 0, duration: 1.2, ease: 'power1.out' })
        .to(q('.shape'), { y: (i) => -SHAPE_DEPTH[i] * innerHeight * 0.14, duration: 1.5, ease: 'none' })

      // shreds of paper burst from the perforation while it tears, and settle out of sight
      tl.fromTo(
        q('.shred'),
        { x: 0, y: 0, rotate: 0, opacity: 0, scale: 0.4 },
        {
          keyframes: {
            '0%': { opacity: 0 },
            '15%': { opacity: 1, scale: 1 },
            '100%': { opacity: 0 },
          },
          x: (i) => SHREDS[i].x * W(),
          y: (i) => SHREDS[i].y * H(),
          rotate: (i) => SHREDS[i].r,
          duration: 0.32,
          stagger: 0.012,
          ease: 'power2.out',
        },
        0.18,
      )

      // the hands and the big ticket are placed under the copy, so measure again whenever its height changes,
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
        stopScroll()
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
              Hand your agent the keys.<b>Not the whole car.</b>
            </h1>
            <p className="lead">
              Valet lets an AI agent run commands on your customer's machine: only what they approve, enforced on their
              machine, logged for both of you.
            </p>
            <div className="actions">
              <a className="btn btn-ink" href="#access">
                Get early access
              </a>
              <a className="btn btn-ghost" href="#security">
                How it stays safe
              </a>
            </div>
          </div>

          <div className="hands-wrap">
            <div
              className="scene"
              role="img"
              aria-label="Two hands reaching in from opposite sides toward a valet ticket, posed like The Creation of Adam"
            >
              <div className="hand-agent">
                <img src={`/emoji/${set}/palm-up.png`} alt="" draggable={false} />
              </div>
              <div className="ticket-hold">
                <Ticket ref={ticketRef} />
              </div>
              <div className="hand-client">
                <img src={`/emoji/${set}/palm-down.png`} alt="" draggable={false} />
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
