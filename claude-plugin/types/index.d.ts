export type ValetSession = {
  id: string
  name?: string
  purpose?: string
  code?: string
  joinUrl?: string
  expiresAt?: number
  state: string
  grants: string[]
  endsAt?: number
  base?: string
  isConfirmingEnd?: boolean
  endError?: string
}

export type ValetAction = {
  id: string
  tool: string
  target: string
  reason: string
  status: string
  output?: string
  error?: string
  isExpanded?: boolean
}

export type PastSession = ValetSession & { actions: ValetAction[] }

export type StartDraft = { name: string; purpose: string; isSent?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'valet-cards': {
      session: ValetSession | null
      actions: ValetAction[]
      history: PastSession[]
      viewing: number | null
      draft: StartDraft
    }
  }
}
