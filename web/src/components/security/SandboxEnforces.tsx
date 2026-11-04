import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// The security section: why the rules hold even if the agent misbehaves. It is built on a spine: the audit log of
// the example session runs down a hash chain (PRD: 7.5, 7.7), and each rule hangs off the entry that proves it.
// The section before already showed approvals and a blocked protected file, so this log shows what it didn't:
// the sandbox judging what a process does rather than what its command says, templates that can't reach protected
// places, and the sealed record.
// The markup is the finished state, which is what shows without the scroll animation.

type Entry = {
  n?: number
  time?: string
  action: string
  mono?: boolean
  outcome: string
  tone: 'ok' | 'stop' | 'event'
  hash: string
  rule?: { title: string; body: string }
}
const ENTRIES: Entry[] = [
  {
    n: 11,
    time: '14:02:07',
    action: 'Session started from the template “AcmeApp crash triage”',
    outcome: '4 permissions · protected places left out',
    tone: 'event',
    hash: '9c41…e07a',
    rule: {
      title: 'Some places are never in a template.',
      body: 'SSH keys, keychains, browser profiles and password managers can’t be granted ahead of time. Reaching one always takes its own high-risk approval.',
    },
  },
  {
    n: 12,
    time: '14:02:31',
    action: 'run_command /Applications/AcmeApp.app/Contents/MacOS/AcmeApp --diagnose',
    mono: true,
    outcome: 'Running · inside the grants',
    tone: 'ok',
    hash: '51d2…a9f3',
  },
  {
    n: 13,
    time: '14:02:33',
    action: 'AcmeApp: ~/Documents/Taxes 2025.pdf: Operation not permitted',
    mono: true,
    outcome: 'Refused by the sandbox · outside the grants',
    tone: 'stop',
    hash: 'e8b0…14cd',
    rule: {
      title: 'The operating system enforces it.',
      body: 'The command only said --diagnose. When the process reached for a file no grant covered, the operating system refused the read. Valet never guesses from a command’s text.',
    },
  },
  {
    n: 14,
    time: '14:09:31',
    action: 'Session ended by the customer',
    outcome: 'Every permission revoked · 1 process stopped',
    tone: 'event',
    hash: '27fa…c630',
  },
  {
    action: 'Log sealed · signature valid',
    outcome: 'Same copy for Acme and the customer',
    tone: 'ok',
    hash: '3f9a…c21e',
    rule: {
      title: 'One record, signed.',
      body: 'Each entry carries the hash of the one before and is signed on the customer’s machine, so any edit shows.',
    },
  },
]

export function SandboxEnforces() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // the log writes itself down the spine: the chain draws down to each entry's knot, the entry lands, and its
      // rule comes off the knot beside it. The latest entry's knot is green; it passes back to lilac as the next lands.
      const latest = { backgroundColor: '#1fa35a', boxShadow: '0 0 0 4px #e3f4ea', duration: 0.15 }
      const earlier = { backgroundColor: '#c7b8ff', boxShadow: '0 0 0 4px #efeaff', duration: 0.15 }
      const knots = q('.knot b')
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: q('.spine')[0], start: 'top 75%', end: 'bottom bottom', scrub: 0.8 },
      })
      q('.spine-row').forEach((row, i) => {
        const up = row.querySelector('.knot .up')
        const down = row.querySelector('.knot .down')
        if (up) tl.fromTo(up, { scaleY: 0 }, { scaleY: 1, duration: 0.25 }, i - 0.25)
        tl.fromTo(knots[i], { scale: 0 }, { scale: 1, duration: 0.2, ease: 'back.out(3)' }, i)
          .to(knots[i], latest, i)
          .fromTo(row.querySelector('.log-entry'), { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out' }, i)
        const rule = row.querySelector('.rule')
        if (i > 0) tl.to(knots[i - 1], earlier, i)
        if (rule) tl.fromTo(rule, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out' }, i + 0.3)
        if (down) tl.fromTo(down, { scaleY: 0 }, { scaleY: 1, duration: 0.25 }, i + 0.75)
      })
    })

    return () => mm.revert()
  }, [])

  return (
    <section className="security" id="security" ref={rootRef}>
      <div className="security-inner">
        <div className="security-head">
          <h2 className="h2">The sandbox enforces it. Not the agent.</h2>
          <p className="lead">
            Your agent asks; the customer’s machine decides. The rules are enforced where the commands run, not in
            the agent’s prompt.
          </p>
        </div>

        <figure className="spine-figure">
          <ol className="spine" aria-label="Example audit log">
            {ENTRIES.map((e, i) => (
              <li className={`spine-row${e.n ? '' : ' is-seal'}`} key={e.hash}>
                <div className="log-entry">
                  <p className="log-head">
                    {e.n && <span className="log-no">#{e.n}</span>}
                    {e.time && <time>{e.time}</time>}
                    <span className={`log-outcome is-${e.tone}`}>{e.outcome}</span>
                  </p>
                  <p className={e.mono ? 'log-action is-mono' : 'log-action'}>{e.action}</p>
                  <p className="log-hash">
                    {i > 0 && (
                      <>
                        <code>{ENTRIES[i - 1].hash}</code> <span aria-hidden="true">→</span>{' '}
                      </>
                    )}
                    <code className="is-own">{e.hash}</code>
                  </p>
                </div>
                {/* the entry's place on the chain, linked to the entries either side */}
                <span className="knot" aria-hidden="true">
                  {i > 0 && <i className="up" />}
                  <b />
                  {i < ENTRIES.length - 1 && <i className="down" />}
                </span>
                {e.rule && (
                  <p className="rule">
                    <b>{e.rule.title}</b> {e.rule.body}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <figcaption>Example session. Acme is a made-up vendor.</figcaption>
        </figure>
      </div>
    </section>
  )
}
