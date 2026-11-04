// The mockup's stand-in for the client's policy: the permissions a session starts with, the actions the agent side
// can send, and the rule that decides whether an action runs straight away or asks the client first (PRD §7.2–7.4).
// Everything here is example content; nothing touches a real machine.

export type Risk = 'low' | 'medium' | 'high' | 'critical'
export type Kind = 'Files' | 'Programs' | 'Network' | 'Environment' | 'Processes' | 'Admin rights'
export type Need = { kind: Kind; access: string; scope: string; risk: Risk; protectedLabel?: string }
export type Grant = Need & { id: string; on: boolean; source: 'proposed' | 'approved'; expiresAt?: number }
export type Tool = 'run_command' | 'read_file' | 'write_file' | 'tail_log' | 'list_processes'
export type Action = {
  key: string
  tool: Tool
  literal: string
  cwd?: string
  program?: string
  needs: Need[]
  risk: Risk
  reason: string
  hint: string // what the agent-side panel says to expect, so the flow can be steered on purpose
  output: string
  diff?: string[] // for a file change: unified diff lines, each starting with '+', '-' or ' '
}

export const RISK_WORD: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const KINDS: Kind[] = ['Files', 'Programs', 'Network', 'Environment', 'Processes', 'Admin rights']

// Who can send a session link. Anyone can, without an account: their name is whatever they typed, so Valet can't
// vouch for it. Organisations can also sign up and be verified. Two senders here, so the client can hold more than
// one session at a time.
export const VENDORS = [
  {
    name: 'Sam Rivera',
    agent: 'Claude Code',
    verified: false,
    purpose: "Find out why the project won't build on your laptop.",
  },
  {
    name: 'Acme Inc.',
    agent: 'Acme support agent',
    verified: true,
    purpose: 'Find out why AcmeApp crashes on launch.',
  },
]
export type Vendor = (typeof VENDORS)[number]
export const SESSION_MINUTES = 60

const LOGS = '~/Library/Logs/AcmeApp/**'
const CONFIG = '~/Library/Application Support/AcmeApp/config.json'

// "AcmeApp crash triage", the template from PRD §8.1
export const TEMPLATE: Need[] = [
  { kind: 'Files', access: 'read', scope: LOGS, risk: 'low' },
  { kind: 'Files', access: 'read', scope: CONFIG, risk: 'low' },
  { kind: 'Programs', access: 'run', scope: '/usr/bin/log', risk: 'medium' },
  { kind: 'Programs', access: 'run', scope: '/usr/sbin/system_profiler', risk: 'medium' },
  { kind: 'Processes', access: 'list', scope: 'all', risk: 'low' },
]

// "All": everything that can be granted up front. Protected locations and admin rights still ask.
export const ALL: Need[] = [
  { kind: 'Files', access: 'read', scope: '~/**', risk: 'medium' },
  { kind: 'Files', access: 'write', scope: '~/**', risk: 'high' },
  { kind: 'Programs', access: 'run', scope: '*', risk: 'high' },
  { kind: 'Network', access: 'connect', scope: '*', risk: 'high' },
  { kind: 'Environment', access: 'read', scope: '*', risk: 'low' },
  { kind: 'Processes', access: 'list', scope: 'all', risk: 'low' },
  { kind: 'Processes', access: 'signal', scope: 'all', risk: 'medium' },
]

