import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Grant } from '@valet/protocol'
import { KINDS, SESSION_MINUTES, hhmm, clock, day, describe, minutes } from '../format'
import { RiskBars } from './RiskBars'
import { Diff, DiffStat } from './Diff'
import { ExportButton } from './ExportButton'
import { OutcomeChart, type Slice } from './OutcomeChart'
import type { FeedItem, Outcome } from '../api'

export type PastSession = {
  id: string
  vendor: string
  purpose: string
  startedAt: number
  endedAt: number
  endedBy: 'you' | 'vendor' | 'time' | 'closed'
  feed: FeedItem[]
}

export type Checking = 'idle' | 'checking' | 'current' | 'failed'

const CHECKING: Record<Checking, string> = {
  idle: 'Check for updates',
  checking: 'Checking…',
  current: "You're up to date",
  failed: "Couldn't check",
}

export type OngoingItem = { id: string; vendor: string; endsAt: number; waiting: number }

export function Sidebar({
  joining,
  ongoing,
  openLive,
  now,
  past,
  openPast,
  dark,
  onJoin,
  onLive,
  onPast,
  onDark,
  version,
  checking,
  downloading,
  onCheckUpdate,
}: {
  joining: boolean
  ongoing: OngoingItem[]
  openLive: string | null
  now: number
  past: PastSession[]
  openPast: string | null
  dark: boolean
  onJoin: () => void
  onLive: (id: string) => void
  onPast: (id: string) => void
  onDark: () => void
  version: string
  checking: Checking
  downloading: { percent: number | null } | null
  onCheckUpdate: () => void
}) {
  return (
    <nav className="side" aria-label="Sessions">
      <button className="side-item" aria-current={joining ? 'page' : undefined} onClick={onJoin}>
        <span className="side-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </span>
        <b>Join a session</b>
      </button>

      {ongoing.length > 0 && (
        <div className="side-group">
          <h2 className="m-label">Ongoing</h2>
          {ongoing.map((o) => (
            <button
              key={o.id}
              className="side-item"
              aria-current={openLive === o.id ? 'page' : undefined}
              onClick={() => onLive(o.id)}
            >
              <span className="tile" aria-hidden="true">
                {o.vendor[0]}
              </span>
              <span>
                <b>{o.vendor}</b>
                {o.waiting > 0 && openLive !== o.id ? (
                  <small className="is-waiting">
                    <span className="dot" aria-hidden="true" />
                    {o.waiting === 1 ? 'A request is waiting' : `${o.waiting} requests waiting`}
                  </small>
                ) : (
                  <small>
                    <span className="dot" aria-hidden="true" />
                    Live · {Math.max(0, Math.ceil((o.endsAt - now) / 60_000))} min left
                  </small>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="side-group">
        <h2 className="m-label">Past</h2>
        {past.length ? (
          past.map((s) => (
            <button
              key={s.id}
              className="side-item"
              aria-current={openPast === s.id ? 'page' : undefined}
              onClick={() => onPast(s.id)}
            >
              <span className="tile" aria-hidden="true">
                {s.vendor[0]}
              </span>
              <span>
                <b>{s.vendor}</b>
                <small>{day(s.startedAt)}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="side-empty">Sessions you've had show up here. They're kept on this Mac only.</p>
        )}
      </div>

      <div className="side-foot">
        <div className="side-version">
          {version && <span>Valet {version}</span>}
          {downloading ? (
            <>
              <span role="status">Downloading…{downloading.percent !== null && ` ${downloading.percent}%`}</span>
              <span
                className="update-track"
                role="progressbar"
                aria-label="Downloading update"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={downloading.percent ?? undefined}
              >
                <span style={{ width: `${downloading.percent ?? 0}%` }} />
              </span>
            </>
          ) : (
            <button onClick={onCheckUpdate} disabled={checking === 'checking'}>
              <span role="status">{CHECKING[checking]}</span>
            </button>
          )}
        </div>
        <div className="theme-pick" role="radiogroup" aria-label="Appearance">
          <button role="radio" aria-checked={!dark} aria-label="Light" title="Light" onClick={() => dark && onDark()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="2.8" />
              <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
            </svg>
          </button>
          <button role="radio" aria-checked={dark} aria-label="Dark" title="Dark" onClick={() => !dark && onDark()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  )
}

// Takes a typed code, a pasted "ACD-347" or a whole join link, and keeps the six code characters.
const clean = (v: string) =>
  (v.match(/\/j\/([\w-]+)/)?.[1] ?? v)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)

export function Home({ code: linked = '', onJoin, error }: { code?: string; onJoin: (code: string) => void; error: string }) {
  const [code, setCode] = useState(clean(linked))
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (error) input.current?.focus()
  }, [error])
  const box = (i: number) => (
    <span
      key={i}
      className="otp-box"
      data-filled={i < code.length}
      data-active={focused && (i === code.length || (i === 5 && code.length === 6))}
    >
      {code[i]}
    </span>
  )
  return (
    <div className="screen home">
      <img src="/valet-mark.svg" alt="" width={44} height={44} />
      <h1 className="m-title">Join a session</h1>
      <p className="m-body">
        Enter the code your vendor gave you, or open their link. Valet never starts a session on its own.
      </p>
      <form
        className="code-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (code.length === 6) onJoin(`${code.slice(0, 3)}-${code.slice(3)}`)
        }}
      >
        <label htmlFor="code" className="m-label">
          Join code
        </label>
        <div className="code-row">
          <div className="otp" aria-invalid={!!error}>
            <input
              ref={input}
              id="code"
              value={code}
              onChange={(e) => setCode(clean(e.target.value))}
              onPaste={(e) => {
                e.preventDefault()
                setCode(clean(e.clipboardData.getData('text')))
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? 'code-error' : undefined}
            />
            <span className="otp-group">{[0, 1, 2].map(box)}</span>
            <span className="otp-dash" aria-hidden="true">
              –
            </span>
            <span className="otp-group">{[3, 4, 5].map(box)}</span>
          </div>
          <button className="mbtn mbtn-ink" disabled={code.length < 6}>
            Join
          </button>
        </div>
        {error && (
          <p id="code-error" className="m-error">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}

// Most links come from someone without an account, whose name Valet can't vouch for. Then the screen says so
// plainly, and continuing takes one extra step: the client confirms they know the sender and asked for this.
export function Join({
  vendor,
  verified,
  purpose,
  createdAt,
  onContinue,
  onDecline,
}: {
  vendor: string
  verified: boolean
  purpose: string
  createdAt: number
  onContinue: () => void
  onDecline: () => void
}) {
  const [known, setKnown] = useState(false)
  const first = vendor.split(' ')[0]
  const age = Math.floor((Date.now() - createdAt) / 60_000)
  return (
    <div className="page is-flow">
      <PageHead
        vendor={vendor}
        title={`${vendor} wants to start a session`}
        meta={
          verified ? (
            <span className="verified">
              <Check /> Verified organisation
            </span>
          ) : (
            `Not verified · ${first} typed this name`
          )
        }
      />
      <section className="page-sec">
        {!verified && (
          <p className="warning-note">
            Valet can't confirm who this is. Continue only if you asked {first} for help yourself. If someone
            contacted you first and asked you to open this link, decline.
          </p>
        )}
        <dl className="kv">
          <dt>Their reason</dt>
          <dd>{purpose}</dd>
          <dt>How long</dt>
          <dd>Up to {SESSION_MINUTES} minutes. You can end it at any time.</dd>
          <dt>What it can do</dt>
          <dd>Run commands you allow. It can't see your screen or use your mouse and keyboard.</dd>
          <dt>Link created</dt>
          <dd>{age < 1 ? 'Just now' : `${age} min ago`}</dd>
        </dl>
      </section>
      <footer className="page-foot">
        {!verified && (
          <label className="check-row">
            <input type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} />I know {first} and
            asked for this session
          </label>
        )}
        <div className="row-actions">
          <button className="mbtn mbtn-ghost" onClick={onDecline}>
            Decline
          </button>
          <button className="mbtn mbtn-ink" onClick={onContinue} disabled={!verified && !known}>
            Continue to permissions
          </button>
        </div>
      </footer>
    </div>
  )
}

export type Start = 'none' | 'template' | 'all'

export function Review({
  vendor,
  verified,
  start,
  hasTemplate,
  grants,
  onStart,
  onToggle,
  onBegin,
  onBack,
}: {
  vendor: string
  verified: boolean
  start: Start
  hasTemplate: boolean
  grants: Grant[]
  onStart: (s: Start) => void
  onToggle: (id: string) => void
  onBegin: () => void
  onBack: () => void
}) {
  const count = grants.filter((g) => g.on).length
  return (
    <div className="page is-flow">
      <PageHead
        vendor={vendor}
        title={`What ${vendor} can do without asking`}
        meta="Anything else asks you first, on this machine."
      />
      <section className="page-sec">
        <div className="seg" role="radiogroup" aria-label="Start from">
          {(['none', 'template', 'all'] as Start[]).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={start === s}
              disabled={(s === 'template' && !hasTemplate) || (s === 'all' && !verified)}
              title={s === 'all' && !verified ? 'Not available when the sender is not verified' : undefined}
              onClick={() => onStart(s)}
            >
              {s === 'none' ? 'None' : s === 'template' ? 'What they asked for' : 'All'}
            </button>
          ))}
        </div>
        {start === 'all' && (
          <p className="warning-note">
            All lets {vendor} read and change any of your files, run any program and reach the internet without
            asking. Network, protected locations and admin rights still ask every time.
          </p>
        )}
        {grants.length ? (
          <PermissionList grants={grants} onToggle={onToggle} />
        ) : (
          <p className="empty">Nothing is allowed up front. Every action will ask you first.</p>
        )}
      </section>
      <footer className="page-foot">
        <div className="row-actions">
          <button className="mbtn mbtn-ghost" onClick={onBack}>
            Back
          </button>
          <button className="mbtn mbtn-ink" onClick={onBegin}>
            Start session with {count} {count === 1 ? 'permission' : 'permissions'}
          </button>
        </div>
      </footer>
    </div>
  )
}

export function PermissionList({ grants, onToggle }: { grants: Grant[]; onToggle: (id: string) => void }) {
  return (
    <div className="perms">
      {KINDS.filter((k) => grants.some((g) => g.kind === k)).map((k) => (
        <div key={k} className="perm-group">
          <h2 className="m-label">{k}</h2>
          {grants
            .filter((g) => g.kind === k)
            .map((g) => {
              const d = describe(g)
              return (
                <div key={g.id} className={`perm${g.on ? '' : ' is-off'}`}>
                  {/* the sentence, with the exact scope it stands for on hover or keyboard focus */}
                  <span className="perm-what" tabIndex={0}>
                    <span className="perm-text">
                      {d.verb} {d.code ? <code>{d.obj}</code> : d.obj}
                    </span>
                    <span className="perm-full">
                      {g.access} {g.scope}
                    </span>
                  </span>
                  <RiskBars risk={g.risk} />
                  <button
                    role="switch"
                    aria-checked={g.on}
                    aria-label={`${g.access} ${g.scope}`}
                    className="switch"
                    onClick={() => onToggle(g.id)}
                  />
                  {g.source === 'approved' && <FromRequest until={g.expiresAt} />}
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

function FromRequest({ until }: { until?: number }) {
  const text = `Added when you approved a request · ${until ? `until ${hhmm(until)}` : 'for this session'}`
  return (
    <span className="perm-origin" role="img" aria-label={text} tabIndex={0}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
        <path d="M5.5 7.6l1.7 1.6 3.3-3.4" />
      </svg>
      <span className="perm-tip" aria-hidden="true">
        {text}
      </span>
    </span>
  )
}

export function SessionBar({
  title,
  meta,
  endLabel,
  onEnd,
  onExtend,
}: {
  title: string
  meta: string
  endLabel: string
  onEnd: () => void
  onExtend?: () => void
}) {
  return (
    <div className="session-bar">
      <span className="dot" aria-hidden="true" />
      <b>{title}</b>
      <span className="m-meta">{meta}</span>
      {onExtend && (
        <button className="mbtn mbtn-ghost mbtn-sm" onClick={onExtend}>
          Add 15 min
        </button>
      )}
      <button className="mbtn mbtn-danger mbtn-sm" onClick={onEnd}>
        {endLabel}
      </button>
    </div>
  )
}

function PageHead({
  vendor,
  title = vendor,
  meta,
  children,
}: {
  vendor: string
  title?: string
  meta: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="page-head">
      <span className="vendor-mark" aria-hidden="true">
        {vendor[0]}
      </span>
      <div>
        <h1 className="m-title">{title}</h1>
        <p className="m-meta">{meta}</p>
      </div>
      {children}
    </header>
  )
}

export function Live({
  vendor,
  verified,
  startedAt,
  feed,
  grants,
  requests,
  onToggle,
}: {
  vendor: string
  verified: boolean
  startedAt: number
  feed: FeedItem[]
  requests: React.ReactNode[]
  grants: Grant[]
  onToggle: (id: string) => void
}) {
  const activity = useRef<HTMLElement>(null)
  const pinned = useRef(true)

  useLayoutEffect(() => {
    const el = activity.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [feed.length, requests.length])

  return (
    <div className="page live">
      <PageHead vendor={vendor} meta={`Live since ${hhmm(startedAt)}${verified ? '' : ' · name not verified'}`} />
      <div className="page-split">
        <section
          ref={activity}
          className="page-sec"
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          }}
        >
          <h2 className="m-label">Activity</h2>
          <Feed items={feed} initial={vendor[0]}>
            {requests}
            {feed.length <= 1 && !requests.length && (
              <li className="empty">
                Waiting for {vendor}. Anything outside your permissions will ask you first.
              </li>
            )}
          </Feed>
        </section>
        <aside className="page-sec perms-side" aria-label="Permissions">
          <div className="perms-head">
            <h2 className="m-label">Permissions · {grants.filter((g) => g.on).length}</h2>
            <p className="m-meta">Turn anything off and it stops working at once.</p>
          </div>
          {grants.length ? (
            <PermissionList grants={grants} onToggle={onToggle} />
          ) : (
            <p className="m-meta">None. Every action asks you first.</p>
          )}
        </aside>
      </div>
    </div>
  )
}

function Feed({ items, initial, children }: { items: FeedItem[]; initial: string; children?: React.ReactNode }) {
  return (
    <ol className="feed">
      {items.map((f) =>
        f.type === 'event' ? (
          <li key={f.id} className="event">
            <span>{f.text}</span>
          </li>
        ) : (
          <FeedRow key={f.id} item={f} initial={initial} />
        ),
      )}
      {children}
    </ol>
  )
}

const OUTCOME: Record<Outcome, { tip: string; path: string }> = {
  Allowed: { tip: 'Allowed by your permissions', path: 'M3.5 8.5l3 3 6-7' },
  Approved: { tip: 'Approved by you', path: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.2 8.2l2 2 3.8-4.3' },
  Denied: { tip: 'Denied', path: 'M4 4l8 8M12 4l-8 8' },
  Rejected: { tip: 'Turned back before you were asked', path: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM3.4 3.4l9.2 9.2' },
  Failed: { tip: 'Ran but failed', path: 'M8 2l6.5 11.5h-13zM8 6.5v3.2M8 11.6v.1' },
}

function OutcomeIcon({ outcome, method }: { outcome: Outcome; method?: string }) {
  const o = OUTCOME[outcome]
  const tip = method ? `${o.tip} ${method.toLowerCase() === 'click' ? 'with a click' : `with ${method}`}` : o.tip
  return (
    <span className={`outcome is-${outcome.toLowerCase()}`} role="img" aria-label={tip} data-tip={tip} tabIndex={0}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={o.path} />
      </svg>
    </span>
  )
}

function FeedRow({ item, initial }: { item: Extract<FeedItem, { type: 'action' }>; initial: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="feed-row">
      <span className="tile" aria-hidden="true">
        {initial}
      </span>
      <div>
        <p className="feed-head">
          <b>{item.tool}</b>
          <OutcomeIcon outcome={item.outcome} method={item.method} />
          <time>{clock(item.at)}</time>
        </p>
        <code className="feed-literal">
          {item.literal}
          {item.diff && <DiffStat lines={item.diff} />}
        </code>
        {item.note && <p className="feed-note">{item.note}</p>}
        {item.diff && (
          <div className="feed-diff">
            <Diff lines={item.diff} />
          </div>
        )}
        {item.output && (
          <>
            <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? 'Hide output' : `Show output · ${item.output.length} B`}
            </button>
            {open && <pre className="out">{item.output}</pre>}
          </>
        )}
      </div>
    </li>
  )
}

const ENDED_BY = {
  you: 'Ended by you',
  vendor: 'Ended by the vendor',
  time: 'Reached its time limit',
  closed: 'Valet closed before it ended',
}

export function SessionRecord({
  s,
  onExportJson,
  onExportPdf,
}: {
  s: PastSession
  onExportJson: () => Promise<boolean>
  onExportPdf: () => Promise<void>
}) {
  const acts = s.feed.filter((f): f is Extract<FeedItem, { type: 'action' }> => f.type === 'action')
  const n = (o: Outcome) => acts.filter((a) => a.outcome === o).length
  const slices: Slice[] = [
    { key: 'allowed', label: 'Allowed by permissions', value: n('Allowed') },
    { key: 'approved', label: 'Approved by you', value: n('Approved') },
    { key: 'denied', label: 'Denied or turned back', value: n('Denied') + n('Rejected') },
  ]
  if (n('Failed')) slices.push({ key: 'failed', label: 'Ran but failed', value: n('Failed') })
  return (
    <div className="page">
      <PageHead
        vendor={s.vendor}
        meta={`${day(s.startedAt)}–${hhmm(s.endedAt)} · ${minutes(s.endedAt - s.startedAt)} · ${ENDED_BY[s.endedBy]}`}
      >
        <ExportButton onExport={(f) => (f === 'json' ? onExportJson() : onExportPdf().then(() => false))} />
      </PageHead>
      <section className="page-sec">
        <OutcomeChart total={acts.length} slices={slices} />
        {s.endedBy !== 'closed' && (
          <p className="seal">
            <Check /> All permissions were revoked and its programs stopped when it ended
          </p>
        )}
      </section>
      <section className="page-sec">
        <h2 className="m-label">Activity</h2>
        <Feed items={s.feed} initial={s.vendor[0]} />
      </section>
    </div>
  )
}

function Check() {
  return (
    <svg className="check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}
