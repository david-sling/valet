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

export type GrantChoice = Need & { on: boolean }

export const api = {
  snapshot: () => invoke<Session[]>('snapshot'),
  join: (code: string) => invoke<Session>('join', { code }),
  decline: (id: string) => invoke<void>('decline', { id }),
  start: (id: string, grants: GrantChoice[]) => invoke<void>('start', { id, grants }),
  answer: (prompt: string, allow: boolean, scope?: Scope) => invoke<void>('answer', { prompt, allow, scope }),
  setGrant: (id: string, grant: string, on: boolean) => invoke<void>('set_grant', { id, grant, on }),
  extend: (id: string) => invoke<void>('extend', { id }),
  end: (id: string) => invoke<void>('end', { id }),
  onSessions: (f: (s: Session[]) => void) => listen<Session[]>('sessions', (e) => f(e.payload)),
}

export const message = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong.')