export const ACTIONS: Action[] = [
  {
    key: 'ps',
    tool: 'list_processes',
    literal: 'list_processes',
    needs: [{ kind: 'Processes', access: 'list', scope: 'all', risk: 'low' }],
    risk: 'low',
    reason: 'Checking whether AcmeApp is still running after the crash.',
    hint: 'Inside the template',
    output: 'AcmeApp (4121) · AcmeApp Helper (4130) · WindowServer (312) · 214 more',
  },
  {
    key: 'config',
    tool: 'read_file',
    literal: CONFIG,
    needs: [{ kind: 'Files', access: 'read', scope: CONFIG, risk: 'low' }],
    risk: 'low',
    reason: 'Reading the app settings to see which renderer it uses.',
    hint: 'Inside the template',
    output: '{ "renderer": "opengl", "gpu.vsync": true, "telemetry": false }',
  },
  {
    key: 'read-gpu',
    tool: 'read_file',
    literal: '~/Library/Application Support/AcmeApp/gpu-profiles.json',
    needs: [{ kind: 'Files', access: 'read', scope: '~/Library/Application Support/AcmeApp/gpu-profiles.json', risk: 'low' }],
    risk: 'low',
    reason: 'Reading the GPU profiles before changing them.',
    hint: 'Not in the template; read before the longer change',
    output: '{ "profiles": [ { "name": "default", "backend": "opengl" }, … ], "version": 3 }',
  },
  {
    key: 'tail',
    tool: 'tail_log',
    literal: '~/Library/Logs/AcmeApp/main.log',
    needs: [{ kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/main.log', risk: 'low' }],
    risk: 'low',
    reason: 'Reading the last lines of the app log before the crash.',
    hint: 'Inside the template',
    output: '[14:01:52] GL context lost (0x0507)\n[14:01:52] renderer: fatal, exiting',
  },
  {
    key: 'logshow',
    tool: 'run_command',
    literal: 'log show --predicate \'process == "AcmeApp"\' --last 1h',
    cwd: '~',
    program: '/usr/bin/log',
    needs: [{ kind: 'Programs', access: 'run', scope: '/usr/bin/log', risk: 'medium' }],
    risk: 'medium',
    reason: 'Pulling the system log entries for AcmeApp from the last hour.',
    hint: 'Template program',
    output: 'AcmeApp: [com.apple.opengl] GLD: context reset by driver (AMD 1.2.3)',
  },
  {
    key: 'profiler',
    tool: 'run_command',
    literal: 'system_profiler SPDisplaysDataType',
    cwd: '~',
    program: '/usr/sbin/system_profiler',
    needs: [{ kind: 'Programs', access: 'run', scope: '/usr/sbin/system_profiler', risk: 'medium' }],
    risk: 'medium',
    reason: 'Checking the graphics card and driver version.',
    hint: 'Template program; asks if the client removed it',
    output: 'Chipset Model: AMD Radeon Pro 5500M · Metal Support: Metal 3',
  },
  {
    key: 'write',
    tool: 'write_file',
    literal: CONFIG,
    diff: [' {', '-  "renderer": "opengl",', '+  "renderer": "metal",', '   "gpu.vsync": true,', '   "telemetry": false', ' }'],
    needs: [{ kind: 'Files', access: 'write', scope: CONFIG, risk: 'medium' }],
    risk: 'medium',
    reason: 'Switching the renderer to Metal, which avoids the driver bug.',
    hint: 'Not in the template',
    output: 'wrote 61 bytes',
  },
  {
    key: 'write-long',
    tool: 'write_file',
    literal: '~/Library/Application Support/AcmeApp/gpu-profiles.json',
    diff: [
      ' {',
      '   "profiles": [',
      '     {',
      '       "name": "default",',
      '-      "backend": "opengl",',
      '-      "msaa": 8,',
      '-      "shaderCache": false',
      '+      "backend": "metal",',
      '+      "msaa": 4,',
      '+      "shaderCache": true,',
      '+      "shaderCacheDir": "~/Library/Caches/AcmeApp/shaders"',
      '     },',
      '     {',
      '       "name": "low-power",',
      '-      "backend": "opengl",',
      '+      "backend": "metal",',
      '       "msaa": 0',
      '     }',
      '   ],',
      '+  "fallback": "software",',
      '   "version": 3',
      ' }',
    ],
    needs: [{ kind: 'Files', access: 'write', scope: '~/Library/Application Support/AcmeApp/gpu-profiles.json', risk: 'medium' }],
    risk: 'medium',
    reason: 'Moving every GPU profile to Metal and turning on the shader cache.',
    hint: 'Longer change, shown collapsed',
    output: 'wrote 412 bytes',
  },
  {
    key: 'curl',
    tool: 'run_command',
    literal: 'curl -s https://api.acme.com/v1/drivers/latest',
    cwd: '~',
    program: '/usr/bin/curl',
    needs: [
      { kind: 'Programs', access: 'run', scope: '/usr/bin/curl', risk: 'medium' },
      { kind: 'Network', access: 'connect', scope: 'api.acme.com:443', risk: 'high' },
    ],
    risk: 'high',
    reason: 'Checking the latest driver Acme recommends.',
    hint: 'Network: always asks',
    output: '{ "recommended": "AMD 1.2.6" }',
  },
  {
    key: 'ssh',
    tool: 'read_file',
    literal: '~/.ssh/id_rsa',
    needs: [{ kind: 'Files', access: 'read', scope: '~/.ssh/id_rsa', risk: 'high', protectedLabel: 'SSH private key' }],
    risk: 'high',
    reason: 'Reading the crash log to find the error.',
    hint: 'Protected location, misleading reason',
    output: '(file contents)',
  },
  {
    key: 'sudo',
    tool: 'run_command',
    literal: 'sudo softwareupdate --install --all',
    cwd: '~',
    program: '/usr/sbin/softwareupdate',
    needs: [{ kind: 'Admin rights', access: 'elevate', scope: '/usr/sbin/softwareupdate', risk: 'critical' }],
    risk: 'critical',
    reason: 'Installing the pending macOS graphics driver update.',
    hint: 'Admin rights: can never be pre-granted',
    output: 'Software Update Tool: Installing 1 update',
  },
]

export const VERB: Record<Tool, string> = {
  run_command: 'run a command',
  read_file: 'read a file',
  write_file: 'change a file',
  tail_log: 'read a log',
  list_processes: 'list your running programs',
}

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 }
export const maxRisk = (rs: Risk[]) => rs.reduce<Risk>((a, r) => (RANK[r] > RANK[a] ? r : a), 'low')

export function covers(g: Grant, n: Need, now: number) {
  if (!g.on || g.kind !== n.kind || g.access !== n.access) return false
  if (g.expiresAt && g.expiresAt < now) return false
  // a protected location is only ever covered by the client allowing it from a prompt, never by a starting grant
  if (n.protectedLabel && g.source !== 'approved') return false
  if (g.scope === n.scope || g.scope === '*') return true
  return g.scope.endsWith('/**') && n.scope.startsWith(g.scope.slice(0, -2))
}

export type Decision = { ask: false } | { ask: true; needs: Need[] }

export function decide(a: Action, grants: Grant[], now: number): Decision {
  // critical always asks; high asks even when granted, unless the client allowed it from a prompt this session
  if (a.risk === 'critical') return { ask: true, needs: a.needs }
  const ok = (n: Need) =>
    grants.some((g) => covers(g, n, now) && (a.risk !== 'high' || g.source === 'approved'))
  const needs = a.needs.filter((n) => !ok(n))
  return needs.length ? { ask: true, needs } : { ask: false }
}

export type Scope = 'once' | 'session' | '15m' | 'folder'
export const SCOPE_LABEL: Record<Scope, string> = {
  once: 'Once',
  session: 'This session',
  '15m': '15 minutes',
  folder: 'This folder',
}

export function scopesFor(a: Action): Scope[] {
  if (a.risk === 'critical') return ['once']
  const path = a.needs.some((n) => n.kind === 'Files')
  return path ? ['once', 'session', '15m', 'folder'] : ['once', 'session', '15m']
}

// the grants a "this session", "15 minutes" or "this folder" approval leaves behind
export function grantsFrom(needs: Need[], scope: Scope, now: number): Array<Need & { expiresAt?: number }> {
  if (scope === 'once') return []
  return needs.map((n) => ({
    ...n,
    scope: scope === 'folder' && n.kind === 'Files' ? n.scope.replace(/\/[^/]*$/, '/**') : n.scope,
    expiresAt: scope === '15m' ? now + 15 * 60_000 : undefined,
  }))
}

const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY34679'
export function newCode() {
  const pick = () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return `${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`
}

export const clock = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
// "Today, 14:02", "Yesterday, 09:40", "2 Nov, 16:15"
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
// A permission as a short sentence: "Read config.json", "Run log", "Connect to api.acme.com". `code` marks the part
// that is a literal name, set in mono; the full scope is always shown alongside on hover.
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
    // a folder: its last two names, so "Logs/AcmeApp/" isn't mistaken for another AcmeApp folder
    const parts = g.scope.slice(0, -3).split('/').filter(Boolean)
    return { verb: `${verb} anything in`, obj: `${parts.slice(-2).join('/')}/`, code: true }
  }
  return { verb, obj: base(g.scope), code: true }
}

// Every read returns the file's content hash, and every edit must carry the hash of the version it read. If the file
// has changed since, or was never read, the client rejects the edit before asking anyone: the agent reads again first.
export const READS = new Set<Tool>(['read_file', 'tail_log'])
export const newHash = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
export const shortHash = (h: string) => `sha256:${h.slice(0, 4)}…${h.slice(-4)}`
