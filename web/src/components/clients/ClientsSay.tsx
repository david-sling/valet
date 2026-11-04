import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { pageTop } from '#/lib/page-top'

// The section for the client side: why a customer accepts a session. The proof is the client app's permission
// review (DESIGN.md: Permission review) for the same example session as the section before, and its one moment is
// the customer switching off a permission they'd rather be asked about, so the count on the start button drops.
// The markup is the finished state, which is what shows without the scroll animation.

type Grant = { scope: string; access: string; risk: 'Low' | 'Medium'; off?: boolean }
const GROUPS: { label: string; grants: Grant[] }[] = [
  {
    label: 'Files',
    grants: [
      { scope: '~/Library/Logs/AcmeApp/**', access: 'read', risk: 'Low' },
      { scope: '~/Library/Application Support/AcmeApp/config.json', access: 'read', risk: 'Low' },
    ],
  },
  {
    label: 'Programs',
    grants: [
      { scope: '/usr/bin/log', access: 'run', risk: 'Medium' },
      { scope: '/usr/sbin/system_profiler', access: 'run', risk: 'Medium', off: true },
    ],
  },
  { label: 'Processes', grants: [{ scope: 'All processes', access: 'list', risk: 'Low' }] },
]
const ON = GROUPS.flatMap((g) => g.grants).filter((g) => !g.off).length

const POINTS = [
  {
    title: 'They pick what’s allowed.',
    body: 'Start from nothing, everything or your list, and switch off anything they’d rather be asked about first.',
  },
  {
    title: 'They see the real command.',
    body: 'Every prompt leads with the exact command, folder and program. Your agent’s reason comes second, marked as its own.',
  },
  {
    title: 'Their screen stays theirs.',
    body: 'Valet runs commands, nothing else. No screen sharing, no mouse, no keyboard.',
  },
  {
    title: 'They can end it at any time.',
    body: 'One click takes back every permission, stops everything the session started and seals the log.',
  },
]

