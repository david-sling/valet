import { VERB, hhmm, minutes } from '../format'
import type { PastSession } from './screens'

const ENDED_BY = { you: 'You', vendor: 'The requester', time: 'Time limit', closed: 'Valet was closed', unknown: 'Not recorded' }

const date = (t: number) =>
  new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Only shown when printing; the screen hides it and print hides everything else.
export function PrintReport({ s, version }: { s: PastSession; version: string }) {
  const facts: [string, string][] = [
    ['Requested by', s.vendor],
    ['Purpose', s.purpose],
    ['Started', date(s.startedAt)],
    ['Ended', `${date(s.endedAt)} · ${minutes(s.endedAt - s.startedAt)}`],
    ['Ended by', ENDED_BY[s.endedBy]],
    ['Session', s.id],
  ]
  return (
    <article className="print-report">
      <h1>Valet session record</h1>
      <dl>
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>What happened</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {s.feed.map((f) => (
            <tr key={f.id}>
              <td>{hhmm(f.at)}</td>
              {f.type === 'event' ? (
                <td colSpan={2}>{f.text}</td>
              ) : (
                <>
                  <td>
                    <span>{VERB[f.tool] ? VERB[f.tool][0].toUpperCase() + VERB[f.tool].slice(1) : f.tool}</span>
                    <code>{f.literal}</code>
                    {f.note && <small>{f.note}</small>}
                  </td>
                  <td>
                    {f.outcome}
                    {f.method && <small>Confirmed with {f.method}</small>}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <footer>
        Exported from Valet {version} on {date(Date.now())}. Command output and file contents are not included.
      </footer>
    </article>
  )
}
