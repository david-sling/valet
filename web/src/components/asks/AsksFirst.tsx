import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// The section after the hero: a session playing out on the client's machine. Commands inside the ticket's grants
// run; one outside them raises Valet's approval prompt on the client's screen, which the client allows with Touch ID;
// one aimed at a protected location is blocked without asking. The prompt follows DESIGN.md's Approval prompt spec.
// A fingerprint for the Touch ID button, in two layers: the ridges sit faint, and a bright copy traces over them
// while the finger is held down, so the press reads as a long one that completes.
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
      const clock = { left: 45 }
      const countdown = q('.timeout-note b')[0] as HTMLElement
      const tick = () => (countdown.textContent = `0:${String(Math.ceil(clock.left)).padStart(2, '0')}`)

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: q('.asks-track')[0], start: 'top top', end: 'bottom bottom', scrub: 0.8 },
      })
      const rise = { opacity: 0, y: 18 }
      const settle = { opacity: 1, y: 0, duration: 0.06, ease: 'power2.out' }

      // 1. a command inside the grants just runs
      tl.fromTo(q('.row-1'), rise, settle, 0.02)
        .fromTo(q('.row-1 .out'), { opacity: 0 }, { opacity: 1, duration: 0.04 }, 0.08)
        // 2. one outside them waits, and the prompt comes up on the client's screen
        .fromTo(q('.row-2'), rise, settle, 0.16)
        .fromTo(q('.prompt'), { opacity: 0, y: 48, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.1, ease: 'power3.out' }, 0.24)
        .fromTo(q('.timeout-bar i'), { scaleX: 1 }, { scaleX: 0.72, duration: 0.36 }, 0.3)
        .fromTo(clock, { left: 45 }, { left: 33, duration: 0.36, onUpdate: tick }, 0.3)
        // the client allows it, deliberately: the button fills while Touch ID is held
        .fromTo(q('.allow .hold'), { scaleX: 0 }, { scaleX: 1, duration: 0.14, ease: 'power1.in' }, 0.48)
        .fromTo(q('.fp-fill path'), { strokeDashoffset: 103 }, { strokeDashoffset: 0, duration: 0.14, ease: 'power1.in' }, 0.48)
        .to(q('.allow'), { scale: 0.97, duration: 0.02, yoyo: true, repeat: 1 }, 0.62)
        .to(q('.prompt'), { opacity: 0, y: 32, scale: 0.97, duration: 0.07, ease: 'power2.in' }, 0.66)
        .to(q('.row-2 .waiting'), { opacity: 0, duration: 0.03 }, 0.7)
        .fromTo(q('.row-2 .allowed'), { opacity: 0 }, { opacity: 1, duration: 0.04 }, 0.71)
        .fromTo(q('.row-2 .out'), { opacity: 0, height: 0 }, { opacity: 1, height: 'auto', duration: 0.05 }, 0.72)
        // 3. a protected location is refused outright, without a prompt
        .fromTo(q('.row-3'), rise, settle, 0.8)
        .to({}, { duration: 0.1 }, 0.9) // a short hold on the finished feed before the section scrolls on
      return () => (countdown.textContent = '0:45')
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
                machine, and protected files stay out of reach either way.
              </p>
            </div>

            <div className="asks-proof">
              <div className="feed" aria-label="Example session on the client's machine">
                <div className="feed-bar" aria-hidden="true">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>Session 0042 · Acme support agent</span>
                </div>
                <ol className="feed-rows">
                  <li className="row row-1">
                    <code className="cmd">log show --last 1h --predicate 'process == "Acme"'</code>
                    <span className="status">
                      <span className="risk risk-low">Low</span>
                      <span className="outcome is-ok">Ran · inside the grants</span>
                    </span>
                    <code className="out">Acme[4127]: GPU context lost (code -6), restarting renderer</code>
                  </li>
                  <li className="row row-2">
                    <code className="cmd">system_profiler SPDisplaysDataType</code>
                    <span className="status">
                      <span className="risk risk-medium">Medium</span>
                      <span className="swap">
                        <span className="outcome is-waiting waiting">Waiting for the client</span>
                        <span className="outcome is-ok allowed">Allowed once by the client</span>
                      </span>
                    </span>
                    <code className="out">Chipset Model: Apple M2 Pro · Metal Support: Metal 3</code>
                  </li>
                  <li className="row row-3">
                    <code className="cmd">cat ~/.ssh/id_ed25519</code>
                    <span className="status">
                      <span className="risk risk-high">High</span>
                      <span className="outcome is-gone">Blocked · SSH private key is protected</span>
                    </span>
                  </li>
                </ol>
              </div>

              <div className="prompt" role="dialog" aria-label="Valet approval prompt, example">
                <div className="prompt-title" aria-hidden="true">
                  <img src="/brand/valet-mark.svg" alt="" width="16" height="16" />
                  Valet
                </div>
                <p className="prompt-head">
                  <span className="risk risk-medium">Medium</span>
                  <span>
                    <b>Acme support agent</b> wants to run a command.
                  </span>
                </p>
                <div className="action-block">
                  <code className="action">system_profiler SPDisplaysDataType</code>
                  <dl>
                    <dt>Runs in</dt>
                    <dd>
                      <code>~/</code>
                    </dd>
                    <dt>Program</dt>
                    <dd>
                      <code>/usr/sbin/system_profiler</code>
                    </dd>
                    <dt>Needs</dt>
                    <dd>
                      <code>run /usr/sbin/system_profiler</code>
                    </dd>
                  </dl>
                </div>
                <div className="reason">
                  <span>Agent's reason</span>
                  <p>The crash log points at the GPU. I need the display details to match it against known driver issues.</p>
                </div>
                <div className="scope" aria-label="Allow for">
                  <span className="is-on">Once</span>
                  <span>This session</span>
                  <span>15 minutes</span>
                </div>
                <div className="prompt-actions">
                  <span className="btn-deny">Deny</span>
                  <span className="allow">
                    <span className="hold" aria-hidden="true" />
                    <Fingerprint />
                    <span className="label">Allow with Touch ID</span>
                  </span>
                </div>
                <p className="timeout-note">
                  Denies automatically in <b>0:45</b>
                </p>
                <span className="timeout-bar" aria-hidden="true">
                  <i />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
