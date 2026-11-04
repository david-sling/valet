import { useEffect, useState } from 'react'
import type { Grant } from '@valet/protocol'
import { api, message } from './api'
import type { Session } from './api'
import { ApprovalPrompt } from './components/ApprovalPrompt'
import { Home, Join, Live, Review, SessionBar, SessionRecord, Sidebar } from './components/screens'
import type { PastSession, Start } from './components/screens'

type Screen = 'home' | 'join' | 'review' | 'live' | 'past'

const EXTEND_MS = 15 * 60_000
const MAX_SESSION_MS = 3 * 60 * 60_000
const ENDED_BY = { client: 'you', agent: 'vendor', time: 'time', closed: 'closed' } as const

const minsLeft = (endsAt: number | null, now: number) => Math.max(0, Math.ceil(((endsAt ?? now) - now) / 60_000))
const canExtend = (s: Session) => !!s.startedAt && !!s.endsAt && s.endsAt + EXTEND_MS <= s.startedAt + MAX_SESSION_MS

function storedDark() {
  try {
    const v = localStorage.getItem('theme')
    if (v) return v === 'dark'
  } catch {
    // storage can be unavailable
  }
  return matchMedia('(prefers-color-scheme: dark)').matches
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const fromTemplate = (s: Session): Grant[] =>
  s.template.map((n, i) => ({ ...n, id: `t${i}`, on: true, source: 'proposed' as const }))

export function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [screen, setScreen] = useState<Screen>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const [start, setStart] = useState<Start>('template')
  const [draft, setDraft] = useState<Grant[]>([])
  const [joinError, setJoinError] = useState('')
  const [error, setError] = useState('')
  const [dark, setDark] = useState(storedDark)
  const [update, setUpdate] = useState<string | null>(null)
  const now = useNow(1000)

  useEffect(() => {
    api.snapshot().then(setSessions, () => undefined)
    const off = [api.onSessions(setSessions), api.onUpdate(setUpdate)]
    return () => {
      off.forEach((o) => o.then((f) => f()))
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light')
    } catch {
      // storage can be unavailable
    }
  }, [dark])

  const open = sessions.find((s) => s.id === openId)
  useEffect(() => {
    if (screen === 'live' && open?.phase === 'ended') setScreen('past')
    if ((screen === 'join' || screen === 'review') && open?.phase !== 'joined') setScreen('home')
  }, [screen, open?.phase])

  const attempt = (p: Promise<unknown>) => {
    setError('')
    return p.catch((e: unknown) => {
      setError(message(e))
      throw e
    })
  }

  const join = (code: string) => {
    setJoinError('')
    api.join(code).then(
      (s) => {
        setOpenId(s.id)
        setStart(s.template.length ? 'template' : 'none')
        setDraft(fromTemplate(s))
        setScreen('join')
      },
      (e: unknown) => setJoinError(message(e)),
    )
  }

  const pickStart = (s: Start) => {
    if (!open) return
    setStart(s)
    setDraft(s === 'template' ? fromTemplate(open) : [])
  }

  const begin = () => {
    if (!open) return
    const grants = draft.map(({ id: _id, source: _source, expiresAt: _at, ...need }) => need)
    attempt(api.start(open.id, grants)).then(() => setScreen('live'), () => undefined)
  }

  const end = (id: string) => attempt(api.end(id)).catch(() => undefined)
  const live = sessions.filter((s) => s.phase === 'live')
  const shown = screen === 'live' && open?.phase === 'live' ? open : undefined
  const barFor = (s: Session) => ({
    title: s.senderName,
    meta: `connected · ${minsLeft(s.endsAt, now)} min left`,
    endLabel: 'End session',
    onEnd: () => end(s.id),
    onExtend: canExtend(s) ? () => attempt(api.extend(s.id)).catch(() => undefined) : undefined,
  })
  const bar = shown
    ? barFor(shown)
    : live.length === 1
      ? barFor(live[0])
      : live.length > 1
        ? {
            title: `${live.length} sessions live`,
            meta: live.map((s) => s.senderName).join(' · '),
            endLabel: 'End all',
            onEnd: () => live.forEach((s) => end(s.id)),
          }
        : null

  const past: PastSession[] = sessions
    .filter((s) => s.phase === 'ended')
    .map((s) => ({
      id: s.id,
      vendor: s.senderName,
      startedAt: s.startedAt ?? s.createdAt,
      endedAt: s.endedAt ?? now,
      endedBy: ENDED_BY[s.endedBy ?? 'agent'],
      feed: s.feed,
    }))
  const record = screen === 'past' ? past.find((p) => p.id === openId) : undefined

  return (
    <div className="app">
      <div>
        {update && (
          <div className="update-bar" role="status">
            <span>Valet {update} is installed.</span>
            <span className="m-meta">{live.length ? 'Restarting ends your live sessions.' : 'Restart to use it.'}</span>
            <button className="mbtn mbtn-ghost mbtn-sm" onClick={() => attempt(api.restart()).catch(() => undefined)}>
              Restart
            </button>
          </div>
        )}
        {bar && <SessionBar {...bar} />}
      </div>
      <div className="win-main">
        <Sidebar
          joining={screen === 'home' || screen === 'join' || screen === 'review'}
          ongoing={live.map((s) => ({ id: s.id, vendor: s.senderName, endsAt: s.endsAt ?? now, waiting: s.prompts.length }))}
          openLive={shown?.id ?? null}
          now={now}
          past={past}
          openPast={record?.id ?? null}
          dark={dark}
          onJoin={() => setScreen('home')}
          onLive={(id) => {
            setOpenId(id)
            setScreen('live')
          }}
          onPast={(id) => {
            setOpenId(id)
            setScreen('past')
          }}
          onDark={() => setDark(!dark)}
        />
        <div className="win-body">
          {error && (
            <p className="m-error app-error" role="alert">
              {error}
            </p>
          )}
          {screen === 'home' && <Home onJoin={join} error={joinError} />}
          {screen === 'join' && open && (
            <Join
              vendor={open.senderName}
              verified={open.verified}
              purpose={open.purpose}
              createdAt={open.createdAt}
              onContinue={() => setScreen('review')}
              onDecline={() => attempt(api.decline(open.id)).finally(() => setScreen('home')).catch(() => undefined)}
            />
          )}
          {screen === 'review' && open && (
            <Review
              vendor={open.senderName}
              verified={open.verified}
              start={start}
              hasTemplate={open.template.length > 0}
              grants={draft}
              onStart={pickStart}
              onToggle={(gid) => setDraft((gs) => gs.map((g) => (g.id === gid ? { ...g, on: !g.on } : g)))}
              onBegin={begin}
              onBack={() => setScreen('join')}
            />
          )}
          {shown && (
            <Live
              key={shown.id}
              vendor={shown.senderName}
              verified={shown.verified}
              startedAt={shown.startedAt ?? now}
              feed={shown.feed}
              grants={shown.grants}
              onToggle={(gid) => {
                const g = shown.grants.find((x) => x.id === gid)
                if (g) attempt(api.setGrant(shown.id, gid, !g.on)).catch(() => undefined)
              }}
              requests={shown.prompts.map((p) => (
                <ApprovalPrompt
                  key={p.id}
                  vendor={shown.senderName}
                  prompt={p}
                  now={now}
                  onAnswer={(allow, scope) => api.answer(p.id, allow, scope)}
                />
              ))}
            />
          )}
          {record && <SessionRecord s={record} />}
        </div>
      </div>
    </div>
  )
}
