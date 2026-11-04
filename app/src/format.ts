import type { Kind, Need, Risk } from '@valet/protocol'

export const KINDS: Kind[] = ['Files', 'Programs', 'Network', 'Environment', 'Processes', 'Admin rights']
export const RISK_WORD: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const SESSION_MINUTES = 60

export const VERB: Record<string, string> = {
  run_command: 'run a command',
  read_file: 'read a file',
  write_file: 'change a file',
  list_dir: 'list a folder',
  tail_log: 'read a log',
  list_processes: 'list your running programs',
}

export const clock = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
export function day(t: number) {
  const d = new Date(t)
  const label = sameDay(d, new Date())
    ? 'Today'
    : sameDay(d, new Date(Date.now() - 86_400_000))
      ? 'Yesterday'
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${label}, ${hhmm(t)}`
}
export const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`

const VERBS: Record<string, string> = {
  read: 'Read',
  write: 'Change',
  run: 'Run',
  connect: 'Connect to',
  list: 'See',
  signal: 'Stop',
  elevate: 'Use admin rights for',
}

// A permission as a short sentence: "Read config.json", "Run log". `code` marks the literal name, set in mono.
export function describe(g: Need): { verb: string; obj: string; code: boolean } {
  const verb = VERBS[g.access] ?? g.access
  const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
  if (g.scope === '*' || g.scope === '~/**') {
    const any: Record<Kind, string> = {
      Files: 'any of your files',
      Programs: 'any program',
      Network: 'any server',
      Environment: 'your environment variables',
      Processes: 'your running programs',
      'Admin rights': 'anything',
    }
    return { verb, obj: any[g.kind], code: false }
  }
  if (g.kind === 'Processes') return { verb, obj: 'your running programs', code: false }
  if (g.kind === 'Network') return { verb, obj: g.scope.replace(/:443$/, ''), code: true }
  if (g.scope.endsWith('/**')) {
    const parts = g.scope.slice(0, -3).split('/').filter(Boolean)
    return { verb: `${verb} anything in`, obj: `${parts.slice(-2).join('/')}/`, code: true }
  }
  return { verb, obj: base(g.scope), code: true }
}
