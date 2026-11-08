import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import mockCss from '../mockup.css?url'
import { ALL, READS, SCOPE_LABEL, SESSION_MINUTES, TEMPLATE, VENDORS, decide, grantsFrom, hhmm, newCode, newHash, shortHash } from '#/components/mockup/engine'
import type { Action, Grant, Need, Scope, Vendor } from '#/components/mockup/engine'
import { Home, Join, Live, Review, SessionBar, SessionRecord, Sidebar } from '#/components/mockup/ClientScreens'
import type { FeedItem, Outcome, PastSession, Start } from '#/components/mockup/ClientScreens'
import { seedPast } from '#/components/mockup/seeds'
import { ApprovalPrompt } from '#/components/mockup/ApprovalPrompt'
import { AgentConsole } from '#/components/mockup/AgentConsole'
import type { LogEntry, Status } from '#/components/mockup/AgentConsole'

// A working mockup of the client app (the Tauri desktop app), for thinking through the session flow. Left: the
// app's window on a Mac desktop. Right: the agent's side, as the tool calls each vendor's agent can make. All of it
// is example content held in this page's state.
export const Route = createFileRoute('/mockup')({
  head: () => ({
    meta: [{ title: 'Valet · Client app mockup' }, { name: 'robots', content: 'noindex' }],
    links: [
      { rel: 'stylesheet', href: mockCss },
    ],
  }),
  component: Mockup,
})

type Screen = 'home' | 'join' | 'review' | 'live' | 'past'
// a session the vendor has created, waiting for the client to join it
type Invite = { code: string; vendor: Vendor; template: boolean; purpose: string; createdAt: number; logId: number }
// a request waiting for the client; it stays until they answer it or the session ends
type Pending = { id: number; logId: number; action: Action; needs: Need[]; askedAt: number; base?: Read }
// what the agent last read of a file: the hash it was given, and when
type Read = { hash: string; at: number }
// a live session: any number at once, one per vendor
type Session = {
  id: string
  vendor: Vendor
  startedAt: number
  endsAt: number
  grants: Grant[]
  feed: FeedItem[]
  queue: Pending[]
  reads: Record<string, Read> // by path
  logId: number
}
type Answer = { kind: 'deny' } | { kind: 'allow'; scope: Scope; method: string }

const STEPS: [Screen, string][] = [
  ['home', 'Join code'],
  ['join', 'Who is asking'],
  ['review', 'Permissions'],
  ['live', 'Live session'],
  ['past', 'Ended'],
]
const SESSION_MS = SESSION_MINUTES * 60_000
// only the client can extend a session, 15 minutes at a time, up to 3 hours from when it started
const EXTEND_MS = 15 * 60_000
const MAX_SESSION_MS = 3 * 60 * 60_000

function useNow(active: boolean) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [active])
  return now
}

const firstLine = (s: string) => s.split('\n')[0]
// grants an approval leaves behind: one the client already has (say, turned off earlier) is switched back on with
// the new time limit, rather than listed twice
const withGrants = (grants: Grant[], added: Grant[]) =>
  added.reduce((gs, n) => {
    const same = gs.find((g) => g.kind === n.kind && g.access === n.access && g.scope === n.scope)
    return same ? gs.map((g) => (g === same ? { ...g, on: true, source: 'approved' as const, expiresAt: n.expiresAt } : g)) : [...gs, n]
  }, grants)
const minsLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 60_000))

