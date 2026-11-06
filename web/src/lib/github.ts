import { createServerFn } from '@tanstack/react-start'

export const REPO_URL = 'https://github.com/david-sling/valet'

const API = 'https://api.github.com/repos/david-sling/valet'
const KEEP_MS = 60 * 60_000
const TIMEOUT_MS = 2500

let cached: { stars: number | null; at: number } | null = null

// The count is a marketing number: any failure renders the chip without it rather than slowing or breaking the page.
export const getStars = createServerFn({ method: 'GET' }).handler(async () => {
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.stars
  let stars: number | null = null
  try {
    const res = await fetch(API, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const count = res.ok ? ((await res.json()) as { stargazers_count?: unknown }).stargazers_count : undefined
    if (typeof count === 'number' && Number.isFinite(count)) stars = Math.max(0, Math.floor(count))
  } catch {
    stars = null
  }
  cached = { stars, at: Date.now() }
  return stars
})

export function formatStars(count: number) {
  if (count < 1000) return String(count)
  const tenths = Math.round(count / 100) / 10
  return `${tenths < 10 ? tenths : Math.round(tenths)}k`
}
