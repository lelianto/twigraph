/**
 * Determinism helpers.
 *
 * mulat artifacts (manifests, chunk records, answers) must be byte-identical for
 * identical inputs, otherwise the index churns and snapshots become worthless.
 * Production code therefore never reads ambient state — it receives what it needs.
 * These helpers exist for the tests that would otherwise have to fake the clock.
 */

export const FIXED_NOW = '2024-01-01T00:00:00.000Z'
export const FIXED_NOW_MS = Date.parse(FIXED_NOW)

const toMillis = (now: string | number): number => (typeof now === 'number' ? now : Date.parse(now))

/** Runs `fn` with `Date.now()` pinned. Restores the real clock even if `fn` throws. */
export function withFixedClock<T>(fn: () => T, now: string | number = FIXED_NOW): T {
  const original = Date.now
  const fixed = toMillis(now)
  Date.now = () => fixed
  try {
    return fn()
  } finally {
    Date.now = original
  }
}

/** Async variant of {@link withFixedClock}. */
export async function withFixedClockAsync<T>(
  fn: () => Promise<T>,
  now: string | number = FIXED_NOW,
): Promise<T> {
  const original = Date.now
  const fixed = toMillis(now)
  Date.now = () => fixed
  try {
    return await fn()
  } finally {
    Date.now = original
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    const sorted: Record<string, unknown> = {}
    for (const [key, entry] of entries) sorted[key] = sortValue(entry)
    return sorted
  }
  return value
}

/**
 * `JSON.stringify` with object keys sorted at every depth, so two structurally equal
 * values always produce the same string regardless of key insertion order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}
