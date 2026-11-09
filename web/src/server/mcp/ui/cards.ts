import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server'
import { SKILL_VERSION } from '#/agent/version'
import { publicOrigin } from '../../config'
import card from './card.html?raw'
import type { McpUiResourceMeta, McpUiToolVisibility } from '@modelcontextprotocol/ext-apps'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// A host that renders MCP Apps draws these instead of the tool's JSON; every other client reads the same text result
// and never asks for the resource, so nothing below changes what an agent is told
export const CARD = {
  session: 'ui://valet/session',
  action: 'ui://valet/action',
} as const
export type Card = keyof typeof CARD

const ABOUT: Record<Card, string> = {
  session: 'The join link and code while a session is being handed over, then its live state and permissions',
  action: 'What a single action asked for and what came back from the Mac',
}

// What the frame may call back. The waiting tools and end_session are the person's own business and touch nothing on
// the Mac; everything that acts there stays with the agent, where the reason it gives is part of the record
export const ASKS: McpUiToolVisibility[] = ['model']
export const ANSWERS: McpUiToolVisibility[] = ['model', 'app']

// the card imports the MCP Apps client from Valet's own origin, so the sandbox has to be told to allow it
const meta = (kind: Card): McpUiResourceMeta => ({
  csp: { resourceDomains: [publicOrigin()] },
  prefersBorder: true,
  ...(kind === 'session' ? { permissions: { clipboardWrite: {} } } : {}),
})

const html = (kind: Card) =>
  card
    .replaceAll('{{CLIENT}}', `${publicOrigin()}/mcp-app.js`)
    .replaceAll('{{KIND}}', kind)
    .replaceAll('{{VERSION}}', String(SKILL_VERSION))

export function registerCards(server: McpServer) {
  for (const kind of Object.keys(CARD) as Card[]) {
    const uri = CARD[kind]
    registerAppResource(server, `Valet ${kind}`, uri, { description: ABOUT[kind], _meta: { ui: meta(kind) } }, () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html(kind), _meta: { ui: meta(kind) } }],
    }))
  }
}
