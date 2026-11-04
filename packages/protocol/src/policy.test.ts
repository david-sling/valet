import { describe, expect, it } from 'vitest'
import vectors from '../vectors/policy.json'
import { decide, grantsFrom, scopesFor } from './policy'
import type { Scope } from './policy'
import type { Grant, Need, Risk } from './api'

type Action = { risk: Risk; needs: Need[] }
const { now } = vectors

describe('decide', () => {
  it.each(vectors.decide)('$name', ({ action, grants, expect: want }) => {
    expect(decide(action as Action, grants as Grant[], now)).toEqual(want)
  })
})

describe('scopesFor', () => {
  it.each(vectors.scopesFor)('$name', ({ action, expect: want }) => {
    expect(scopesFor(action as Action)).toEqual(want)
  })
})

describe('grantsFrom', () => {
  it.each(vectors.grantsFrom)('$name', ({ needs, scope, expect: want }) => {
    const got = grantsFrom(needs as Need[], scope as Scope, now).map((g) => JSON.parse(JSON.stringify(g)))
    expect(got).toEqual(want)
  })
})
