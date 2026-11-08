import type { Grant, Need, Risk } from './api'

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 }
export const maxRisk = (rs: Risk[]) => rs.reduce<Risk>((a, r) => (RANK[r] > RANK[a] ? r : a), 'low')

export function covers(g: Grant, n: Need, now: number) {
  if (!g.on || g.kind !== n.kind || g.access !== n.access) return false
  if (g.expiresAt && g.expiresAt < now) return false
  if (n.protectedLabel && g.source !== 'approved') return false
  if (g.scope === n.scope || g.scope === '*') return true
  if (!g.scope.endsWith('/**')) return false
  return n.scope === g.scope.slice(0, -3) || n.scope.startsWith(g.scope.slice(0, -2))
}

export type Decision = { ask: false } | { ask: true; needs: Need[] }

export function decide(a: { risk: Risk; needs: Need[] }, grants: Grant[], now: number): Decision {
  if (a.risk === 'critical') return { ask: true, needs: a.needs }
  const ok = (n: Need) => grants.some((g) => covers(g, n, now) && (a.risk !== 'high' || g.source === 'approved'))
  const needs = a.needs.filter((n) => !ok(n))
  return needs.length ? { ask: true, needs } : { ask: false }
}

export type Scope = 'once' | 'check' | 'session' | '15m' | 'folder'
export const SCOPE_LABEL: Record<Scope, string> = {
  once: 'Once',
  check: 'Once, check output',
  session: 'This session',
  '15m': '15 minutes',
  folder: 'This folder',
}

export function scopesFor(a: { risk: Risk; needs: Need[] }): Scope[] {
  if (a.risk === 'critical') return ['once', 'check']
  return a.needs.some((n) => n.kind === 'Files') ? ['once', 'check', 'session', '15m', 'folder'] : ['once', 'check', 'session', '15m']
}

export function grantsFrom(needs: Need[], scope: Scope, now: number): Array<Need & { expiresAt?: number }> {
  if (scope === 'once' || scope === 'check') return []
  return needs.map((n) => ({
    ...n,
    scope: scope === 'folder' && n.kind === 'Files' ? n.scope.replace(/\/[^/]*$/, '/**') : n.scope,
    expiresAt: scope === '15m' ? now + 15 * 60_000 : undefined,
  }))
}
