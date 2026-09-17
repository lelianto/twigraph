/**
 * Every error that crosses a module or process boundary in twigraph.
 *
 * A `TwigraphError` carries a stable code the UI can switch on, and a message that is safe to
 * show a user. It deliberately does not carry a stack across the wire: stacks contain file
 * contents and paths from the user's disk.
 */

export type ErrorCode =
  | 'CANCELLED'
  | 'CONFIG_INVALID'
  | 'CONFIG_VERSION_UNSUPPORTED'
  | 'EMBEDDING_UNAVAILABLE'
  | 'FOLDER_ALREADY_INDEXED'
  | 'FOLDER_NOT_FOUND'
  | 'FOLDER_UNREADABLE'
  | 'INDEX_CORRUPT'
  | 'INDEX_FAILED'
  | 'INDEX_IN_PROGRESS'
  | 'INDEX_NOT_FOUND'
  | 'INTERNAL'
  | 'LLM_FAILED'
  | 'LLM_UNAVAILABLE'
  | 'MODEL_NOT_PREPARED'
  | 'NETWORK_FORBIDDEN'
  | 'PARSE_EMPTY'
  | 'PARSE_FAILED'
  | 'PARSE_UNSUPPORTED_FORMAT'
  | 'QUERY_EMPTY'

/** Structured, non-sensitive context. Never put document text or file contents in here. */
export type ErrorDetail = Readonly<Record<string, string | number | boolean>>

export interface WireError {
  readonly code: ErrorCode
  readonly message: string
  readonly detail?: ErrorDetail
}

const INTERNAL_WIRE_ERROR: WireError = {
  code: 'INTERNAL',
  message: 'Unexpected internal error',
}

export interface TwigraphErrorOptions {
  readonly detail?: ErrorDetail
  readonly cause?: unknown
}

export class TwigraphError extends Error {
  readonly code: ErrorCode
  readonly detail: ErrorDetail | undefined

  constructor(code: ErrorCode, message: string, options: TwigraphErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TwigraphError'
    this.code = code
    this.detail = options.detail
  }

  toWire(): WireError {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail }
  }
}

export function isTwigraphError(value: unknown): value is TwigraphError {
  return value instanceof TwigraphError
}

/**
 * Converts an unknown throwable into something safe to hand to another process. Anything
 * that is not a `TwigraphError` becomes a generic internal error, because an arbitrary
 * `Error.message` can contain a file path or a fragment of a document.
 */
export function toWireError(value: unknown): WireError {
  return isTwigraphError(value) ? value.toWire() : INTERNAL_WIRE_ERROR
}
