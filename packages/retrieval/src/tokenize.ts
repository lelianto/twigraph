/** Anything that is not a letter or a digit. Unicode aware, so `könnte` stays one token. */
const SEPARATOR = /[^\p{L}\p{N}]+/u

/**
 * Case folding and Unicode normalisation, and nothing else.
 *
 * There is deliberately no stemmer and no stop-word list. A stop-word list would make the
 * ranking depend on a language the user never declared, and both would make the same
 * query return different results after a library upgrade — which is the opposite of what
 * a deterministic index is for.
 */
export function tokenize(text: string): readonly string[] {
  const normalized = text.normalize('NFC').toLowerCase()
  const tokens: string[] = []
  for (const token of normalized.split(SEPARATOR)) {
    if (token !== '') tokens.push(token)
  }
  return tokens
}
