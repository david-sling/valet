const MIN = 60_000

export const LIMITS = {
  inviteMs: 10 * MIN,
  reviewMs: 10 * MIN,
  sessionMs: 60 * MIN,
  extendMs: 15 * MIN,
  maxSessionMs: 3 * 60 * MIN,
  endGraceMs: 30_000,
  keepAfterEndMs: 24 * 60 * MIN,
  clientGoneMs: 90_000,
  maxPending: 20,
  idemSeconds: 300,
  wakeTickMs: 25_000,
  pollSlots: 2,
  pollSlotStaleMs: 70_000,
  bodyBytes: 256 * 1024,
  resultBytes: 1_200_000,
  logBytes: 2 * 1024 * 1024,
} as const

export const RATES = {
  create: { limit: 20, windowS: 3600 },
  join: { limit: 10, windowS: 60 },
  joinGlobal: { limit: 300, windowS: 60 },
  action: { limit: 60, windowS: 60 },
  poll: { limit: 30, windowS: 60 },
} as const
