import { getConfig } from './config'

const ns = () => getConfig().redisPrefix

export const keys = {
  code: (code: string) => `${ns()}:code:${code}`,
  session: (id: string) => `${ns()}:s:${id}`,
  seq: (id: string) => `${ns()}:s:${id}:seq`,
  events: (id: string) => `${ns()}:s:${id}:events`,
  inbox: (id: string) => `${ns()}:s:${id}:inbox`,
  actions: (id: string) => `${ns()}:s:${id}:actions`,
  grants: (id: string) => `${ns()}:s:${id}:grants`,
  log: (id: string) => `${ns()}:s:${id}:log`,
  idem: (id: string, clientId: string) => `${ns()}:s:${id}:idem:${clientId}`,
  wakeAgent: (id: string) => `${ns()}:s:${id}:wake:agent`,
  wakeClient: (id: string) => `${ns()}:s:${id}:wake:client`,
  activeSessions: () => `${ns()}:sessions:active`,
  rateLimit: (scope: string, hash: string) => `${ns()}:rl:${scope}:${hash}`,
  mcp: (hash: string) => `${ns()}:mcp:${hash}`,
  mcpClosed: (hash: string) => `${ns()}:mcp:closed:${hash}`,
  mcpCaller: (hash: string) => `${ns()}:mcp:caller:${hash}`,
  mcpHandle: (hash: string) => `${ns()}:mcp:handle:${hash}`,
} as const

export const sessionKeys = (id: string) => [
  keys.session(id),
  keys.seq(id),
  keys.events(id),
  keys.inbox(id),
  keys.actions(id),
  keys.grants(id),
  keys.log(id),
]

export const sessionKeyPattern = (id: string) => `${ns()}:s:${id}*`
