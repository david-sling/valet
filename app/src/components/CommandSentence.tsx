import { explain, listOf, type Explanation, type Part } from 'cmd-facts'

// Arguments come from the agent, so they are set as code rather than joined into the prose a person is about to trust.
function chain(e: Explanation): Part[] {
  const parts = [...e.parts]
  for (let r = e.runs; r; r = r.runs) parts.push({ kind: 'text', text: ' ' }, ...r.parts)
  return parts
}

export function CommandSentence({ command }: { command: string }) {
  let e: Explanation
  try {
    e = explain(command)
  } catch {
    return null
  }
  return (
    <p className="command-sentence" data-confidence={e.facts.confidence}>
      {chain(e).map((p, i) =>
        p.kind === 'text' ? (
          p.text
        ) : (
          <code key={i} title={(p.written ?? p.values).join(' ')}>
            {listOf(p.values)}
          </code>
        ),
      )}
    </p>
  )
}
