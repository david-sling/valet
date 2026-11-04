import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { CODE_CHARS, normaliseCode } from '@valet/protocol/codes'

export const Route = createFileRoute('/j/$code')({
  head: () => ({ meta: [{ title: 'Valet · Join a session' }, { name: 'robots', content: 'noindex' }] }),
  component: JoinLink,
})

const VALID = new RegExp(`^[${CODE_CHARS}]{6}$`)

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

  return (
    <main className="join-link">
      <div className="jt">
        <div className="jt-body">
          <a className="jt-brand" href="/">
            <span className="jt-mark" aria-hidden="true" />
            Valet
          </a>
        </div>
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
              <a className="btn btn-ink jt-open" href={`valet://join/${raw}`} onClick={(e) => e.stopPropagation()}>
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
            Open the Valet app and enter this code to see who is asking and what they want to do. Nothing happens on your
            computer until you agree.
          </p>
          <p className="join-note">
            The code works once and expires 10 minutes after it was made. If you didn't ask anyone for help, ignore it.
          </p>
        </div>
      )}
    </main>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
    </svg>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}
