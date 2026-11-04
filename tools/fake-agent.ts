// A stand-in for the agent: opens a session, prints the code to type into the client app, then sends a fixed set
// of actions that covers allowed, asked, Touch ID and protected cases, and ends the session.
//
//   node tools/fake-agent.ts <base url>

import { randomBytes } from 'node:crypto'

const [base] = process.argv.slice(2)
if (!base) {
  console.error('usage: node tools/fake-agent.ts <base url>')
  process.exit(2)
}
const api = `${base.replace(/\/$/, '')}/api/v1`
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

let token = ''
let id = ''

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

const STEPS: [string, Record<string, unknown>, string][] = [
  ['list_processes', {}, 'Allowed by the template'],
  ['read_file', { path: '/etc/hosts' }, 'Allowed by the template'],
  ['run_command', { command: ['/usr/bin/sw_vers'] }, 'Allowed by the template'],
  ['list_dir', { path: '~/Library/Logs' }, 'Asks: low risk, one click'],
  ['write_file', { path: '/tmp/valet-demo.txt', content: 'written by the fake agent\n', base_hash: EMPTY }, 'Asks: medium risk, with a diff'],
  ['run_command', { command: ['/usr/bin/curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://example.com'] }, 'Asks: network, Touch ID'],
  ['list_dir', { path: '~/.ssh' }, 'Asks: protected place, Touch ID'],
]

async function settle(aid: string) {
  for (;;) {
    const a = await call('GET', `/sessions/${id}/actions/${aid}?wait=50`)
    if (a.status !== 'pending') return a
  }
}

async function main() {
  const created = await call('POST', '/sessions', {
    name: 'Fake agent',
    purpose: 'Check that the client app allows, asks and refuses as it should.',
    template: [
      { kind: 'Files', access: 'read', scope: '/etc/**', risk: 'low' },
      { kind: 'Programs', access: 'run', scope: '/usr/bin/sw_vers', risk: 'medium' },
      { kind: 'Processes', access: 'list', scope: 'all', risk: 'low' },
    ],
  })
  token = String(created.agent_token)
  id = String(created.session_id)
  console.log(`\n  Type this code into Valet: ${created.code}\n`)

  for (;;) {
    const s = await call('GET', `/sessions/${id}?wait=50`)
    if (s.state === 'live') break
    if (s.state !== 'invited' && s.state !== 'joined') return console.log(`session ${s.state}`)
  }
  console.log('live')

  for (const [tool, args, expect] of STEPS) {
    console.log(`→ ${tool} ${JSON.stringify(args)}  (${expect})`)
    const sent = await call('POST', `/sessions/${id}/actions`, {
      tool,
      args,
      reason: `Testing the client: ${expect.toLowerCase()}.`,
      client_id: randomBytes(9).toString('base64url'),
    })
    const r = sent.status === 'pending' ? await settle(String(sent.action_id)) : sent
    const detail = r.error ?? JSON.stringify(r.output ?? null).slice(0, 100)
    console.log(`  ${r.status}${r.method ? ` (${r.method})` : ''}: ${detail}`)
    if (r.status === 'ended' || r.session_state === 'ended') return console.log('session ended')
  }

  await call('POST', `/sessions/${id}/end`)
  console.log('ended by the fake agent')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
