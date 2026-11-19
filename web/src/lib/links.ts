export const DOWNLOAD = '/download'
export const DOWNLOAD_MAC = '/download?platform=mac'
export const DOWNLOAD_WINDOWS = '/download?platform=windows'
export const RELEASE_DMG = 'https://github.com/david-sling/valet/releases/latest/download/Valet.dmg'
export const RELEASE_SETUP = 'https://github.com/david-sling/valet/releases/latest/download/Valet-setup.exe'
// what the app runs on, said the same way everywhere
export const REQUIREMENTS = 'macOS 13 or later, or 64-bit Windows 10 (version 1809) or later'

// ?platform= names the download outright; without it the browser's own system decides, and anything that isn't
// Windows gets the Mac app, as before
export function downloadFor(url: string, userAgent: string | null) {
  const platform = new URL(url).searchParams.get('platform')
  if (platform === 'windows') return RELEASE_SETUP
  if (platform === 'mac') return RELEASE_DMG
  return /Windows/i.test(userAgent ?? '') ? RELEASE_SETUP : RELEASE_DMG
}