function Mockup() {
  const [screen, setScreen] = useState<Screen>('home')
  const [invites, setInvites] = useState<Invite[]>([])
  const [joining, setJoining] = useState<Invite | null>(null)
  const [start, setStart] = useState<Start>('template')
  const [draft, setDraft] = useState<Grant[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [past, setPast] = useState<PastSession[]>([])
  const [openPast, setOpenPast] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [joinError, setJoinError] = useState('')
  const [dark, setDark] = useState(false)
  const [agentVendor, setAgentVendor] = useState<Vendor>(VENDORS[0])
  const now = useNow(sessions.length > 0)
  useEffect(() => setPast(seedPast(Date.now())), [])
  const ids = useRef(0)
  const nid = () => ++ids.current

  const addLog = (e: Omit<LogEntry, 'id' | 'at'>) => {
    const id = nid()
    setLog((l) => [{ id, at: Date.now(), ...e }, ...l])
    return id
  }
  const patchLog = (id: number, status: Status, detail?: string) =>
    setLog((l) => l.map((e) => (e.id === id ? { ...e, status, detail } : e)))
  const patch = (id: string, fn: (s: Session) => Session) => setSessions((ss) => ss.map((s) => (s.id === id ? fn(s) : s)))
  const event = (text: string): FeedItem => ({ id: nid(), at: Date.now(), type: 'event', text })
  // the files on the client's machine, by path: each one's current content hash
  const files = useRef<Record<string, string>>({})
  const fileHash = (path: string) => (files.current[path] ??= newHash())
  // what a read or an edit that went through does to the hashes, and what the agent is told about it
  const applied = (sid: string, a: Action) => {
    const path = a.literal
    if (READS.has(a.tool)) {
      const hash = fileHash(path)
      patch(sid, (x) => ({ ...x, reads: { ...x.reads, [path]: { hash, at: Date.now() } } }))
      return ` · hash ${shortHash(hash)}`
    }
    if (a.tool === 'write_file') {
      const hash = (files.current[path] = newHash())
      patch(sid, (x) => ({ ...x, reads: { ...x.reads, [path]: { hash, at: Date.now() } } }))
      return ` · new hash ${shortHash(hash)}`
    }
    return ''
  }
  // an edit whose hash doesn't match the file as it is now never reaches the client: it's turned back at once
  const reject = (sid: string, a: Action, logId: number, base?: Read) => {
    const why = base ? 'The file changed after it was last read' : 'It had not read this file first'
    const item = { ...acted(a, 'Rejected'), note: `${why}, so the edit was turned back. It has to read the file again.` }
    patch(sid, (x) => ({ ...x, feed: [...x.feed, item] }))
    patchLog(logId, 'rejected', `read_first · ${base ? 'file changed since your last read' : 'no read on record'}`)
  }
  const acted = (a: Action, outcome: Outcome, method?: string): FeedItem => ({
    id: nid(),
    at: Date.now(),
    type: 'action',
    tool: a.tool,
    literal: a.literal,
    outcome,
    method,
    output: outcome === 'Allowed' || outcome === 'Approved' ? a.output : undefined,
    // a file change that went through keeps its diff on the event; a denied one changed nothing
    diff: outcome === 'Allowed' || outcome === 'Approved' ? a.diff : undefined,
  })
  const starting = (s: Start): Grant[] =>
    (s === 'all' ? ALL : s === 'template' ? TEMPLATE : []).map((n, i) => ({ ...n, id: `${s}-${i}`, on: true, source: 'proposed' }))

  // agent side, acting as the vendor picked at the top of the console
  const vendorSession = sessions.find((s) => s.vendor.name === agentVendor.name)
  const vendorInvite = invites.find((i) => i.vendor.name === agentVendor.name)
  const create = (o: { template: boolean; purpose: string }) => {
    const code = newCode()
    const logId = addLog({
      vendor: agentVendor.name,
      tool: 'create_session',
      arg: o.template ? 'with starting permissions' : 'no starting permissions',
      status: 'waiting',
      detail: `code ${code}`,
    })
    // a new invite replaces the vendor's unused one
    setInvites((is) => [...is.filter((i) => i.vendor.name !== agentVendor.name), { code, vendor: agentVendor, ...o, createdAt: Date.now(), logId }])
    setJoinError('')
  }
  const act = (a: Action) => {
    const s = vendorSession
    if (!s) return
    const logId = addLog({ vendor: s.vendor.name, tool: a.tool, arg: firstLine(a.literal), status: 'pending', detail: 'waiting for the client' })
    const base = s.reads[a.literal]
    if (a.tool === 'write_file' && base?.hash !== fileHash(a.literal)) return reject(s.id, a, logId, base)
    const d = decide(a, s.grants, Date.now())
    if (!d.ask) {
      const item = acted(a, 'Allowed')
      patch(s.id, (x) => ({ ...x, feed: [...x.feed, item] }))
      patchLog(logId, 'ok', firstLine(a.output) + applied(s.id, a))
      return
    }
    // the request waits for the client, with no time limit; the agent's other actions carry on meanwhile
    const pid = nid()
    const req: Pending = { id: pid, logId, action: a, needs: d.needs, askedAt: Date.now(), base: a.tool === 'write_file' ? base : undefined }
    patch(s.id, (x) => ({ ...x, queue: [...x.queue, req] }))
  }

  // client side: joining
  const openInvite = (inv: Invite) => {
    setJoinError('')
    setJoining(inv)
    setScreen('join')
  }
  const join = (typed: string) => {
    const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase()
    const inv = invites.find((i) => clean(i.code) === clean(typed))
    if (inv) openInvite(inv)
    else setJoinError("That code doesn't match an open session. Check it with whoever sent it.")
  }
  const decline = () => {
    if (!joining) return
    patchLog(joining.logId, 'declined', 'the client declined')
    setInvites((is) => is.filter((i) => i !== joining))
    setJoining(null)
    setScreen('home')
  }
  const toReview = () => {
    const s = joining?.template ? 'template' : 'none'
    setStart(s)
    setDraft(starting(s))
    setScreen('review')
  }
  const pickStart = (s: Start) => {
    setStart(s)
    setDraft(starting(s))
  }
  const begin = () => {
    if (!joining) return
    const on = draft.filter((g) => g.on).length
    const id = `live-${nid()}`
    const t = Date.now()
    setSessions((ss) => [
      ...ss,
      {
        id,
        vendor: joining.vendor,
        startedAt: t,
        endsAt: t + SESSION_MS,
        grants: draft,
        feed: [{ id: nid(), at: t, type: 'event', text: `Session started with ${on} ${on === 1 ? 'permission' : 'permissions'}` }],
        queue: [],
        reads: {},
        logId: joining.logId,
      },
    ])
    patchLog(joining.logId, 'started', `${on} permissions granted`)
    setInvites((is) => is.filter((i) => i !== joining))
    setJoining(null)
    setOpenId(id)
    setScreen('live')
  }

  // client side: live sessions
  const toggleLive = (sid: string, gid: string) =>
    patch(sid, (x) => {
      const g = x.grants.find((g) => g.id === gid)
      if (!g) return x
      return {
        ...x,
        grants: x.grants.map((y) => (y.id === gid ? { ...y, on: !y.on } : y)),
        feed: [...x.feed, event(`You turned ${g.on ? 'off' : 'on'} ${g.access} ${g.scope}`)],
      }
    })
  const resolve = (sid: string, p: Pending, r: Answer) => {
    const items: FeedItem[] = []
    let added: Grant[] = []
    if (r.kind === 'deny') {
      items.push(acted(p.action, 'Denied'))
      patchLog(p.logId, 'denied', 'by the client')
    } else if (p.base && p.base.hash !== fileHash(p.action.literal)) {
      // the file changed while the edit waited for an answer: it's turned back, even though the client said yes
      patch(sid, (x) => ({ ...x, queue: x.queue.filter((q) => q.id !== p.id) }))
      return reject(sid, p.action, p.logId, p.base)
    } else {
      items.push(acted(p.action, 'Approved', r.method))
      patchLog(p.logId, 'approved', `${SCOPE_LABEL[r.scope].toLowerCase()} · ${firstLine(p.action.output)}${applied(sid, p.action)}`)
      added = grantsFrom(p.needs, r.scope, Date.now()).map((n) => ({ ...n, id: `a-${nid()}`, on: true, source: 'approved' as const }))
      if (added.length)
        items.push(event(`You allowed ${added.map((n) => `${n.access} ${n.scope}`).join(', ')} for ${SCOPE_LABEL[r.scope].toLowerCase()}`))
    }
    patch(sid, (x) => ({
      ...x,
      queue: x.queue.filter((q) => q.id !== p.id),
      grants: withGrants(x.grants, added),
      feed: [...x.feed, ...items],
    }))
  }
  const end = (sid: string, by: PastSession['endedBy']) => {
    const s = sessions.find((x) => x.id === sid)
    if (!s) return
    const t = Date.now()
    s.queue.forEach((p) => patchLog(p.logId, 'ended', 'session ended before an answer'))
    if (by === 'vendor') addLog({ vendor: s.vendor.name, tool: 'end_session', arg: '', status: 'ok', detail: 'log sealed' })
    else addLog({ vendor: s.vendor.name, tool: 'session', arg: '', status: 'ended', detail: `${by === 'you' ? 'by the client' : 'time limit'} · log sealed` })
    const text = by === 'you' ? 'You ended the session' : by === 'vendor' ? `${s.vendor.name} ended the session` : 'The session reached its time limit'
    // the finished session moves to Past; if the client was looking at it, they land on its record
    const id = `p-${nid()}`
    setPast((ps) => [{ id, vendor: s.vendor.name, startedAt: s.startedAt, endedAt: t, endedBy: by, feed: [...s.feed, event(text)] }, ...ps])
    setSessions((ss) => ss.filter((x) => x.id !== sid))
    if (screen === 'live' && openId === sid) {
      setOpenPast(id)
      setScreen('past')
    }
  }
  const endAll = () => sessions.forEach((s) => end(s.id, 'you'))
  const canExtend = (s: Session) => s.endsAt + EXTEND_MS <= s.startedAt + MAX_SESSION_MS
  const extend = (sid: string) => {
    const s = sessions.find((x) => x.id === sid)
    if (!s || !canExtend(s)) return
    const endsAt = s.endsAt + EXTEND_MS
    patch(sid, (x) => ({ ...x, endsAt, feed: [...x.feed, event(`You extended the session by 15 minutes, to ${hhmm(endsAt)}`)] }))
    addLog({ vendor: s.vendor.name, tool: 'session', arg: '', status: 'extended', detail: `by the client · now ends ${hhmm(endsAt)}` })
  }

  const reset = () => {
    setInvites([])
    setJoining(null)
    setDraft([])
    setSessions([])
    setOpenId(null)
    setOpenPast(null)
    setPast(seedPast(Date.now()))
    setLog([])
    setJoinError('')
    setScreen('home')
  }

  // sessions run out on their own
  useEffect(() => {
    sessions.forEach((s) => {
      if (now >= s.endsAt) end(s.id, 'time')
    })
  })

  const open = screen === 'live' ? sessions.find((s) => s.id === openId) : undefined
  // the session bar: the session on screen, or everything that's live when the client is elsewhere
  const bar = open
    ? { title: open.vendor.name, meta: `connected · ${minsLeft(open.endsAt, now)} min left`, endLabel: 'End session', onEnd: () => end(open.id, 'you'), onExtend: canExtend(open) ? () => extend(open.id) : undefined }
    : sessions.length === 1
      ? { title: sessions[0].vendor.name, meta: `connected · ${minsLeft(sessions[0].endsAt, now)} min left`, endLabel: 'End session', onEnd: () => end(sessions[0].id, 'you'), onExtend: canExtend(sessions[0]) ? () => extend(sessions[0].id) : undefined }
      : sessions.length > 1
        ? { title: `${sessions.length} sessions live`, meta: sessions.map((s) => s.vendor.name).join(' · '), endLabel: 'End all', onEnd: endAll }
        : null

  return (
    <div className="mock">
      <header className="mock-top">
        <div className="mock-brand">
          <img src="/brand/valet-mark.svg" alt="" width={22} height={22} />
          <b>Valet</b>
          <span>Client app mockup · example session, nothing touches a real machine</span>
        </div>
        <ol className="flow" aria-label="Session flow">
          {STEPS.map(([s, label]) => (
            <li key={s} aria-current={s === screen ? 'step' : undefined}>
              {label}
            </li>
          ))}
        </ol>
        <button className="mbtn mbtn-ghost mbtn-sm" onClick={reset}>
          Reset
        </button>
      </header>

      <div className="mock-split">
        <main className="mock-stage" data-theme={dark ? 'dark' : undefined}>
          {/* the Mac desktop around the app: its menu bar, with Valet's menu-bar icon showing a live session */}
          <div className="menubar" aria-hidden="true">
            <b>Valet</b>
            <span>File</span>
            <span>Edit</span>
            <span>Window</span>
            <span>Help</span>
            <span className={`menubar-extra${sessions.length ? ' is-live' : ''}`}>
              <img src="/brand/valet-mark-mono.svg" alt="" width={15} height={15} />
            </span>
          </div>
          <div className="win">
            <div className="win-bar">
              <span className="lights" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="win-title">
                <img src="/brand/valet-mark.svg" alt="" width={14} height={14} />
                Valet
              </span>
            </div>
            {bar && <SessionBar {...bar} />}
            <div className="win-main">
              <Sidebar
                joining={screen === 'home' || screen === 'join' || screen === 'review'}
                ongoing={sessions.map((s) => ({ id: s.id, vendor: s.vendor.name, endsAt: s.endsAt, waiting: s.queue.length }))}
                openLive={open?.id ?? null}
                now={now}
                past={past}
                openPast={screen === 'past' ? openPast : null}
                dark={dark}
                onJoin={() => setScreen('home')}
                onLive={(id) => {
                  setOpenId(id)
                  setScreen('live')
                }}
                onPast={(id) => {
                  setOpenPast(id)
                  setScreen('past')
                }}
                onDark={() => setDark(!dark)}
              />
              <div className="win-body">
                {screen === 'home' && <Home onJoin={join} error={joinError} />}
                {screen === 'join' && joining && (
                  <Join
                    vendor={joining.vendor.name}
                    agent={joining.vendor.agent}
                    verified={joining.vendor.verified}
                    purpose={joining.purpose}
                    createdAt={joining.createdAt}
                    onContinue={toReview}
                    onDecline={decline}
                  />
                )}
                {screen === 'review' && joining && (
                  <Review
                    vendor={joining.vendor.name}
                    verified={joining.vendor.verified}
                    start={start}
                    hasTemplate={joining.template}
                    grants={draft}
                    onStart={pickStart}
                    onToggle={(gid) => setDraft((gs) => gs.map((g) => (g.id === gid ? { ...g, on: !g.on } : g)))}
                    onBegin={begin}
                    onBack={() => setScreen('join')}
                  />
                )}
                {open && (
                  <Live
                    key={open.id}
                    vendor={open.vendor.name}
                    agent={open.vendor.agent}
                    verified={open.vendor.verified}
                    startedAt={open.startedAt}
                    feed={open.feed}
                    grants={open.grants}
                    onToggle={(gid) => toggleLive(open.id, gid)}
                    requests={open.queue.map((p) => (
                      <ApprovalPrompt
                        key={p.id}
                        agent={open.vendor.agent}
                        action={p.action}
                        needs={p.needs}
                        askedAt={p.askedAt}
                        basedOn={p.base?.at}
                        now={now}
                        onDeny={() => resolve(open.id, p, { kind: 'deny' })}
                        onAllow={(scope, method) => resolve(open.id, p, { kind: 'allow', scope, method })}
                      />
                    ))}
                  />
                )}
                {screen === 'past' && past.some((p) => p.id === openPast) && (
                  <SessionRecord s={past.find((p) => p.id === openPast)!} />
                )}
              </div>
            </div>
          </div>
        </main>

        <AgentConsole
          key={agentVendor.name}
          vendor={agentVendor}
          onVendor={setAgentVendor}
          code={vendorInvite?.code ?? null}
          live={!!vendorSession}
          canCreate={!vendorSession && !(joining?.vendor.name === agentVendor.name && (screen === 'join' || screen === 'review'))}
          log={log.filter((e) => e.vendor === agentVendor.name)}
          onCreate={create}
          onOpenLink={() => vendorInvite && openInvite(vendorInvite)}
          onAction={act}
          onEnd={() => vendorSession && end(vendorSession.id, 'vendor')}
          reads={vendorSession?.reads ?? {}}
          onTouchFile={(path) => (files.current[path] = newHash())}
        />
      </div>
    </div>
  )
}
