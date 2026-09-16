/**
 * mulat network guard.
 *
 * mulat promises that a user's files never leave the device. This module is how
 * the test suite proves it: install the guard, run the whole pipeline, then assert
 * that nothing reached the network that the current mode does not allow.
 *
 * | mode      | loopback                                       | anything else |
 * | --------- | ---------------------------------------------- | ------------- |
 * | `default` | allowed                                        | refused       |
 * | `ollama`  | allowed on `loopbackPorts` (default 11434) only | refused       |
 * | `offline` | refused                                        | refused       |
 *
 * `fetch` rejects asynchronously, like the real `fetch` does. `net` and `dns` throw
 * synchronously, because that is the only way to stop a connection before it starts.
 *
 * Coverage note: `dns` is imported as a default import on purpose. Node builds a static
 * ESM facade for a CJS builtin, so `import { lookup } from 'node:dns'` captures the
 * original function at instantiation time and cannot be intercepted. The default import
 * is the live CJS exports object, which the guard can patch. The authoritative sink is
 * `net.Socket.prototype.connect` anyway — every HTTP and TLS path ends there.
 */

import dns from 'node:dns'
import net from 'node:net'

export type NetworkMode =
  /** Anything that is not loopback is refused. */
  | 'default'
  /** Loopback is allowed, but only on the given ports. */
  | 'ollama'
  /** Nothing at all is allowed, loopback included. */
  | 'offline'

export interface NetworkAttempt {
  readonly kind: 'fetch' | 'tcp' | 'dns'
  readonly target: string
  readonly allowed: boolean
}

export interface NetworkGuardOptions {
  readonly mode?: NetworkMode
  /** Loopback ports permitted in `ollama` mode. Defaults to `[11434]`. */
  readonly loopbackPorts?: readonly number[]
}

export interface NetworkGuard {
  readonly mode: NetworkMode
  attempts(): readonly NetworkAttempt[]
  blocked(): readonly NetworkAttempt[]
  reset(): void
  restore(): void
}

export const OLLAMA_PORT = 11434

export class NetworkForbiddenError extends Error {
  readonly code = 'NETWORK_FORBIDDEN'

  constructor(readonly target: string) {
    super(`Network access to ${target} is forbidden by the mulat network guard`)
    this.name = 'NetworkForbiddenError'
  }
}

const LOOPBACK_V4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const OCTETS_MAX = 255

/** Lowercase, strip IPv6 brackets and the trailing root dot. */
export function normalizeHost(host: string): string {
  const trimmed = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.+)\]$/, '$1')
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed
}

/** `localhost`, the whole 127.0.0.0/8 range, and both IPv6 loopback spellings. */
export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host)
  if (normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true
  }
  const match = LOOPBACK_V4.exec(normalized)
  if (match === null) return false
  return [match[1], match[2], match[3]].every((octet) => Number(octet) <= OCTETS_MAX)
}

export function isAllowed(
  mode: NetworkMode,
  host: string,
  port: number | null,
  loopbackPorts: readonly number[],
): boolean {
  if (!isLoopbackHost(host)) return false
  if (mode === 'offline') return false
  // DNS carries no port, so the port rule is enforced later, at connect time.
  if (mode === 'ollama') return port === null || loopbackPorts.includes(port)
  return true
}

type ConnectTarget = { kind: 'path' } | { kind: 'hostport'; host: string; port: number }

/**
 * Used when a TCP connect carries a loopback host but no readable port. Refusing is the
 * safe direction for a guard: an unknown port cannot be checked against the allowlist,
 * and the failure is loud rather than a silent pass.
 */
const UNKNOWN_PORT = 0

/**
 * Ports arrive as a number from `net.connect(port, host)` and as a *string* from the
 * `fetch` path (undici forwards `port: '11434'`), so accept both. Anything unparseable is
 * reported as unknown rather than coerced to a wrong number.
 */
function toPort(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return UNKNOWN_PORT
}

/**
 * `net.connect(...)` does not forward its arguments — it forwards a single array holding
 * them, padded with a `null` callback placeholder, e.g. `[[{ host, port }, null]]`.
 * Unwrap that before reading anything out of it.
 */
