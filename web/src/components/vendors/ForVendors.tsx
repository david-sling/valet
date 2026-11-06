import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// The section for the vendor side: what their agent gets. The proof is the agent's own view of the same example
// session, its calls to Valet's API, made with curl as the Valet skill describes, each answered with a plain status
// it can act on: approved, denied or rejected. It ends with the sealed log both sides receive. Sky is the agent's
// colour, so the section sits on sky, and the agent's red half of the ticket rests behind its window.
// The markup is the finished state, which is what shows without the scroll animation.

type Call = { tool: string; arg?: string; status?: string; note: string; tone: 'ok' | 'denied' | 'gone' }
const CALLS: Call[] = [
  { tool: 'create_session', arg: 'template: "AcmeApp crash triage"', note: 'The customer joined with 4 of 5 permissions', tone: 'ok' },
  { tool: 'run_command', arg: 'system_profiler SPDisplaysDataType', status: 'approved', note: 'Allowed once, with Touch ID', tone: 'ok' },
  { tool: 'read_file', arg: '~/.ssh/id_ed25519', status: 'denied', note: 'Protected location: SSH private key', tone: 'denied' },
  {
    tool: 'write_file',
    arg: '~/Library/Application Support/AcmeApp/config.json',
    status: 'rejected',
    note: 'The file changed after it was read, so it reads again first',
    tone: 'gone',
  },
]

const STEPS = [
  { title: 'Connect your agent.', body: 'Add the Valet skill to the agent you already run. It shows the agent how to call Valet with curl.' },
  {
    title: 'Send the customer a link.',
    body: 'Your agent starts a session with the permissions it proposes. The link gets them the Valet app, where they review those permissions and join.',
  },
  { title: 'Get the signed log.', body: 'When the session ends, you and your customer both receive the same sealed record of every step.' },
]

export function ForVendors() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const proof = q('.calls')[0] as HTMLElement
      // the window and the ticket come up as the figure enters
      gsap
        .timeline({
          defaults: { ease: 'power2.out' },
          scrollTrigger: { trigger: proof, start: 'top bottom', end: 'top 35%', scrub: 0.8 },
        })
        .fromTo(q('.calls-window'), { y: 80 }, { y: 0, duration: 0.7 }, 0)
        .fromTo(q('.agent-ticket'), { y: 160, rotate: -2 }, { y: 0, rotate: -7, duration: 1 }, 0)

      // then the session plays out from the agent's side: each call goes out, and its answer comes back a beat later
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: proof, start: 'top 70%', end: 'clamp(bottom 75%)', scrub: 0.8 },
      })
      q('.call').forEach((row, i) => {
        tl.fromTo(row, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, i)
          .fromTo(row.querySelector('.answer'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, i + 0.45)
      })
      tl.fromTo(q('.sealed'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, CALLS.length)
    })

    return () => mm.revert()
  }, [])

  return (
    <section className="vendors" id="vendors" ref={rootRef}>
      <div className="vendors-inner">
        <h2 className="h2 section-title">Your hardest tickets, without the screen-share call.</h2>
        <div className="vendors-copy">
          <p className="lead">
            Crashes the report doesn’t explain. Installs that fail on one machine in fifty. Your agent looks on the
            customer’s computer itself, inside what they accepted, and every answer comes back as something it can act on.
          </p>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <b>{s.title}</b> {s.body}
              </li>
            ))}
          </ol>
        </div>

        <figure className="calls">
          <svg className="agent-ticket" viewBox="0 0 120 64" aria-hidden="true">
            <path d="M6 0h108a6 6 0 0 1 6 6v18a8 8 0 0 0 0 16v18a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Z" />
            <rect x="16" y="10" width="22" height="5" rx="2.5" className="slot" />
            <text x="46" y="15">AGENT COPY</text>
            <text x="16" y="38" className="ticket-no">0042</text>
          </svg>

          <div className="calls-window">
            <div className="feed-bar" aria-hidden="true">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              <span>Acme support agent · Valet skill</span>
            </div>
            <ol className="call-list">
              {CALLS.map((c) => (
                <li className="call" key={c.tool}>
                  <span className="agent-tile" aria-hidden="true">
                    A
                  </span>
                  <div className="call-body">
                    <p className="call-line">
                      <code className="tool">{c.tool}</code>
                      {c.arg && <code className="arg">{c.arg}</code>}
                    </p>
                    <p className="answer">
                      {c.status && <code className={`call-status is-${c.tone}`}>{c.status}</code>}
                      <span className="note">{c.note}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="sealed">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="7" />
                <path d="m4.8 8.2 2.1 2.1 4.3-4.4" />
              </svg>
              <span>
                <code className="tool">end_session</code> Log sealed · signature valid
              </span>
              <code className="hash">3f9a…c21e</code>
            </p>
          </div>

          <figcaption>Example session. Acme is a made-up vendor.</figcaption>
        </figure>
      </div>
    </section>
  )
}
