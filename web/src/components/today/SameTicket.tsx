import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

type Who = 'you' | 'customer' | 'agent'
type Step = { who: Who; text: string } | { wait: string }

const WHO: Record<Who, string> = { you: 'You', customer: 'Customer', agent: 'AI agent' }

const TODAY: Step[] = [
  { who: 'you', text: 'Ask for screenshots, logs and system details.' },
  { wait: 'Waiting for a reply' },
  { who: 'customer', text: 'Sends some of it.' },
  { who: 'you', text: 'Ask again for what’s missing.' },
  { wait: 'Waiting for a reply' },
  { who: 'you', text: 'Book a screen-share call.' },
  { wait: 'Waiting for the call' },
  { who: 'customer', text: 'Types each Terminal command you read out, one at a time.' },
]

const WITH_VALET: Step[] = [
  { who: 'you', text: 'Send a Valet link.' },
  { who: 'customer', text: 'Chooses exactly what your AI agent is allowed to do.' },
  { who: 'agent', text: 'Runs the diagnostics, reads the crash logs and finds the cause.' },
  { who: 'customer', text: 'Approves the agent’s fix with Touch ID.' },
  { who: 'you', text: 'Step in only if you need to.' },
]

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol>
      {steps.map((s, i) =>
        'wait' in s ? (
          <li key={i} className="step is-wait">
            {s.wait}
          </li>
        ) : (
          <li key={i} className="step">
            <span className={`who is-${s.who}`}>{WHO[s.who]}</span>
            <span>{s.text}</span>
          </li>
        ),
      )}
    </ol>
  )
}

export function SameTicket() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline({
        defaults: { ease: 'power2.out' },
        scrollTrigger: { trigger: q('.flows')[0], start: 'top 80%', end: 'bottom bottom', scrub: 0.8 },
      })
      tl.fromTo(q('.case-wrap'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4 }, 0)
      q('.flow').forEach((flow, i) => {
        tl.fromTo(flow.querySelectorAll('.step'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.15 }, 0.3 + i * 0.4)
      })
    })

    return () => mm.revert()
  }, [])

  return (
    <section className="today" id="today" ref={rootRef}>
      <div className="today-inner">
        <div className="today-head">
          <h2 className="h2">A support ticket, before and after Valet.</h2>
          <p className="lead">
            Hard tickets stall on back-and-forth: asking for logs, waiting, asking again. With Valet, your agent gathers
            the evidence itself, on the customer’s computer, inside what they agreed to.
          </p>
        </div>

        <div className="case-wrap">
          <p className="case">
            <span className="case-no">Ticket 0042</span>
            <span className="case-text">AcmeApp crashes when it opens</span>
          </p>
          <p className="case-note">Example ticket. Acme is a made-up vendor.</p>
        </div>

        <div className="flows">
          <div className="flow is-today">
            <p className="flow-label">Today</p>
            <Steps steps={TODAY} />
          </div>
          <div className="flow is-valet">
            <p className="flow-label">
              <img src="/brand/valet-mark.svg" alt="" width="18" height="18" />
              With Valet
            </p>
            <Steps steps={WITH_VALET} />
            <p className="flow-note">No screen sharing. Every command the agent runs is in a log you both get.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