function unwrapConnectArgs(args: readonly unknown[]): readonly unknown[] {
  let current = args
  while (current.length === 1 && Array.isArray(current[0])) {
    current = current[0] as unknown[]
  }
  return current
}

function parseConnectArgs(rawArgs: readonly unknown[]): ConnectTarget {
  const args = unwrapConnectArgs(rawArgs)

  // The options object is the first non-null, non-array entry; a trailing callback is a
  // function, so it never matches.
  const options = args.find(
    (arg) => arg !== null && typeof arg === 'object' && !Array.isArray(arg),
  ) as { path?: unknown; host?: unknown; port?: unknown } | undefined

  if (options !== undefined) {
    if (typeof options.path === 'string') return { kind: 'path' }
    return {
      kind: 'hostport',
      host: typeof options.host === 'string' ? options.host : 'localhost',
      port: toPort(options.port),
    }
  }

  const first = args[0]

  // `connect(path)` — a unix socket or a Windows named pipe.
  if (typeof first === 'string') return { kind: 'path' }

  if (typeof first === 'number') {
    return {
      kind: 'hostport',
      host: typeof args[1] === 'string' ? args[1] : 'localhost',
      port: first,
    }
  }

  return { kind: 'path' }
}

function assign(target: object, key: string, value: unknown): void {
  ;(target as Record<string, unknown>)[key] = value
}

export function installNetworkGuard(options: NetworkGuardOptions = {}): NetworkGuard {
  const mode = options.mode ?? 'default'
  const loopbackPorts = options.loopbackPorts ?? [OLLAMA_PORT]
  const recorded: NetworkAttempt[] = []

  const originalFetch = globalThis.fetch
  const originalConnect = net.Socket.prototype.connect
  const originalLookup = dns.lookup
  const originalPromiseLookup = dns.promises.lookup

  const label = (host: string, port: number | null): string =>
    port === null ? host : `${host}:${port}`

  const admit = (kind: NetworkAttempt['kind'], host: string, port: number | null): void => {
    const allowed = isAllowed(mode, host, port, loopbackPorts)
    recorded.push({ kind, target: label(host, port), allowed })
    if (!allowed) throw new NetworkForbiddenError(label(host, port))
  }

  const portOf = (url: URL): number => {
    if (url.port !== '') return Number(url.port)
    return url.protocol === 'https:' ? 443 : 80
  }

  const patchedFetch: typeof fetch = (input, init) => {
    const raw =
      input instanceof URL ? input.href : typeof input === 'string' ? input : String(input.url)
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return Promise.reject(new NetworkForbiddenError(raw))
    }
    try {
      admit('fetch', parsed.hostname, portOf(parsed))
    } catch (error) {
      return Promise.reject(error)
    }
    return originalFetch(input, init)
  }

  const patchedConnect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const parsed = parseConnectArgs(args)
    if (parsed.kind === 'hostport') admit('tcp', parsed.host, parsed.port)
    return (originalConnect as unknown as (...rest: unknown[]) => net.Socket).apply(this, args)
  }

  const patchedLookup = function (...args: unknown[]): unknown {
    admit('dns', String(args[0]), null)
    return (originalLookup as unknown as (...rest: unknown[]) => unknown)(...args)
  }

  // A promise-returning API rejects; it does not throw synchronously.
  const patchedPromiseLookup = function (...args: unknown[]): unknown {
    try {
      admit('dns', String(args[0]), null)
    } catch (error) {
      return Promise.reject(error)
    }
    return (originalPromiseLookup as unknown as (...rest: unknown[]) => unknown)(...args)
  }

  globalThis.fetch = patchedFetch
  net.Socket.prototype.connect = patchedConnect as unknown as typeof net.Socket.prototype.connect
  assign(dns, 'lookup', patchedLookup)
  assign(dns.promises, 'lookup', patchedPromiseLookup)

  return {
    mode,
    attempts: () => [...recorded],
    blocked: () => recorded.filter((attempt) => !attempt.allowed),
    reset: () => {
      recorded.length = 0
    },
    restore: () => {
      globalThis.fetch = originalFetch
      net.Socket.prototype.connect = originalConnect
      assign(dns, 'lookup', originalLookup)
      assign(dns.promises, 'lookup', originalPromiseLookup)
    },
  }
}
