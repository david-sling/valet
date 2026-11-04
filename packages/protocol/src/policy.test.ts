import { describe, expect, it } from 'vitest'
import { decide, grantsFrom, scopesFor } from './policy'
import type { Grant, Need } from './api'

const LOGS: Need = { kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/main.log', risk: 'low' }
const SSH: Need = { kind: 'Files', access: 'read', scope: '~/.ssh/id_rsa', risk: 'high', protectedLabel: 'SSH private key' }
const NET: Need = { kind: 'Network', access: 'connect', scope: 'api.acme.com:443', risk: 'high' }
const grant = (g: Partial<Grant> & Pick<Grant, 'kind' | 'access' | 'scope'>): Grant => ({
  id: 'g',
  on: true,
  source: 'proposed',
  risk: 'low',
  ...g,
})
const NOW = 1_800_000_000_000

describe('decide', () => {
  it('runs an action a starting grant covers', () => {
    const grants = [grant({ kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/**' })]
    expect(decide({ risk: 'low', needs: [LOGS] }, grants, NOW)).toEqual({ ask: false })
  })

  it('asks when the grant is switched off or has run out', () => {
    const off = grant({ kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/**', on: false })
    const old = grant({ kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/**', expiresAt: NOW - 1 })
    expect(decide({ risk: 'low', needs: [LOGS] }, [off], NOW).ask).toBe(true)
    expect(decide({ risk: 'low', needs: [LOGS] }, [old], NOW).ask).toBe(true)
  })

  it('never lets a folder grant reach its parent', () => {
    const grants = [grant({ kind: 'Files', access: 'read', scope: '~/Projects/acme/**' })]
    const parent: Need = { kind: 'Files', access: 'read', scope: '~/Projects/notes.md', risk: 'low' }
    expect(decide({ risk: 'low', needs: [parent] }, grants, NOW).ask).toBe(true)
  })

  it('asks for a protected location even under a starting grant for everything', () => {
    const all = [grant({ kind: 'Files', access: 'read', scope: '*' })]
    expect(decide({ risk: 'high', needs: [SSH] }, all, NOW)).toEqual({ ask: true, needs: [SSH] })
  })

  it('asks for high risk until the client has allowed it from a prompt', () => {
    const proposed = [grant({ kind: 'Network', access: 'connect', scope: '*' })]
    const approved = [grant({ kind: 'Network', access: 'connect', scope: '*', source: 'approved' })]
    expect(decide({ risk: 'high', needs: [NET] }, proposed, NOW).ask).toBe(true)
    expect(decide({ risk: 'high', needs: [NET] }, approved, NOW)).toEqual({ ask: false })
  })

  it('always asks for critical risk', () => {
    const sudo: Need = { kind: 'Admin rights', access: 'elevate', scope: '/usr/sbin/softwareupdate', risk: 'critical' }
    const approved = [grant({ ...sudo, source: 'approved' })]
    expect(decide({ risk: 'critical', needs: [sudo] }, approved, NOW).ask).toBe(true)
    expect(scopesFor({ risk: 'critical', needs: [sudo] })).toEqual(['once'])
  })
})

describe('grantsFrom', () => {
  it('leaves nothing behind for a one-off approval', () => {
    expect(grantsFrom([LOGS], 'once', NOW)).toEqual([])
  })

  it('widens a file to its folder, and only a file', () => {
    expect(grantsFrom([LOGS, NET], 'folder', NOW).map((g) => g.scope)).toEqual(['~/Library/Logs/AcmeApp/**', 'api.acme.com:443'])
  })

  it('gives a 15-minute approval its end time', () => {
    expect(grantsFrom([LOGS], '15m', NOW)[0].expiresAt).toBe(NOW + 15 * 60_000)
  })
})
