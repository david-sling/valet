import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PastSession, StartDraft, ValetAction, ValetSession } from '../types'

const PANE = 'valet'
const MAX_OUTPUT = 1500
const session = atom({ plugin: 'valet-cards', key: 'session' } as const, null)
const actions = atom({ plugin: 'valet-cards', key: 'actions' } as const, [])
const history = atom({ plugin: 'valet-cards', key: 'history' } as const, [])
const viewing = atom({ plugin: 'valet-cards', key: 'viewing' } as const, null)
const draft = atom({ plugin: 'valet-cards', key: 'draft' } as const, { name: '', purpose: '' })
const MAX_HISTORY = 20

type Json = Record<string, any>

const seen = new Map<string, number>()

async function dir($: any): Promise<string> {
  const tmp = (await $.env.get('TMPDIR')) || '/tmp'
  return `${tmp.replace(/\/+$/, '')}/valet-session`
}

async function json($: any, path: string): Promise<Json | null> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… ${text.length - MAX_OUTPUT} more characters` : text
}

function describeOutput(output: unknown): string | undefined {
  if (output == null) return undefined
  if (typeof output !== 'object') return clip(String(output))
  const o = output as Json
  if (typeof o.content === 'string') return clip(o.content)
  if (Array.isArray(o.entries)) {
    return clip(o.entries.map((x: Json) => (x.type === 'dir' ? `${x.name}/` : `${x.name}  ${x.size ?? ''}`.trim())).join('\n'))
  }
  if (Array.isArray(o.processes)) {
    return clip(o.processes.map((x: Json) => `${x.pid}  ${x.name}`).join('\n'))
  }
  if ('stdout' in o || 'stderr' in o) {
    const parts = [`exit ${o.exit_code}`, o.stdout, o.stderr && `stderr:\n${o.stderr}`]
    return clip(parts.filter(Boolean).join('\n'))
  }
  return clip(JSON.stringify(output))
}

const PREVIEW_LINES = 8

function preview(output: string): { text: string; hidden: number } {
  const lines = output.split('\n')
  return { text: lines.slice(0, PREVIEW_LINES).join('\n'), hidden: Math.max(0, lines.length - PREVIEW_LINES) }
}

function describeTarget(args: Json | undefined): string {
  if (!args) return ''
  if (Array.isArray(args.command)) return args.command.join(' ')
  return typeof args.path === 'string' ? args.path : ''
}

function describeGrant(grant: unknown): string {
  const g = (grant ?? {}) as Json
  return g.kind ? `${g.kind} ${g.access ?? ''} ${g.scope ?? ''}`.trim() : JSON.stringify(grant)
}

// Outputs from the other person's machine stay in this session; only the summary is kept across sessions.
async function archive($: any): Promise<void> {
  const s = await read($, session)
  if (!s) return
  const past: PastSession = { ...s, isConfirmingEnd: false, endError: undefined, actions: await read($, actions) }
  await update($, history, list => [...list, past].slice(-MAX_HISTORY))
  const kept = (await read($, history)).map(h => ({ ...h, actions: h.actions.map(a => ({ ...a, output: undefined, isExpanded: false })) }))
  await $.store.set('history', kept)
}

// Reads only the fields it shows: session.json also holds the agent token.
async function ingest($: any): Promise<void> {
  const w = await dir($)
  let entries: { name: string; mtimeMs: number }[]
  try {
    entries = await $.fs.list(w)
  } catch {
    return
  }
  const changed = new Set(
    entries.filter(f => seen.get(f.name) !== f.mtimeMs).map(f => (seen.set(f.name, f.mtimeMs), f.name)),
  )

  if (changed.has('session.json')) {
    const j = await json($, `${w}/session.json`)
    const current = await read($, session)
    if (j?.session_id && current?.id !== j.session_id) {
      await archive($)
      await update($, viewing, () => null)
      await update($, draft, d => ({ ...d, purpose: '', isSent: false }))
      await update($, session, () => ({ id: j.session_id, state: 'invited', grants: [] }))
      await update($, actions, () => [])
    }
    if (j?.session_id) {
      await update($, session, s => s && { ...s, code: j.code, joinUrl: j.join_url, expiresAt: j.expires_at })
    }
  }

  if (changed.has('create.json')) {
    const j = await json($, `${w}/create.json`)
    if (j) await update($, session, s => s && { ...s, name: j.name, purpose: j.purpose })
  }

  if (changed.has('status.json')) {
    const j = await json($, `${w}/status.json`)
    if (j?.state) {
      await update($, session, s => s && {
        ...s,
        state: j.state,
        grants: Array.isArray(j.grants) ? j.grants.map(describeGrant) : s.grants,
        endsAt: j.ends_at ?? s.endsAt,
      })
    }
  }

  if (changed.has('result.json')) {
    const j = await json($, `${w}/result.json`)
    const sent = await json($, `${w}/action.json`)
    if (j?.action_id) {
      const action: ValetAction = {
        id: j.action_id,
        tool: sent?.tool ?? 'action',
        target: describeTarget(sent?.args),
        reason: sent?.reason ?? '',
        status: j.status ?? 'unknown',
        output: describeOutput(j.output),
        error: j.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : undefined,
      }
      await update($, actions, list =>
        list.some(a => a.id === action.id)
          ? list.map(a => (a.id === action.id ? { ...a, ...action, tool: a.tool, target: a.target, reason: a.reason } : a))
          : [...list, action].slice(-100),
      )
      if (j.session_state) await update($, session, s => s && { ...s, state: j.session_state })
    }
  }
}

const OVER = ['ended', 'declined', 'expired']

// Sends the token only to the relay that issued the join link.
async function endSession($: any): Promise<void> {
  const s = await read($, session)
  if (!s?.base || !s.joinUrl || OVER.includes(s.state)) return
  if (new URL(s.base).origin !== new URL(s.joinUrl).origin) {
    await update($, session, v => v && { ...v, isConfirmingEnd: false, endError: 'Relay address does not match the join link.' })
    return
  }
  const w = await dir($)
  let token: string
  try {
    token = (await $.fs.read(`${w}/token`)).trim()
  } catch {
    await update($, session, v => v && { ...v, isConfirmingEnd: false, endError: 'No session token found.' })
    return
  }
  const { stdout } = await $.process.run(
    ['curl', '-sS', '--http1.1', '-X', 'POST', `${s.base}/sessions/${encodeURIComponent(s.id)}/end`,
      '-H', '@-', '-o', '/dev/null', '-w', '%{http_code}'],
    { stdin: `Authorization: Bearer ${token}\n` },
  )
  const code = stdout.trim()
  await update($, session, v =>
    v && (code === '200' || code === '410'
      ? { ...v, state: 'ended', isConfirmingEnd: false, endError: undefined }
      : { ...v, isConfirmingEnd: false, endError: `Ending failed (HTTP ${code || 'error'}).` }),
  )
}

function time(ms: number | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

function statusColor(status: string): string {
  if (status === 'ok' || status === 'approved' || status === 'live') return 'success'
  if (status === 'pending' || status === 'invited' || status === 'joined') return 'warning'
  return 'error'
}

async function startSession($: any): Promise<void> {
  const d: StartDraft = await read($, draft)
  const name = d.name.trim()
  const purpose = d.purpose.trim()
  if (!name || !purpose || d.isSent) return
  await $.store.set('lastName', name)
  await update($, draft, v => ({ ...v, isSent: true }))
  void $.prompt.submit({ text: `Start a Valet session. Name: ${JSON.stringify(name)}. Purpose: ${JSON.stringify(purpose)}.` })
}

async function copy($: any, text: string, surface: string, done: string): Promise<void> {
  const r = await $.ui.copy({ text, surface })
  $.ui.toast(r.isCopied ? done : 'Could not copy')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'valet-pane', description: 'Show the Valet session cards' })
    $.clock.every(1500, () => void ingest($))
    if ((await read($, history)).length === 0) {
      const saved = await $.store.get('history')
      if (Array.isArray(saved)) await update($, history, () => saved as PastSession[])
    }
    const lastName = await $.store.get('lastName')
    if (typeof lastName === 'string') await update($, draft, d => (d.name ? d : { ...d, name: lastName }))

    return next(e)
  })

  on('command.run', { command: 'valet-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Valet' })

    return { text: 'Valet pane opened.' }
  })

  on('tool.call', { tool: 'Skill' }, ($, e, next) => {
    if (e.skill === 'valet') void $.ui.open({ id: PANE, title: 'Valet' })

    return next(e)
  })

  on('command.run', { command: 'valet' }, ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Valet' })

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!e.command.includes('valet-session')) return next(e)
    void $.ui.open({ id: PANE, title: 'Valet' })
    const base = e.command.match(/^\s*BASE=(https?:\/\/\S+)/m)?.[1]
    const ran = await next(e)
    await ingest($)
    if (base) await update($, session, s => s && { ...s, base })
    if (/\/end"/.test(e.command) && ran.deny === undefined && !ran.isError) {
      await update($, session, s => s && { ...s, state: 'ended' })
    }

    return ran
  }).catch(($, e, next) => next(e))


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Link, Code, Button } = ui
    const Input = 'Input' in ui ? ui.Input : undefined
    const current = await read($, session)
    const past = await read($, history)
    const at = await read($, viewing)
    const d = await read($, draft)
    const isPast = at !== null && at < past.length
    const s: ValetSession | null = isPast ? past[at]! : current
    const list: ValetAction[] = isPast ? past[at]!.actions : await read($, actions)
    const total = past.length + (current ? 1 : 0)
    const position = isPast ? at + 1 : total

    const goTo = (index: number) => void update($, viewing, () => (index >= past.length ? null : index))
    const toggle = (id: string) => {
      const flip = (xs: ValetAction[]) => xs.map(x => (x.id === id ? { ...x, isExpanded: !x.isExpanded } : x))
      if (isPast) void update($, history, h => h.map((p, i) => (i === at ? { ...p, actions: flip(p.actions) } : p)))
      else void update($, actions, flip)
    }

    const nav = total > 1 && (
      <Box justifyContent="space-between" alignItems="center">
        {position > 1
          ? <Button key="nav-older" dimColor onPress={() => goTo(position - 2)}>‹ Older</Button>
          : <Text> </Text>}
        <Text dimColor>Session {position} of {total}</Text>
        {position < total
          ? <Button key="nav-newer" dimColor onPress={() => goTo(position)}>Newer ›</Button>
          : <Text> </Text>}
      </Box>
    )

    const canStart = Input && !isPast && (!current || OVER.includes(current.state))
    const startForm = canStart && (
      <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1}>
        <Text bold>Start a session</Text>
        <Input key="start-name" label="Who's asking" placeholder="Your name or company" value={d.name}
          onInput={v => void update($, draft, x => ({ ...x, name: v }))} onSubmit={() => void startSession($)} />
        <Input key="start-purpose" label="Purpose" placeholder="One sentence the person reads before deciding" value={d.purpose}
          onInput={v => void update($, draft, x => ({ ...x, purpose: v }))} onSubmit={() => void startSession($)} />
        {d.isSent
          ? <Text dimColor>Asked Claude to start it. The code shows here once it's ready.</Text>
          : (
            <Box marginTop={1}>
              <Button key="start" variant="primary" onPress={() => void startSession($)}>Start session</Button>
            </Box>
          )}
      </Box>
    )

    if (!s) return <Box flexDirection="column" gap={1}>{startForm}</Box>

    const endControls = (where: string) =>
      !isPast && s.base && !OVER.includes(s.state) && (
        <Box marginTop={2} gap={1}>
          {s.isConfirmingEnd ? [
            <Button key={`end-confirm-${where}`} variant="primary" onPress={() => void endSession($)}>End now</Button>,
            <Button key={`end-cancel-${where}`} dimColor onPress={() => void update($, session, v => v && { ...v, isConfirmingEnd: false })}>Cancel</Button>,
          ] : (
            <Button key={`end-${where}`} onPress={() => void update($, session, v => v && { ...v, isConfirmingEnd: true, endError: undefined })}><Text color="error">End session</Text></Button>
          )}
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {nav}
        {startForm}
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold>{s.name ?? 'Valet session'}</Text>
            <Text color={statusColor(s.state)}>{s.state}</Text>
          </Box>
          {s.purpose && <Text dimColor>{s.purpose}</Text>}
          {s.state === 'invited' && s.code && (
            <Text>
              Code <Text bold>{s.code}</Text>, expires {time(s.expiresAt)}
            </Text>
          )}
          {s.state === 'invited' && s.joinUrl && <Link href={s.joinUrl} label={s.joinUrl} />}
          {!isPast && s.state === 'invited' && (s.joinUrl || s.code) && (
            <Box marginTop={1} gap={1}>
              {s.joinUrl && <Button key="copy-link" dimColor onPress={press => void copy($, s.joinUrl!, press.surface, 'Link copied')}>Copy link</Button>}
              {s.code && <Button key="copy-code" dimColor onPress={press => void copy($, s.code!, press.surface, 'Code copied')}>Copy code</Button>}
            </Box>
          )}
          {s.endsAt && s.state === 'live' && <Text dimColor>Ends {time(s.endsAt)}</Text>}
          {s.grants.length > 0 && <Text dimColor>Allowed: {s.grants.join(', ')}</Text>}
          {s.endError && <Text color="error">{s.endError}</Text>}
          {endControls('top')}
        </Box>
        {list.length === 0 && <Text dimColor>No actions{isPast ? '' : ' yet'}.</Text>}
        {[...list].reverse().map(a => (
          <Box key={a.id} flexDirection="column" borderStyle="round" paddingX={1}>
            <Box justifyContent="space-between">
              <Text bold>{a.tool}</Text>
              <Text color={statusColor(a.status)}>{a.status}</Text>
            </Box>
            {a.target && <Text mono>{a.target}</Text>}
            {a.reason && <Text dimColor>{a.reason}</Text>}
            {a.error && <Text color="error">{a.error}</Text>}
            {a.output && (() => {
              const { text, hidden } = preview(a.output)
              return (
                <Box flexDirection="column">
                  <Code source={a.isExpanded ? a.output : text} />
                  {hidden > 0 && (
                    <Box marginTop={2}>
                      <Button key={`toggle-${a.id}`} dimColor onPress={() => toggle(a.id)}>
                        {a.isExpanded ? 'Show less' : `Show ${hidden} more lines`}
                      </Button>
                    </Box>
                  )}
                </Box>
              )
            })()}
          </Box>
        ))}
        {list.length > 0 && endControls('bottom')}
      </Box>
    )
  })
}
