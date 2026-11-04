import { useEffect, useId, useRef, useState } from 'react'
import { RIDGES } from '#/components/asks/AsksFirst'
import { SCOPE_LABEL, VERB, hhmm, scopesFor } from './engine'
import { RiskBars } from './RiskBars'
import { Diff, DiffStat } from './Diff'
import type { Action, Need, Scope } from './engine'

// The approval request, inline as the last row of the live session's activity, under the events that led to it.
// One sentence with the risk, the literal action, the agent's reason, then Deny, how long to allow for, and Allow.
// A request never expires: it waits until the client answers it or the session ends, while other actions carry on. Focus starts on Deny; Return, Space and Escape all deny. High and critical risk need Touch ID;
// medium can be a click, which only becomes possible after a 600ms pause.
export function ApprovalPrompt({
  agent,
  action,
  needs,
  askedAt,
  basedOn,
  now,
  onDeny,
  onAllow,
}: {
  agent: string
  action: Action
  needs: Need[]
  askedAt: number
  basedOn?: number // for an edit: when the agent read the version it changes
  now: number
  onDeny: () => void
  onAllow: (scope: Scope, method: string) => void
}) {
  const [scope, setScope] = useState<Scope>('once')
  const [step, setStep] = useState<'ask' | 'touch' | 'done'>('ask')
  const [armed, setArmed] = useState(false)
  const denyRef = useRef<HTMLButtonElement>(null)
  const touch = action.risk === 'high' || action.risk === 'critical'
  const titleId = useId()
  const waited = Math.floor((now - askedAt) / 60_000)

  // the parent keys each prompt by its request, so this runs once per prompt. A new request takes focus only when
  // the client isn't already answering another one.
  useEffect(() => {
    if (!document.activeElement?.closest('.request')) denyRef.current?.focus()
    const t = setTimeout(() => setArmed(true), 600)
    return () => clearTimeout(t)
  }, [])

  const allow = () => (touch ? setStep('touch') : onAllow(scope, 'Click'))
  const touched = () => {
    setStep('done')
    setTimeout(() => onAllow(scope, 'Touch ID'), 520)
  }

  // the action block shows only what the literal doesn't already say: the program behind a command, where it runs,
  // and any access beyond the path it names
  const extra = needs.filter((n) => n.scope !== action.program && !action.literal.includes(n.scope))
  const guarded = needs.find((n) => n.protectedLabel)?.protectedLabel
  const scopes = scopesFor(action)
  // a request waits for as long as it takes; how long it has waited is shown, so an old one reads as old
  const clock = <span className="request-clock">{waited < 1 ? 'Asked just now' : `Asked ${waited} min ago`}</span>

  return (
    <li
      className="feed-row request"
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(e) => e.key === 'Escape' && onDeny()}
    >
      <span className="tile" aria-hidden="true">
        {agent[0]}
      </span>
      <div className="request-body">
        <p id={titleId} className="request-ask">
          <span>
            <b>{agent}</b> wants to {VERB[action.tool]}
          </span>
          <RiskBars risk={action.risk} />
        </p>

        <div className="action-block">
          <div className="literal-row">
            <code className="literal">{action.literal}</code>
            {guarded && <span className="guarded">{guarded}</span>}
            {action.diff && <DiffStat lines={action.diff} />}
          </div>
          {action.diff && <Diff lines={action.diff} />}
          {(action.program || extra.length > 0 || basedOn) && (
            <p className="action-meta">
              {basedOn && <span>Edits the version it read at {hhmm(basedOn)}</span>}
              {action.program && (
                <code>
                  {action.program}
                  {action.cwd && ` in ${action.cwd}`}
                </code>
              )}
              {extra.map((n) => (
                <span key={n.kind + n.scope + n.access}>
                  <code>
                    {n.access} {n.scope}
                  </code>
                  {n.risk !== action.risk && <RiskBars risk={n.risk} />}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="reason">
          <span>Agent's reason</span>
          <p>{action.reason}</p>
        </div>

        {step === 'ask' ? (
          <div className="request-actions">
            <button ref={denyRef} className="mbtn mbtn-ghost mbtn-sm" onClick={onDeny}>
              Deny
            </button>
            {scopes.length > 1 && (
              <span className="scope-pick">
                <select aria-label="Allow for" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  {scopes.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <button className="mbtn mbtn-ink mbtn-sm" onClick={allow} disabled={!armed}>
              {touch ? 'Allow with Touch ID' : 'Allow'}
            </button>
            {clock}
          </div>
        ) : (
          <div className={`touchid${step === 'done' ? ' is-done' : ''}`}>
            <button className="touchid-pad" onClick={touched} disabled={step === 'done'} aria-label="Touch the sensor">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {RIDGES.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </button>
            <p>{step === 'done' ? `Allowed · ${SCOPE_LABEL[scope].toLowerCase()}` : 'Touch ID to allow'}</p>
            {step === 'touch' && (
              <button className="link" onClick={() => setStep('ask')}>
                Cancel
              </button>
            )}
            {clock}
          </div>
        )}

      </div>
    </li>
  )
}
