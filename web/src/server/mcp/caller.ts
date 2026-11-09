// The one place that knows a particular client's own way of naming itself.
//
// ChatGPT mints a fresh Mcp-Session-Id every turn, so the transport cannot hold a session across a conversation. It
// does send openai/subject and openai/session on every tool call, and those hold steady for the whole conversation.
// They arrive whether or not the model thinks about them, which is why they can carry a session where a value the
// model has to remember cannot.
//
// They are the client's own word for who is calling, not anything this relay can verify, so treat a pair as a secret
// that happens to be stable rather than as proof of identity: both halves are required, and the slot they open is
// one Valet session, nothing wider.
export type Caller = { subject: string; session: string }

const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)

export function callerOf(body: unknown): Caller | undefined {
  for (const message of [body].flat()) {
    const meta = (message as { params?: { _meta?: Record<string, unknown> } } | null)?.params?._meta
    const subject = text(meta?.['openai/subject'])
    const session = text(meta?.['openai/session'])
    if (subject && session) return { subject, session }
  }
  return undefined
}
