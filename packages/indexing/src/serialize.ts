/**
 * Serialization with sorted keys.
 *
 * Determinism has to be a property of the writer, not a promise the caller keeps. If the
 * on-disk bytes depended on the order a caller happened to build an object in, two
 * identical indexes could differ and every snapshot comparison would be worthless.
 */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    const sorted: Record<string, unknown> = {}
    for (const [key, entry] of entries) sorted[key] = sortKeys(entry)
    return sorted
  }
  return value
}

export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortKeys(value), null, space)
}

/** One compact JSON object per line. Trailing newline, so a file always ends a line. */
export function toJsonLines(values: readonly unknown[]): string {
  if (values.length === 0) return ''
  return `${values.map((value) => JSON.stringify(sortKeys(value))).join('\n')}\n`
}

export function parseJsonLines<T>(raw: string): readonly T[] {
  const values: T[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    values.push(JSON.parse(line) as T)
  }
  return values
}
