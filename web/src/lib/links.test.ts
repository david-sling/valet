import { describe, expect, it } from 'vitest'
import { RELEASE_DMG, RELEASE_SETUP, downloadFor } from './links'

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

describe('downloadFor', () => {
  it('gives each system its own installer', () => {
    expect(downloadFor('https://valet.example/download', WINDOWS)).toBe(RELEASE_SETUP)
    expect(downloadFor('https://valet.example/download', MAC)).toBe(RELEASE_DMG)
  })

  it('lets a link name the platform outright', () => {
    expect(downloadFor('https://valet.example/download?platform=windows', MAC)).toBe(RELEASE_SETUP)
    expect(downloadFor('https://valet.example/download?platform=mac', WINDOWS)).toBe(RELEASE_DMG)
  })

  it('falls back to the Mac app when it can’t tell', () => {
    expect(downloadFor('https://valet.example/download', null)).toBe(RELEASE_DMG)
    expect(downloadFor('https://valet.example/download?platform=linux', 'curl/8.0')).toBe(RELEASE_DMG)
  })
})
