import { createFileRoute } from '@tanstack/react-router'
import { CODE_CHARS, normaliseCode } from '@valet/protocol'

export const Route = createFileRoute('/j/$code')({
  head: () => ({ meta: [{ title: 'Valet · Join a session' }, { name: 'robots', content: 'noindex' }] }),
  component: JoinLink,
})

const VALID = new RegExp(`^[${CODE_CHARS}]{6}$`)

function JoinLink() {
  const raw = normaliseCode(Route.useParams().code)
  const code = VALID.test(raw) ? `${raw.slice(0, 3)}-${raw.slice(3)}` : null

  return (
    <main className="join-link">
      <a className="brand" href="/">
        <img src="/brand/valet-mark.svg" alt="" width="26" height="26" />
        Valet
      </a>
      {code ? (
        <>
          <h1 className="h2">Someone sent you a Valet code.</h1>
          <p className="lead">Open the Valet app and enter this code to see who is asking and what they want to do. Nothing happens on your computer until you agree.</p>
          <p className="join-code">{code}</p>
          <div className="actions">
            <a className="btn btn-ink" href={`valet://join/${raw}`}>
              Open in Valet
            </a>
          </div>
          <p className="join-note">
            The code works once and expires 10 minutes after it was made. If you didn't ask anyone for help, ignore it.
          </p>
        </>
      ) : (
        <>
          <h1 className="h2">That isn't a Valet code.</h1>
          <p className="lead">Check the link with whoever sent it. A code is six letters and numbers, like ACD-347.</p>
        </>
      )}
    </main>
  )
}
