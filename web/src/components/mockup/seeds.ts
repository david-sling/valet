import type { FeedItem, PastSession } from './ClientScreens'

// Example past sessions for the sidebar, placed relative to now so their dates read naturally.
// The vendors are made up; like the rest of the mockup, none of this is real.
export function seedPast(now: number): PastSession[] {
  let id = 0
  const ev = (at: number, text: string): FeedItem => ({ id: --id, at, type: 'event', text })
  const act = (at: number, tool: string, literal: string, outcome: Extract<FeedItem, { type: 'action' }>['outcome'], output?: string, method?: string): FeedItem => ({
    id: --id, at, type: 'action', tool, literal, outcome, output, method,
  })
  const m = 60_000
  // a set time of day on an earlier date: "Yesterday, 14:20", "2 Nov, 10:05"
  const at = (daysAgo: number, h: number, min: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - daysAgo)
    d.setHours(h, min, 0, 0)
    return d.getTime()
  }
  const a = at(1, 14, 20)
  const b = at(3, 10, 5)
  const c = at(8, 16, 40)
  return [
    {
      id: 'seed-acme',
      vendor: 'Acme Inc.',
      startedAt: a,
      endedAt: a + 18 * m,
      endedBy: 'you',
      feed: [
        ev(a, 'Session started with 4 permissions'),
        act(a + 1 * m, 'read_file', '~/Library/Application Support/AcmeApp/config.json', 'Allowed', '{ "renderer": "opengl" }'),
        act(a + 3 * m, 'run_command', 'log show --predicate \'process == "AcmeApp"\' --last 1h', 'Allowed', 'GLD: context reset by driver'),
        act(a + 9 * m, 'run_command', 'system_profiler SPDisplaysDataType', 'Approved', 'Chipset Model: AMD Radeon Pro 5500M', 'Click'),
        {
          ...act(a + 14 * m, 'write_file', '~/Library/Application Support/AcmeApp/config.json', 'Approved', 'wrote 61 bytes', 'Click'),
          diff: [' {', '-  "renderer": "opengl",', '+  "renderer": "metal",', '   "gpu.vsync": true,', '   "telemetry": false', ' }'],
        } as FeedItem,
        ev(a + 18 * m, 'You ended the session'),
      ],
    },
    {
      id: 'seed-northwind',
      vendor: 'Northwind Tools',
      startedAt: b,
      endedAt: b + 7 * m,
      endedBy: 'vendor',
      feed: [
        ev(b, 'Session started with 2 permissions'),
        act(b + 1 * m, 'list_processes', 'list_processes', 'Allowed', 'Northwind (812) · 190 more'),
        act(b + 4 * m, 'read_file', '~/.ssh/id_rsa', 'Denied'),
        ev(b + 7 * m, 'Northwind Tools ended the session'),
      ],
    },
    {
      id: 'seed-contoso',
      vendor: 'Contoso CAD',
      startedAt: c,
      endedAt: c + 60 * m,
      endedBy: 'time',
      feed: [
        ev(c, 'Session started with 3 permissions'),
        act(c + 2 * m, 'tail_log', '~/Library/Logs/ContosoCAD/render.log', 'Allowed', 'render: out of memory (VRAM)'),
        act(c + 20 * m, 'run_command', 'curl -s https://updates.contoso.com/cad/latest', 'Timed out'),
        ev(c + 60 * m, 'The session reached its 60-minute limit'),
      ],
    },
  ]
}
