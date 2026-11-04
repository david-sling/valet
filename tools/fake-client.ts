// A stand-in for the client app: joins a session and answers every action with made-up output. It never runs
// anything on this machine.
//
//   node tools/fake-client.ts <base url> <code> [--deny tool,tool] [--slow seconds]

import { createHash, randomBytes } from 'node:crypto'

const [base, code, ...rest] = process.argv.slice(2)
if (!base || !code) {
  console.error('usage: node tools/fake-client.ts <base url> <code> [--deny tool,tool] [--slow seconds]')
  process.exit(2)
}
const flag = (name: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}
const deny = new Set((flag('--deny') ?? '').split(',').filter(Boolean))
const slowMs = Number(flag('--slow') ?? 0) * 1000
const api = `${base.replace(/\/$/, '')}/api/v1`

type Action = { action_id: string; seq: number; tool: string; args: Record<string, unknown>; reason: string }

let token = ''
let id = ''
const files = new Map<string, string>()

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`)
  return json
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function fileContent(path: string) {
  if (!files.has(path)) files.set(path, `example contents of ${path}\nwritten by the fake client, ${randomBytes(4).toString('hex')}\n`)
  return files.get(path)!
}

function answer(a: Action): Record<string, unknown> {
  if (deny.has(a.tool)) return { status: 'denied', method: 'click' }
  const path = String(a.args.path ?? '')
  switch (a.tool) {
    case 'list_processes':
      return { status: 'ok', output: { processes: [{ pid: 4121, name: 'AcmeApp' }, { pid: 312, name: 'WindowServer' }] } }
    case 'read_file':
    case 'tail_log': {
      const content = fileContent(path)
      return { status: 'ok', output: { content, hash: sha(content), truncated: false }, hash: sha(content) }
    }
    case 'list_dir':
      return { status: 'ok', output: { entries: [{ name: 'main.log', type: 'file', size: 2048 }, { name: 'old', type: 'dir', size: 0 }] } }
    case 'write_file': {
      if (a.args.base_hash !== sha(fileContent(path))) return { status: 'rejected', error: 'The file changed after it was last read.' }
      const content = String(a.args.content)
      files.set(path, content)
      return { status: 'approved', method: 'click', output: { hash: sha(content), bytes: Buffer.byteLength(content) }, hash: sha(content) }
    }
    case 'run_command': {
      const argv = a.args.command as string[]
      return {
        status: 'approved',
        method: 'touch_id',
        output: { exit_code: 0, stdout: `(fake client, not run) ${argv.join(' ')}\n`, stderr: '', truncated: false },
      }
    }
    default:
      return { status: 'failed', error: `The fake client doesn't know ${a.tool}.` }
  }
}

async function main() {
  const joined = await call('POST', '/join', { code })
  token = String(joined.client_token)
  id = String(joined.session_id)
  console.log(`joined: ${joined.sender_name} (${joined.agent_name}): ${joined.purpose}`)
  const template = (joined.template as Record<string, unknown>[]).map((n, i) => ({ ...n, id: `t${i}`, on: true, source: 'proposed' }))
  await call('POST', `/sessions/${id}/start`, { grants: template })
  console.log(`started with ${template.length} permissions`)

  const stop = async () => {
    await call('POST', `/sessions/${id}/end`).catch(() => undefined)
    console.log('ended by the fake client')
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  let after = 0
  for (;;) {
    const inbox = await call('GET', `/sessions/${id}/inbox?wait=50&after=${after}`)
    if (inbox.state !== 'live') {
      console.log(`session ${inbox.state}`)
      return
    }
    for (const a of inbox.actions as Action[]) {
      after = Math.max(after, a.seq)
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs))
      const result = answer(a)
      console.log(`${a.tool} ${JSON.stringify(a.args).slice(0, 120)} → ${result.status} · reason: ${a.reason}`)
      await call('POST', `/sessions/${id}/actions/${a.action_id}/result`, result)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
