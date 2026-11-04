import { useState } from 'react'
import { normaliseCode } from '@valet/protocol'

export function App() {
  const [code, setCode] = useState('')
  const ready = normaliseCode(code).length === 6

  return (
    <main className="home">
      <img src="/valet-mark.svg" alt="" width={40} height={40} />
      <h1>Join a session</h1>
      <p>Enter the code from whoever asked to help you.</p>
      <form onSubmit={(e) => e.preventDefault()}>
        <input
          aria-label="Join code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXX-XXX"
          autoComplete="off"
          spellCheck={false}
        />
        <button disabled={!ready}>Continue</button>
      </form>
    </main>
  )
}
