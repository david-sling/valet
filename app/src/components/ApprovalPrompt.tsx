import { useEffect, useId, useRef, useState } from 'react'
import { SCOPE_LABEL } from '@valet/protocol/policy'
import type { Scope } from '@valet/protocol'
import { VERB, describe } from '../format'
import { RiskBars } from './RiskBars'
import { Diff, DiffStat } from './Diff'
import { SplitButton } from './SplitButton'
import { CommandSentence } from './CommandSentence'
import { api, type Prompt } from '../api'

const RIDGES = [
  'M6.2 7.6a7.6 7.6 0 0 1 11.6 0',
  'M4.6 12.2a7.4 7.4 0 0 1 14.8 0v1.3',
  'M7.8 12.6a4.2 4.2 0 0 1 8.4 0v1c0 2.6-1 4.7-2.6 6.3',
  'M12 12.4v1.4c0 3-1.3 5.4-3.4 7',
  'M4.9 15.8c.4 1.7 1.2 3.2 2.4 4.4',
  'M19.2 16.6c-.3 1.3-.8 2.5-1.5 3.6',
]

export function Fingerprint() {
  return (
    <svg className="fingerprint" viewBox="0 0 24 24" aria-label="with Touch ID">
      {RIDGES.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

// A request waits until the person answers or the session ends. Focus starts on Deny; Escape denies. Allow is
// disabled for the first 600 ms, and for high and critical risk the app asks macOS for Touch ID itself.
export function ApprovalPrompt({
  vendor,
  prompt,
  now,
  onAnswer,
}: {
  vendor: string
  prompt: Prompt
  now: number
  onAnswer: (allow: boolean, scope?: Scope) => Promise<void>
}) {
  const [scope, setScope] = useState<Scope>('once')
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState('')
  const denyRef = useRef<HTMLButtonElement>(null)
  const touch = prompt.risk === 'high' || prompt.risk === 'critical'
  const titleId = useId()
  const waited = Math.floor((now - prompt.askedAt) / 60_000)

  useEffect(() => {
    if (!document.activeElement?.closest('.request')) denyRef.current?.focus()
    const t = setTimeout(() => setArmed(true), 600)
    return () => clearTimeout(t)
  }, [])

  const answer = (allow: boolean) => {
    setError('')
    onAnswer(allow, allow ? scope : undefined).catch((e: unknown) => setError(typeof e === 'string' ? e : 'Not confirmed.'))
  }

  const allowLabel =
    scope === 'once' ? 'Allow once' : scope === 'check' ? 'Allow, check output' : `Allow for ${SCOPE_LABEL[scope].toLowerCase()}`
  const fingerprint = <Fingerprint />
  const extra = prompt.needs.filter((n) => n.scope !== prompt.program && !prompt.literal.includes(n.scope))
  const guarded = prompt.needs.find((n) => n.protectedLabel)?.protectedLabel
  const clock = <span className="request-clock">{waited < 1 ? 'Asked just now' : `Asked ${waited} min ago`}</span>

  return (
    <li
      className="feed-row request"
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(e) => e.key === 'Escape' && !prompt.busy && answer(false)}
    >
      <span className="tile" aria-hidden="true">
        {vendor[0]}
      </span>
      <div className="request-body">
        <p id={titleId} className="request-ask">
          <span>
            {prompt.output === null ? (
              <>
                <b>{vendor}</b> wants to {VERB[prompt.tool] ?? prompt.tool}
              </>
            ) : (
              <>
                Send this output to <b>{vendor}</b>?
              </>
            )}
          </span>
          <RiskBars risk={prompt.risk} />
        </p>

        <div className="reason">
          <span>Their reason</span>
          <p>{prompt.reason}</p>
        </div>
        <div className="action-block">
          <div className="literal-row">
            <code className="literal">{prompt.literal}</code>
            {guarded && <span className="guarded">{guarded}</span>}
            {prompt.diff && <DiffStat lines={prompt.diff} />}
          </div>
          {prompt.tool === 'run_command' && prompt.output === null && <CommandSentence command={prompt.literal} />}
          {prompt.diff && <Diff lines={prompt.diff} />}
          {prompt.output !== null && <HeldOutput prompt={prompt} />}
          {(prompt.program || extra.length > 0) && (
            <p className="action-meta">
              {prompt.program && (
                <code>
                  {prompt.program}
                  {prompt.cwd && ` in ${prompt.cwd}`}
                </code>
              )}
              {extra.map((n) => {
                const d = describe(n)
                return (
                  <span key={n.kind + n.scope + n.access} title={`${n.access} ${n.scope}`}>
                    {d.verb} {d.code ? <code>{d.obj}</code> : d.obj}
                    {n.risk !== prompt.risk && <RiskBars risk={n.risk} />}
                  </span>
                )
              })}
            </p>
          )}
        </div>


        {prompt.output !== null ? (
          <div className="request-actions">
            <button ref={denyRef} className="mbtn mbtn-ghost mbtn-sm" onClick={() => answer(false)}>
              Don't send
            </button>
            <button className="mbtn mbtn-ink mbtn-sm" onClick={() => answer(true)} disabled={!armed}>
              Send
            </button>
            {clock}
          </div>
        ) : prompt.busy ? (
          <div className="touchid-wait" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {RIDGES.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            Confirm with Touch ID to allow
          </div>
        ) : (
          <div className="request-actions">
            <button ref={denyRef} className="mbtn mbtn-ghost mbtn-sm" onClick={() => answer(false)}>
              Deny
            </button>
            {prompt.scopes.length > 1 ? (
              <SplitButton
                ink
                label={allowLabel}
                icon={touch && fingerprint}
                disabled={!armed}
                menuLabel="Allow for"
                options={prompt.scopes.map((k) => ({ key: k, label: SCOPE_LABEL[k] }))}
                value={scope}
                onRun={() => answer(true)}
                onPick={setScope}
              />
            ) : (
              <button className="mbtn mbtn-ink mbtn-sm" onClick={() => answer(true)} disabled={!armed}>
                {touch && fingerprint}
                {allowLabel}
              </button>
            )}
            {clock}
          </div>
        )}
        {error && <p className="m-error">{error}</p>}
      </div>
    </li>
  )
}

function HeldOutput({ prompt }: { prompt: Prompt }) {
  const [text, setText] = useState(prompt.output ?? '')
  const [next, setNext] = useState(prompt.outputNext)
  const loading = useRef(false)

  const onScroll = (e: React.UIEvent<HTMLPreElement>) => {
    const el = e.currentTarget
    if (next === null || loading.current || el.scrollHeight - el.scrollTop - el.clientHeight > 400) return
    loading.current = true
    api
      .outputPage(prompt.id, next)
      .then((p) => {
        setText((t) => t + p.text)
        setNext(p.next)
      })
      .catch(() => {})
      .finally(() => (loading.current = false))
  }

  return (
    <pre className="out" onScroll={onScroll}>
      {text || 'No output'}
      {next !== null && <span className="out-more">Scroll for more…</span>}
    </pre>
  )
}
