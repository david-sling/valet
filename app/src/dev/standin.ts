// Development only: stands in for the Rust core when the webview runs in a plain browser, so the screens can be
// checked without the app. Nothing here runs a command or reaches the relay.

import type { FeedItem, GrantChoice, Prompt, Session } from '../api'

type Callback = (msg: unknown) => void

const callbacks = new Map<number, Callback>()
const listeners: number[] = []
let sessions: Session[] = []
let n = 0

const emit = () => listeners.forEach((id) => callbacks.get(id)?.({ event: 'sessions', id, payload: sessions }))
const patch = (id: string, f: (s: Session) => Session) => {
  sessions = sessions.map((s) => (s.id === id ? f(s) : s))
  emit()
}
const event = (text: string): FeedItem => ({ type: 'event', id: ++n, at: Date.now(), text })

const PROMPTS: Omit<Prompt, 'id' | 'askedAt' | 'busy'>[] = [
  {
    tool: 'write_file',
    literal: '~/Library/Application Support/AcmeApp/config.json',
    program: null,
    cwd: null,
    needs: [{ kind: 'Files', access: 'write', scope: '~/Library/Application Support/AcmeApp/config.json', risk: 'medium' }],
    risk: 'medium',
    reason: 'Switching the renderer to Metal, which avoids the driver bug.',
    scopes: ['once', 'session', '15m', 'folder'],
    diff: [' {', '-  "renderer": "opengl",', '+  "renderer": "metal",', '   "gpu.vsync": true', ' }'],
  },
  {
    tool: 'run_command',
    literal: '/usr/bin/curl -s https://api.acme.com/v1/drivers/latest',
    program: '/usr/bin/curl',
    cwd: null,
    needs: [
      { kind: 'Programs', access: 'run', scope: '/usr/bin/curl', risk: 'medium' },
      { kind: 'Network', access: 'connect', scope: '*', risk: 'high' },
    ],
    risk: 'high',
    reason: 'Checking the latest driver Acme recommends.',
    scopes: ['once', 'session', '15m'],
    diff: null,
  },
]

function handle(cmd: string, args: Record<string, unknown>): unknown {
  const id = args.id as string
  switch (cmd) {
    case 'snapshot':
      return sessions
    case 'join': {
      const s: Session = {
        id: `s${++n}`,
        phase: 'joined',
        senderName: 'Northwind support',
        purpose: 'Find out why AcmeApp crashes on launch by reading its log and config.',
        verified: false,
        template: [
          { kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/**', risk: 'low' },
          { kind: 'Programs', access: 'run', scope: '/usr/sbin/system_profiler', risk: 'medium' },
          { kind: 'Processes', access: 'list', scope: 'all', risk: 'low' },
        ],
        createdAt: Date.now() - 90_000,
        reviewUntil: Date.now() + 600_000,
        startedAt: null,
        endsAt: null,
        endedAt: null,
        endedBy: null,
        grants: [],
        feed: [],
        prompts: [],
      }
      sessions = [s, ...sessions]
      emit()
      return s
    }
    case 'decline':
      sessions = sessions.filter((s) => s.id !== id)
      emit()
      return null
    case 'start': {
      const grants = (args.grants as GrantChoice[]).map((g, i) => ({
        ...g,
        id: `g${i}`,
        source: 'proposed' as const,
      }))
      patch(id, (s) => ({
        ...s,
        phase: 'live',
        startedAt: Date.now(),
        endsAt: Date.now() + 3_600_000,
        grants,
        feed: [
          event(`Session started with ${grants.filter((g) => g.on).length} permissions`),
          { type: 'action', id: ++n, at: Date.now(), tool: 'tail_log', literal: '~/Library/Logs/AcmeApp/main.log', outcome: 'Allowed', output: '[14:01:52] GL context lost (0x0507)\n[14:01:52] renderer: fatal, exiting' },
        ],
      }))
      PROMPTS.forEach((p, i) =>
        setTimeout(() => patch(id, (s) => ({ ...s, prompts: [...s.prompts, { ...p, id: `p${++n}`, askedAt: Date.now(), busy: false }] })), 800 * (i + 1)),
      )
      return null
    }
    case 'answer': {
      const s = sessions.find((x) => x.prompts.some((p) => p.id === args.prompt))
      const p = s?.prompts.find((x) => x.id === args.prompt)
      if (!s || !p) throw 'That request is no longer waiting.'
      const outcome = args.allow ? 'Approved' : 'Denied'
      const method = args.allow ? (p.risk === 'high' ? 'Touch ID' : 'Click') : undefined
      patch(s.id, (x) => ({
        ...x,
        prompts: x.prompts.filter((q) => q.id !== p.id),
        feed: [...x.feed, { type: 'action', id: ++n, at: Date.now(), tool: p.tool, literal: p.literal, outcome, method, diff: p.diff ?? undefined }],
      }))
      return null
    }
    case 'set_grant':
      patch(id, (s) => ({ ...s, grants: s.grants.map((g) => (g.id === args.grant ? { ...g, on: args.on as boolean } : g)) }))
      return null
    case 'extend':
      patch(id, (s) => ({ ...s, endsAt: (s.endsAt ?? 0) + 900_000, feed: [...s.feed, event('Added 15 minutes')] }))
      return null
    case 'end':
      patch(id, (s) => ({
        ...s,
        phase: 'ended',
        endedAt: Date.now(),
        endedBy: 'client',
        prompts: [],
        grants: s.grants.map((g) => ({ ...g, on: false })),
        feed: [...s.feed, event('You ended the session')],
      }))
      return null
    case 'take_join_link':
      return null
    case 'plugin:event|listen':
      if (args.event === 'sessions') listeners.push(args.handler as number)
      return args.handler
    default:
      return null
  }
}

let next = 0
Object.assign(window, {
  __TAURI_INTERNALS__: {
    transformCallback: (cb: Callback) => {
      callbacks.set(++next, cb)
      return next
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => handle(cmd, args),
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
})
