import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// The comparison: why not the tools people already use to reach a machine. It compares categories, never named
// products (PRD: 3, 14), on the questions a customer asks before letting anyone in. Valet's column is a raised
// panel, and on scroll each row's answers come in with Valet's a beat after the other two.
// The markup is the finished state, which is what shows without the scroll animation.

const TOOLS = ['Remote desktop', 'SSH'] as const
const ROWS: { q: string; a: [string, string]; valet: string }[] = [
  {
    q: 'Who says yes to each action?',
    a: ['Nobody, once the session starts', 'Nobody, once they’re logged in'],
    valet: 'The machine’s owner, for anything outside the grants',
  },
  {
    q: 'What can the other side reach?',
    a: ['Whatever is on screen, with the mouse and keyboard', 'Everything the account can'],
    valet: 'Only what the customer granted',
  },
  {
    q: 'Who enforces the limits?',
    a: ['The person watching the screen', 'The account’s permissions'],
    valet: 'A sandbox on the customer’s machine',
  },
  {
    q: 'Is it built for an AI agent?',
    a: ['It works through pixels: slow, costly, hard to check', 'A full shell, with nothing in between'],
    valet: 'Tools with plain answers: approved, denied, timed out',
  },
  {
    q: 'What’s left afterwards?',
    a: ['A screen recording, if one was made', 'Server logs, if they were kept'],
    valet: 'A signed log both sides hold',
  },
]

export function NotRemoteDesktop() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    gsap.registerPlugin(ScrollTrigger)
    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const table = q('.cmp')[0] as HTMLElement
      const tl = gsap.timeline({
        defaults: { ease: 'power2.out' },
        scrollTrigger: { trigger: table, start: 'top 80%', end: 'bottom bottom', scrub: 0.8 },
      })
      tl.fromTo(q('.cmp-panel'), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6 }, 0)
      q('tbody tr').forEach((row, i) => {
        const at = 0.3 + i * 0.5
        tl.fromTo(row.querySelectorAll('th, .is-other'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 }, at)
          .fromTo(row.querySelector('.is-valet'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 }, at + 0.25)
      })
    })

    return () => mm.revert()
  }, [])

  return (
    <section className="compare" id="compare" ref={rootRef}>
      <div className="compare-inner">
        <div className="compare-head">
          <h2 className="h2">Not remote desktop. Not SSH.</h2>
          <p className="lead">
            Both were built for a person reaching a machine they look after. Valet is built for an outside agent
            working on someone else’s.
          </p>
        </div>

        <div className="cmp-wrap">
          {/* Valet's column, raised behind its cells */}
          <span className="cmp-panel" aria-hidden="true" />
          <table className="cmp">
            <thead>
              <tr>
                <td />
                {TOOLS.map((t) => (
                  <th scope="col" key={t} className="is-other">
                    {t}
                  </th>
                ))}
                <th scope="col" className="is-valet">
                  <span className="cmp-brand">
                    <img src="/brand/valet-mark.svg" alt="" width="18" height="18" />
                    Valet
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.q}>
                  <th scope="row">{r.q}</th>
                  {r.a.map((a, i) => (
                    <td key={a} className="is-other" data-tool={TOOLS[i]}>
                      {a}
                    </td>
                  ))}
                  <td className="is-valet" data-tool="Valet">
                    {r.valet}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
