import { useState } from 'react'
import { ACTIONS, READS, VENDORS, clock, shortHash } from './engine'
import type { Action, Vendor } from './engine'

// The agent's side, as buttons instead of a chat: each one is an MCP tool call the vendor's agent could make
// (PRD §9.2 A2), as whichever vendor is picked at the top. The panel underneath shows what that agent gets back,
// which is all it ever learns.

export type Status =
  | 'waiting'
  | 'started'
  | 'declined'
  | 'ok'
  | 'pending'
  | 'approved'
  | 'denied'
  | 'rejected'
  | 'timed_out'
  | 'extended'
  | 'ended'
export type LogEntry = { id: number; at: number; vendor: string; tool: string; arg: string; status: Status; detail?: string }

export function AgentConsole({
  vendor,
  onVendor,
  code,
  live,
  canCreate,
  log,
  onCreate,
  onOpenLink,
  onAction,
  onEnd,
  reads,
  onTouchFile,
}: {
  vendor: Vendor
  onVendor: (v: Vendor) => void
  code: string | null
  live: boolean
  canCreate: boolean
  log: LogEntry[]
  onCreate: (o: { template: boolean; purpose: string }) => void
  onOpenLink: () => void
  onAction: (a: Action) => void
  onEnd: () => void
  reads: Record<string, { hash: string }> // the hash this agent last got back for each file it read
  onTouchFile: (path: string) => void
}) {
  const [template, setTemplate] = useState(true)
  const [purpose, setPurpose] = useState(vendor.purpose)

  return (
    <aside className="console" aria-label="Agent side">
      <header className="console-head">
        <div className="seg" role="radiogroup" aria-label="Act as">
          {VENDORS.map((v) => (
            <button key={v.name} role="radio" aria-checked={v.name === vendor.name} onClick={() => onVendor(v)}>
              {v.name} · {v.verified ? 'verified' : 'no account'}
            </button>
          ))}
        </div>
        <div className="console-who">
          <span className="tile" aria-hidden="true">
            {vendor.name[0]}
          </span>
          <div>
            <b>{vendor.agent}</b>
            <p className="m-meta">
              {vendor.verified ? `Run by ${vendor.name}, a verified organisation` : `Run by ${vendor.name}, not signed in`} ·
              example only
            </p>
          </div>
        </div>
      </header>

      <section className="console-sec">
        <h2 className="m-label">1 · Start a session</h2>
        <label className="field-row">
          <span>Purpose shown to the client</span>
          <input className="m-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
          Propose starting permissions
        </label>
        <div className="row-actions is-left">
          <button
            className="mbtn mbtn-ink mbtn-sm"
            disabled={!canCreate}
            onClick={() => onCreate({ template, purpose })}
          >
            create_session
          </button>
          {code && (
            <button className="mbtn mbtn-ghost mbtn-sm" disabled={!canCreate} onClick={onOpenLink}>
              Client opens the link
            </button>
          )}
        </div>
        {code && (
          <p className="code-out">
            Join code <code>{code}</code> · <code>valet.davidsling.in/j/{code}</code>
          </p>
        )}
      </section>

      <section className="console-sec">
        <h2 className="m-label">2 · Act on the machine</h2>
        {!live && <p className="m-meta">Available once the client starts the session.</p>}
        <ul className="call-list">
          {ACTIONS.map((a) => (
            <li key={a.key}>
              <button className="call-btn" disabled={!live} onClick={() => onAction(a)}>
                <span className="call-head">
                  <b>{a.tool}</b>
                  <span className="call-hint">{a.hint}</span>
                </span>
                <code>{a.literal.split('\n')[0]}</code>
                {a.tool === 'write_file' && (
                  <span className="call-hash">
                    {reads[a.literal] ? `base_hash ${shortHash(reads[a.literal].hash)}` : 'base_hash none: not read yet'}
                  </span>
                )}
                {READS.has(a.tool) && <span className="call-hash">returns the file's hash</span>}
              </button>
            </li>
          ))}
        </ul>
        <button className="mbtn mbtn-ghost mbtn-sm" disabled={!live} onClick={onEnd}>
          end_session
        </button>
      </section>

      <section className="console-sec">
        <h2 className="m-label">3 · Meanwhile, on the client's machine</h2>
        <p className="m-meta">Something else changes a file, so the agent's last read of it is out of date.</p>
        <div className="row-actions is-left">
          {ACTIONS.filter((a) => a.tool === 'write_file').map((a) => (
            <button key={a.key} className="mbtn mbtn-ghost mbtn-sm" onClick={() => onTouchFile(a.literal)}>
              Change {a.literal.split('/').pop()}
            </button>
          ))}
        </div>
      </section>

      <section className="console-sec">
        <h2 className="m-label">What the agent receives</h2>
        {log.length ? (
          <ol className="results">
            {log.map((r) => (
              <li key={r.id}>
                <span className="r-call">
                  <time>{clock(r.at)}</time> {r.tool} <span>{r.arg}</span>
                </span>
                <span className={`r-status is-${r.status}`}>
                  → {r.status}
                  {r.detail && <span> · {r.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-meta">Nothing yet.</p>
        )}
      </section>
    </aside>
  )
}
