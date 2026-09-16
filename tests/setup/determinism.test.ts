import { describe, expect, it } from 'vitest'
import {
  FIXED_NOW,
  FIXED_NOW_MS,
  stableStringify,
  withFixedClock,
  withFixedClockAsync,
} from './determinism'

describe('withFixedClock', () => {
  it('pins Date.now inside the callback', () => {
    expect(Date.now()).not.toBe(FIXED_NOW_MS)

    const observed = withFixedClock(() => Date.now())

    expect(observed).toBe(FIXED_NOW_MS)
  })

  it('restores the real clock afterwards, and on throw', () => {
    const before = Date.now

    expect(() =>
      withFixedClock(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(Date.now).toBe(before)
    expect(Date.now()).not.toBe(FIXED_NOW_MS)
  })

  it('accepts an explicit millisecond timestamp', () => {
    expect(withFixedClock(() => Date.now(), 1234)).toBe(1234)
  })

  it('uses the documented default timestamp', () => {
    expect(FIXED_NOW).toBe('2024-01-01T00:00:00.000Z')
    expect(FIXED_NOW_MS).toBe(1704067200000)
  })
})

describe('withFixedClockAsync', () => {
  it('pins the clock across awaits and restores it', async () => {
    const before = Date.now

    const observed = await withFixedClockAsync(async () => {
      await Promise.resolve()
      return Date.now()
    })

    expect(observed).toBe(FIXED_NOW_MS)
    expect(Date.now).toBe(before)
  })

  it('restores the clock when the callback rejects', async () => {
    const before = Date.now

    await expect(
      withFixedClockAsync(async () => {
        throw new Error('async boom')
      }),
    ).rejects.toThrow('async boom')

    expect(Date.now).toBe(before)
  })
})

describe('stableStringify', () => {
  it('produces the same string regardless of key insertion order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('sorts nested objects but preserves array order', () => {
    expect(stableStringify({ outer: { z: [3, 1], a: 1 } })).toBe('{"outer":{"a":1,"z":[3,1]}}')
  })

  it('sorts objects inside arrays', () => {
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]')
  })

  it('passes primitives and null through', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('text')).toBe('"text"')
    expect(stableStringify(7)).toBe('7')
  })
})
