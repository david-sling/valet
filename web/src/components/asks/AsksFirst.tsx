import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// The section after the hero: the moment the client says yes. It plays in two steps while the stage is pinned.
// First the client's Touch ID: a large fingerprint traces in as the finger is held, a ring closes around it, and
// both turn green once it completes. Then the command it allowed runs on their machine. The request itself is left
// unsaid: it can only have come from the other side.
// A fingerprint in two layers: the ridges sit faint, and a bright copy traces over them while the finger is held.
const RIDGES = [
  'M6.2 7.6a7.6 7.6 0 0 1 11.6 0',
  'M4.6 12.2a7.4 7.4 0 0 1 14.8 0v1.3',
  'M7.8 12.6a4.2 4.2 0 0 1 8.4 0v1c0 2.6-1 4.7-2.6 6.3',
  'M12 12.4v1.4c0 3-1.3 5.4-3.4 7',
  'M4.9 15.8c.4 1.7 1.2 3.2 2.4 4.4',
  'M19.2 16.6c-.3 1.3-.8 2.5-1.5 3.6',
]
function Fingerprint() {
  return (
    <svg className="fp" viewBox="0 0 24 24" aria-hidden="true">
      <g className="fp-base">
        {RIDGES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g className="fp-fill">
        {RIDGES.map((d) => (
          <path key={d} d={d} pathLength={100} />
        ))}
      </g>
    </svg>
  )
}

export function AsksFirst() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const ran = q('.ran')[0] as HTMLElement
      // until the command runs, the pad sits in the middle of the proof, where the command will later sit under it
      const centre = () => (ran.offsetHeight + 28) / 2
      const ok = '#1fa35a'

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        // it finishes 40% of a screen before the section lets go, so the next one only comes up once it has
        scrollTrigger: { trigger: q('.asks-track')[0], start: 'top top', end: () => `bottom-=${innerHeight * 0.4} bottom`, scrub: 0.8, invalidateOnRefresh: true },
      })
      // 1. the client holds their finger on Touch ID: the ridges trace in and the ring closes, then both turn green
      // the pad is there from the start, so it slides up over the hero with the heading, still unfilled
      tl.fromTo(q('.touch'), { y: () => centre() }, { y: () => centre(), duration: 0 }, 0)
        .to(q('.touch-pad'), { scale: 0.97, duration: 0.04, ease: 'power2.out' }, 0.12)
        .fromTo(q('.fp-fill path'), { strokeDashoffset: 103 }, { strokeDashoffset: 0, duration: 0.36, ease: 'power1.in' }, 0.14)
        .fromTo(q('.touch-ring .progress'), { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 0.36, ease: 'power1.in' }, 0.14)
        .fromTo(q('.fp-fill, .touch-ring .progress'), { stroke: '#fff' }, { stroke: ok, duration: 0.04 }, 0.5)
        .to(q('.touch-pad'), { scale: 1, duration: 0.05, ease: 'back.out(3)' }, 0.5)
        .fromTo(q('.touch-label .holding'), { opacity: 1 }, { opacity: 0, duration: 0.03 }, 0.51)
        .fromTo(q('.touch-label .done'), { opacity: 0 }, { opacity: 1, duration: 0.03 }, 0.53)
        // 2. the pad steps back, and the command it allowed runs on the client's machine
        .to(q('.touch'), { y: 0, scale: 0.86, duration: 0.12, ease: 'power2.inOut' }, 0.6)
        .fromTo(ran, { opacity: 0, y: 32 }, { opacity: 1, y: 0, duration: 0.1, ease: 'power2.out' }, 0.64)
        .fromTo(q('.ran .out'), { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.76)
        .to({}, { duration: 0.12 }, 0.88) // a short hold on the finished step before the section moves on
    })

    return () => mm.revert()
  }, [])

  return (
    <section className="asks" id="how" ref={rootRef}>
      <div className="asks-track">
        <div className="asks-stage">
          <div className="asks-inner">
            <div className="asks-copy">
              <h2 className="h2">Every command asks first.</h2>
              <p>
                Your agent works inside the ticket the client handed over. Anything outside it waits for a yes on their
                machine, given with their own finger.
              </p>
            </div>

            <div className="asks-proof">
              <div className="touch" role="img" aria-label="Example: the client allows a command with Touch ID">
                <div className="touch-pad">
                  <svg className="touch-ring" viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="46" />
                    <circle className="progress" cx="50" cy="50" r="46" pathLength={100} />
                  </svg>
                  <Fingerprint />
                </div>
                <p className="touch-label" aria-hidden="true">
                  <span className="holding">Allow with Touch ID</span>
                  <span className="done">Allowed once</span>
                </p>
              </div>

              <div className="ran">
                <code className="cmd">system_profiler SPDisplaysDataType</code>
                <span className="status">
                  <span className="risk risk-medium">Medium</span>
                  <span className="outcome is-ok">Allowed once by the client</span>
                </span>
                <code className="out">Chipset Model: Apple M2 Pro · Metal Support: Metal 3</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