export function ClientsSay() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const count = q('.start b')[0] as HTMLElement
      count.textContent = String(ON + 1) // before the customer switches one off
      const review = q('.review')[0] as HTMLElement
      const row = q('.grant.is-off')[0] as HTMLElement
      // places from the layout, so the window's own rise doesn't skew them
      const top = pageTop
      const lead = () => innerHeight * 0.3
      // the scroll position of the click: the window's top just clear of the header, so all of it that fits is on
      // screen, unless that leaves the row too low on a short screen; and finished before the section pins and the
      // next one slides over it, or the page ends
      const win = q('.review-window')[0] as HTMLElement
      const clear = () => (document.querySelector('.nav')?.getBoundingClientRect().bottom ?? 84) + 64
      const clickAt = () =>
        Math.min(
          Math.max(top(win) - clear(), top(row) - innerHeight * 0.8),
          top(root) + root.offsetHeight - innerHeight - lead() * 0.25,
          ScrollTrigger.maxScroll(window) - lead(),
        )

      // the window and the stub come up as the figure enters
      gsap
        .timeline({
          defaults: { ease: 'power2.out' },
          scrollTrigger: { trigger: review, start: 'top bottom', end: 'top 35%', scrub: 0.8, invalidateOnRefresh: true },
        })
        .fromTo(q('.review-window'), { y: 80 }, { y: 0, duration: 0.7 }, 0)
        .fromTo(q('.client-stub'), { y: 140, rotate: 2 }, { y: 0, rotate: 8, duration: 1 }, 0)

      // the cursor finds the one program the customer wants to be asked about, and clicks it halfway through
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: review,
          start: () => clickAt() - lead(),
          end: () => clickAt() + lead(),
          scrub: 0.8,
          invalidateOnRefresh: true,
        },
      })
      tl.fromTo(q('.cursor'), { x: 160, y: 120, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: 'power2.inOut' }, 0)
        .to(q('.cursor'), { scale: 0.86, duration: 0.03, yoyo: true, repeat: 1 }, 0.5)
        .fromTo(q('.grant.is-off .toggle'), { backgroundColor: '#15161a' }, { backgroundColor: '#cfcfd6', duration: 0.06 }, 0.53)
        .fromTo(q('.grant.is-off .knob'), { x: 12 }, { x: 0, duration: 0.06, ease: 'power2.out' }, 0.53)
        .fromTo(
          q('.grant.is-off .grant-body'),
          { opacity: 1 },
          {
            opacity: 0.45,
            duration: 0.06,
            onUpdate() {
              count.textContent = String(this.progress() >= 0.5 ? ON : ON + 1)
            },
          },
          0.53,
        )
        .fromTo(q('.grant.is-off .asked'), { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.57)
        .to(q('.cursor'), { x: 40, y: 150, opacity: 0, duration: 0.2, ease: 'power2.in' }, 0.8)
      return () => (count.textContent = String(ON))
    })

    return () => mm.revert()
  }, [])

  return (
    <section className="clients" id="clients" ref={rootRef}>
      <div className="clients-inner">
        <h2 className="h2 section-title">Why your customers will say yes.</h2>
        <div className="clients-copy">
          <p className="lead">
            Valet hands them the stub of the ticket: the final say over their own machine, from the first permission to
            the last line of the log.
          </p>
          <ul className="points">
            {POINTS.map((p) => (
              <li key={p.title}>
                <b>{p.title}</b> {p.body}
              </li>
            ))}
          </ul>
        </div>

        <figure className="review">
          <svg className="client-stub" viewBox="0 0 120 64" aria-hidden="true">
            <path d="M6 0h108a6 6 0 0 1 6 6v52a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V40a8 8 0 0 0 0-16V6a6 6 0 0 1 6-6Z" />
            <text x="24" y="27">CLIENT COPY</text>
            <text x="24" y="48" className="stub-no">0042</text>
          </svg>

          <div className="review-window">
            <div className="feed-bar" aria-hidden="true">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              <span>Valet · Review permissions</span>
            </div>
            <div className="review-head">
              <p className="vendor">Acme Inc.</p>
              <p className="who">Acme support agent, an AI agent</p>
              <p className="purpose">Find out why AcmeApp crashes when it opens.</p>
              <p className="meta">60-minute session · you can end it at any time</p>
            </div>

            <div className="segmented" aria-label="Start from">
              <span>None</span>
              <span className="is-on">Template</span>
              <span>All</span>
            </div>

            <div className="grants">
              {GROUPS.map((g) => (
                <div className="grant-group" key={g.label}>
                  <p className="grant-label">{g.label}</p>
                  <ul>
                    {g.grants.map((gr) => (
                      <li key={gr.scope} className={`grant${gr.off ? ' is-off' : ''}`}>
                        <span className={`toggle${gr.off ? '' : ' is-on'}`} aria-hidden="true">
                          <i className="knob" />
                        </span>
                        <span className="grant-body">
                          <code>{gr.scope}</code>
                          <span className="access">{gr.access}</span>
                          <span className={`risk risk-${gr.risk.toLowerCase()}`}>{gr.risk}</span>
                        </span>
                        <span className="visually-hidden">{gr.off ? ' switched off' : ' allowed'}</span>
                        {gr.off && (
                          <>
                            <span className="asked" aria-hidden="true">
                              Asks first
                            </span>
                            {/* the customer's pointer, resting on the toggle it just switched off */}
                            <svg className="cursor" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M5 3.5v15.2l4.1-3.9 2.7 6.2 2.6-1.1-2.7-6.1H17L5 3.5Z" />
                            </svg>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="review-actions" aria-hidden="true">
              <span className="decline">Decline</span>
              <span className="start">
                Start session with <b>{ON}</b> permissions
              </span>
            </div>
          </div>

          <figcaption>Example session. Acme is a made-up vendor.</figcaption>
        </figure>
      </div>
    </section>
  )
}
