import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto'
import { CODE_CHARS } from '@valet/protocol'

const SESSION_ID_BYTES = 16
const TOKEN_BYTES = 32
const ACTION_ID_BYTES = 9
const CODE_LENGTH = 6

const encodedLength = (bytes: number) => Math.ceil((bytes * 8) / 6)
const SESSION_ID = new RegExp(`^[A-Za-z0-9_-]{${encodedLength(SESSION_ID_BYTES)}}$`)
const ACTION_ID = new RegExp(`^a_[A-Za-z0-9_-]{${encodedLength(ACTION_ID_BYTES)}}$`)

export const newSessionId = () => randomBytes(SESSION_ID_BYTES).toString('base64url')
export const newActionId = () => `a_${randomBytes(ACTION_ID_BYTES).toString('base64url')}`
export const newToken = () => randomBytes(TOKEN_BYTES).toString('base64url')
export const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
export const formatCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex')

export function tokenMatches(presented: string | undefined, expectedHash: string | undefined) {
  if (!presented || !expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash)) return false
  const actual = createHash('sha256').update(presented, 'utf8').digest()
  return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'))
}

export const isSessionId = (value: string) => SESSION_ID.test(value)
export const isActionId = (value: string) => ACTION_ID.test(value)
