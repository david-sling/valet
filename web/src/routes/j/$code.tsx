import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { CODE_CHARS, normaliseCode } from '@valet/protocol/codes'
import { DOWNLOAD } from '#/lib/links'
import { Check, CopyIcon } from '#/components/Links'

export const Route = createFileRoute('/j/$code')({
  head: () => ({ meta: [{ title: 'Valet · Join a session' }, { name: 'robots', content: 'noindex' }] }),
  component: JoinLink,
})

const VALID = new RegExp(`^[${CODE_CHARS}]{6}$`)
const WAIT_MS = 2000

function JoinLink() {
  const raw = normaliseCode(Route.useParams().code)
  const code = VALID.test(raw) ? `${raw.slice(0, 3)}-${raw.slice(3)}` : null
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const copy = () => {
    if (!code) return
    navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)
  }

  // A browser can't ask whether an app is installed. If Valet opens, the page loses focus to it or to the browser's
  // "open Valet?" prompt; if nothing has taken focus after a moment, it isn't there, so download it instead.
  const openApp = () => {
    let left = false
    const away = () => {
      left = true
    }
    window.addEventListener('blur', away)
    document.addEventListener('visibilitychange', away)
    setTimeout(() => {
      window.removeEventListener('blur', away)
      document.removeEventListener('visibilitychange', away)
      if (!left) window.location.href = DOWNLOAD
    }, WAIT_MS)
  }

  return (
    <>
      <nav className="nav" aria-label="Main">
        <a className="brand" href="/">
          <img src="/brand/valet-mark.svg" alt="" width="26" height="26" />
          Valet
        </a>
      </nav>
      <main className="join-link">
        <div className="jt">
          <div className="jt-body" aria-hidden="true" />
          <div className={`jt-stub${code ? ' is-copyable' : ''}`} onClick={copy}>
            {code ? (
              <>
                <h1 className="jt-label">Someone sent you a Valet code</h1>
                <div className="jt-code">
                  <span>{code}</span>
                  <button
                    type="button"
                    className="jt-copy"
                    aria-label={copied ? 'Copied' : 'Copy code'}
                    onClick={(e) => {
                      e.stopPropagation()
                      copy()
                    }}
                  >
                    {copied ? <Check /> : <CopyIcon />}
                  </button>
                </div>
                <p className="jt-status" role="status">
                  {copied ? (
                    'Copied'
                  ) : (
                    <>
                      <span className="on-pointer">Click to copy</span>
                      <span className="on-touch">Tap to copy</span>
                    </>
                  )}
                </p>
                <a
                  className="btn btn-ink jt-open"
                  href={`valet://join/${raw}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    openApp()
                  }}
                >
                  Open in Valet
                </a>
              </>
            ) : (
              <>
                <h1 className="jt-label">That isn't a Valet code</h1>
                <p className="jt-bad">A code is six letters and numbers, like ACD-347. Check the link with whoever sent it.</p>
              </>
            )}
          </div>
        </div>
        {code && (
          <div className="join-copy">
            <p className="lead">
              Install Valet, open it and enter this code to see who is asking and what they want to do. Nothing happens on
              your computer until you agree.
            </p>
            <p className="join-note">
              The code works once and expires 10 minutes after it was made. If you didn't ask anyone for help, ignore it.
            </p>
            <p className="join-note">
              Valet runs on macOS 13 or later. If the button doesn't open it, <a href={DOWNLOAD}>download Valet for Mac</a>.
            </p>
          </div>
        )}
      </main>
    </>
  )
}
