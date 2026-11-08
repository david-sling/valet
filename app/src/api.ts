import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Grant, Need, Risk, Scope } from '@valet/protocol'

export type Phase = 'joined' | 'live' | 'ended' | 'declined'
export type Outcome = 'Allowed' | 'Approved' | 'Denied' | 'Rejected' | 'Failed'

export type FeedItem =
  | { type: 'event'; id: number; at: number; text: string }
  | {
      type: 'action'
      id: number
      at: number
      tool: string
      literal: string
      outcome: Outcome
      method?: string
      output?: string
      diff?: string[]
      note?: string
    }

export type Prompt = {
  id: string
  tool: string
  literal: string
  program: string | null
  cwd: string | null
  needs: Need[]
  risk: Risk
  reason: string
  scopes: Scope[]
  askedAt: number
  diff: string[] | null
  output: string | null
  outputNext: number | null
  busy: boolean
}

export type Session = {
  id: string
  phase: Phase
  senderName: string
  purpose: string
  verified: boolean
  template: Need[]
  createdAt: number
  reviewUntil: number
  startedAt: number | null
  endsAt: number | null
  endedAt: number | null
  endedBy: 'client' | 'agent' | 'time' | 'closed' | null
  grants: Grant[]
  feed: FeedItem[]
  prompts: Prompt[]
}

export type ReleaseNote = { version: string; body: string }

export type Settings = { autoUpdate: boolean; keepDays: number | null }

export type GrantChoice = Need & { on: boolean }

export const api = {
  snapshot: () => invoke<Session[]>('snapshot'),
  join: (code: string) => invoke<Session>('join', { code }),
  decline: (id: string) => invoke<void>('decline', { id }),
  start: (id: string, grants: GrantChoice[]) => invoke<void>('start', { id, grants }),
  answer: (prompt: string, allow: boolean, scope?: Scope) => invoke<void>('answer', { prompt, allow, scope }),
  outputPage: (prompt: string, from: number) => invoke<{ text: string; next: number | null }>('output_page', { prompt, from }),
  setGrant: (id: string, grant: string, on: boolean) => invoke<void>('set_grant', { id, grant, on }),
  extend: (id: string) => invoke<void>('extend', { id }),
  end: (id: string) => invoke<void>('end', { id }),
  onSessions: (f: (s: Session[]) => void) => listen<Session[]>('sessions', (e) => f(e.payload)),
  onUpdate: (f: (version: string) => void) => listen<string>('update-ready', (e) => f(e.payload)),
  restart: () => invoke<void>('restart'),
  exportJson: (id: string, name: string) => invoke<boolean>('export_json', { id, name }),
  printReport: () => invoke<void>('print_report'),
  version: getVersion,
  checkUpdate: () => invoke<string | null>('check_update'),
  onCheckUpdate: (f: () => void) => listen('check-update', f),
  onOpenSettings: (f: () => void) => listen('open-settings', f),
  onUpdateFound: (f: (version: string) => void) => listen<string>('update-found', (e) => f(e.payload)),
  onUpdateProgress: (f: (percent: number | null) => void) => listen<number | null>('update-progress', (e) => f(e.payload)),
  onUpdateFailed: (f: () => void) => listen('update-failed', f),
  takeJoinLink: () => invoke<string | null>('take_join_link'),
  onJoinLink: (f: () => void) => listen('join-link', f),
  whatsNew: () => invoke<ReleaseNote[]>('whats_new'),
  forget: (id: string) => invoke<boolean>('forget', { id }),
  forgetAll: () => invoke<boolean>('forget_all'),
  settings: () => invoke<Settings>('settings'),
  setSettings: (settings: Settings) => invoke<void>('set_settings', { settings }),
}

export const message = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong.')
