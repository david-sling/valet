import { z } from 'zod'

export function hasControlCharacter(text: string) {
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
    if (code >= 0x7f && code <= 0x9f) return true
  }
  return false
}
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !hasControlCharacter(s), 'contains a control character; only tab, newline and carriage return are allowed')

export const LIMITS = {
  name: 60,
  purpose: 500,
  reason: 500,
  path: 1024,
  argv: 64,
  arg: 4096,
  writeBytes: 200_000,
  waitSeconds: 50,
} as const

export const Risk = z.enum(['low', 'medium', 'high', 'critical'])
export const Kind = z.enum(['Files', 'Programs', 'Network', 'Environment', 'Processes', 'Admin rights'])
export const Need = z.object({
  kind: Kind,
  access: z.string().min(1).max(20),
  scope: z.string().min(1).max(LIMITS.path),
  risk: Risk,
  protectedLabel: z.string().max(60).optional(),
})
export const Grant = Need.extend({
  id: z.string().min(1).max(64),
  on: z.boolean(),
  source: z.enum(['proposed', 'approved']),
  expiresAt: z.number().int().optional(),
})
export type Risk = z.infer<typeof Risk>
export type Kind = z.infer<typeof Kind>
export type Need = z.infer<typeof Need>
export type Grant = z.infer<typeof Grant>

const path = z.string().min(1).max(LIMITS.path)
export const ActionRequest = z.discriminatedUnion('tool', [
  z.object({
    tool: z.literal('run_command'),
    args: z.object({
      command: z.array(z.string().max(LIMITS.arg)).min(1).max(LIMITS.argv),
      cwd: path.optional(),
      network: z.boolean().optional(),
    }),
  }),
  z.object({ tool: z.literal('read_file'), args: z.object({ path, max_bytes: z.number().int().positive().optional() }) }),
  z.object({
    tool: z.literal('write_file'),
    args: z.object({ path, content: z.string().max(LIMITS.writeBytes), base_hash: z.string().regex(/^[0-9a-f]{64}$/) }),
  }),
  z.object({ tool: z.literal('list_dir'), args: z.object({ path }) }),
  z.object({ tool: z.literal('tail_log'), args: z.object({ path, lines: z.number().int().min(1).max(5000).optional() }) }),
  z.object({ tool: z.literal('list_processes'), args: z.object({}).optional() }),
])
export const ActionBody = z.intersection(
  ActionRequest,
  z.object({ reason: plain(LIMITS.reason), client_id: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) }),
)
export type ActionRequest = z.infer<typeof ActionRequest>
export type ActionBody = z.infer<typeof ActionBody>
export type Tool = ActionRequest['tool']

export const ActionStatus = z.enum(['pending', 'ok', 'approved', 'denied', 'rejected', 'failed', 'ended'])
export type ActionStatus = z.infer<typeof ActionStatus>

export const SessionState = z.enum(['invited', 'joined', 'live', 'declined', 'expired', 'ended'])
export type SessionState = z.infer<typeof SessionState>

export const CreateSessionBody = z.object({
  name: plain(LIMITS.name),
  purpose: plain(LIMITS.purpose),
  template: z.array(Need).max(50).optional(),
  skill_version: z.union([z.number(), z.string().max(20)]).optional(),
})
export type CreateSessionBody = z.infer<typeof CreateSessionBody>

export const JoinBody = z.object({ code: z.string().min(6).max(12) })
export const StartBody = z.object({ grants: z.array(Grant).max(200) })
export const ResultBody = z.object({
  status: ActionStatus.exclude(['pending']),
  output: z.unknown().optional(),
  hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  error: z.string().max(2000).optional(),
  method: z.enum(['click', 'touch_id']).optional(),
})

export const WaitQuery = z.object({
  wait: z.coerce.number().int().min(0).max(LIMITS.waitSeconds).default(0),
  after: z.coerce.number().int().min(0).optional(),
})

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'gone'
  | 'method_not_allowed'
  | 'invalid_request'
  | 'conflict'
  | 'too_large'
  | 'rate_limited'
  | 'server_error'
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; hint?: string } }
