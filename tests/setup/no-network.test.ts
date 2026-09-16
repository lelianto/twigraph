import dns from 'node:dns'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installNetworkGuard,
  isAllowed,
  isLoopbackHost,
  NetworkForbiddenError,
  normalizeHost,
  OLLAMA_PORT,
  type NetworkGuard,
} from './no-network'

let guard: NetworkGuard | undefined

afterEach(() => {
  guard?.restore()
  guard = undefined
})

/** A real loopback server, so "allowed" provably means the traffic gets through. */
async function withLoopbackServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = createServer((_request, response) => {
    response.end('loopback-ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await fn(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('normalizeHost', () => {
  it('lowercases, strips IPv6 brackets and the trailing root dot', () => {
    expect(normalizeHost('  [::1] ')).toBe('::1')
    expect(normalizeHost('LOCALHOST.')).toBe('localhost')
    expect(normalizeHost('[2001:DB8::1]')).toBe('2001:db8::1')
  })
})

describe('isLoopbackHost', () => {
  it('accepts localhost, the whole 127.0.0.0/8 range, and IPv6 loopback', () => {
    for (const host of ['localhost', '127.0.0.1', '127.5.5.5', '::1', '0:0:0:0:0:0:0:1']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
  })

  it('rejects public hosts and addresses that only look like loopback', () => {
    for (const host of [
      'example.com',
      '8.8.8.8',
      '127.0.0.256',
      '10.0.0.1',
      '127.0.0.1.evil.com',
    ]) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
  })
})

describe('isAllowed', () => {
  it('refuses every non-loopback host in every mode', () => {
    for (const mode of ['default', 'ollama', 'offline'] as const) {
      expect(isAllowed(mode, 'api.example.com', 443, [OLLAMA_PORT])).toBe(false)
    }
  })

  it('allows loopback in default mode but never in offline mode', () => {
    expect(isAllowed('default', '127.0.0.1', 8080, [OLLAMA_PORT])).toBe(true)
    expect(isAllowed('offline', '127.0.0.1', 8080, [OLLAMA_PORT])).toBe(false)
  })

  it('restricts loopback to the configured ports in ollama mode', () => {
    expect(isAllowed('ollama', '127.0.0.1', OLLAMA_PORT, [OLLAMA_PORT])).toBe(true)
    expect(isAllowed('ollama', '127.0.0.1', 8080, [OLLAMA_PORT])).toBe(false)
    expect(isAllowed('ollama', '127.0.0.1', 8080, [8080])).toBe(true)
  })

  it('defers the port decision for DNS, which carries no port', () => {
    expect(isAllowed('ollama', '127.0.0.1', null, [OLLAMA_PORT])).toBe(true)
    expect(isAllowed('offline', '127.0.0.1', null, [OLLAMA_PORT])).toBe(false)
  })
})

describe('installNetworkGuard', () => {
  it('rejects a non-loopback fetch without touching the network', async () => {
    guard = installNetworkGuard({ mode: 'default' })

    await expect(fetch('https://example.com/private-doc.txt')).rejects.toBeInstanceOf(
      NetworkForbiddenError,
    )
    expect(guard.blocked()).toEqual([{ kind: 'fetch', target: 'example.com:443', allowed: false }])
  })

  it('names the refused target so a failure is debuggable', async () => {
    guard = installNetworkGuard({ mode: 'offline' })

    const error: unknown = await fetch('http://127.0.0.1:11434/api/tags').catch((caught) => caught)

    expect(error).toBeInstanceOf(NetworkForbiddenError)
    expect((error as NetworkForbiddenError).code).toBe('NETWORK_FORBIDDEN')
    expect((error as NetworkForbiddenError).target).toBe('127.0.0.1:11434')
  })

  it('lets an allowed loopback fetch reach a real server', async () => {
    await withLoopbackServer(async (port) => {
      guard = installNetworkGuard({ mode: 'default' })

      const response = await fetch(`http://127.0.0.1:${port}/health`)

      expect(await response.text()).toBe('loopback-ok')
      // fetch is recorded, and so is the TCP connect it performs underneath.
      expect(guard.attempts()).toContainEqual({
        kind: 'fetch',
        target: `127.0.0.1:${port}`,
        allowed: true,
      })
      expect(guard.attempts()).toContainEqual({
        kind: 'tcp',
        target: `127.0.0.1:${port}`,
        allowed: true,
      })
      expect(guard.blocked()).toEqual([])
    })
  })

  it('refuses loopback on a port ollama mode was not told about', async () => {
    await withLoopbackServer(async (port) => {
      guard = installNetworkGuard({ mode: 'ollama', loopbackPorts: [OLLAMA_PORT] })

      await expect(fetch(`http://127.0.0.1:${port}/api/tags`)).rejects.toBeInstanceOf(
        NetworkForbiddenError,
      )
    })
  })

  it('allows loopback on an explicitly permitted ollama port', async () => {
    await withLoopbackServer(async (port) => {
      guard = installNetworkGuard({ mode: 'ollama', loopbackPorts: [port] })

      const response = await fetch(`http://127.0.0.1:${port}/api/tags`)

      expect(await response.text()).toBe('loopback-ok')
      expect(guard.blocked()).toEqual([])
    })
  })

  it('refuses a raw TCP connect to a non-loopback host', () => {
    guard = installNetworkGuard({ mode: 'default' })

    expect(() => net.connect({ host: '93.184.216.34', port: 80 })).toThrow(NetworkForbiddenError)
    expect(guard.blocked()).toEqual([{ kind: 'tcp', target: '93.184.216.34:80', allowed: false }])
  })

  it('leaves unix sockets and named pipes alone', () => {
    guard = installNetworkGuard({ mode: 'offline' })

    const socket = net.connect('\\\\.\\pipe\\mulat-not-a-network')
    socket.on('error', () => {})
    socket.destroy()

    expect(guard.attempts()).toEqual([])
  })

  it('refuses a non-loopback DNS lookup', () => {
    guard = installNetworkGuard({ mode: 'default' })

    expect(() => dns.lookup('telemetry.example.com', () => {})).toThrow(NetworkForbiddenError)
    expect(guard.blocked()).toEqual([
      { kind: 'dns', target: 'telemetry.example.com', allowed: false },
    ])
  })

  it('clears recorded attempts on reset without unpatching', async () => {
    guard = installNetworkGuard({ mode: 'default' })
    await expect(fetch('https://example.com')).rejects.toBeInstanceOf(NetworkForbiddenError)
    expect(guard.attempts()).toHaveLength(1)

    guard.reset()

    expect(guard.attempts()).toEqual([])
    await expect(fetch('https://example.com')).rejects.toBeInstanceOf(NetworkForbiddenError)
  })

  it('restores fetch, connect and lookup on restore', () => {
    const originalFetch = globalThis.fetch
    const originalConnect = net.Socket.prototype.connect
    const originalLookup = dns.lookup

    const installed = installNetworkGuard({ mode: 'default' })
    expect(globalThis.fetch).not.toBe(originalFetch)

    installed.restore()

    expect(globalThis.fetch).toBe(originalFetch)
    expect(net.Socket.prototype.connect).toBe(originalConnect)
    expect(dns.lookup).toBe(originalLookup)
  })

  it('reports its own mode', () => {
    guard = installNetworkGuard({ mode: 'ollama' })

    expect(guard.mode).toBe('ollama')
  })

  it('refuses a non-loopback fetch passed as a URL object', async () => {
    guard = installNetworkGuard({ mode: 'default' })

    await expect(fetch(new URL('https://example.com/doc'))).rejects.toBeInstanceOf(
      NetworkForbiddenError,
    )
    expect(guard.blocked()).toEqual([{ kind: 'fetch', target: 'example.com:443', allowed: false }])
  })

  it('refuses a non-loopback fetch passed as a Request object', async () => {
    guard = installNetworkGuard({ mode: 'default' })

    await expect(fetch(new Request('https://example.com/doc'))).rejects.toBeInstanceOf(
      NetworkForbiddenError,
    )
    expect(guard.blocked()).toEqual([{ kind: 'fetch', target: 'example.com:443', allowed: false }])
  })

  it('refuses a malformed URL without recording it as a network attempt', async () => {
    guard = installNetworkGuard({ mode: 'default' })

    await expect(fetch('not a url at all')).rejects.toBeInstanceOf(NetworkForbiddenError)
    expect(guard.attempts()).toEqual([])
  })

  it('rejects a non-loopback promise-based DNS lookup', async () => {
    guard = installNetworkGuard({ mode: 'default' })

    await expect(dns.promises.lookup('telemetry.example.com')).rejects.toBeInstanceOf(
      NetworkForbiddenError,
    )
    expect(guard.blocked()).toEqual([
      { kind: 'dns', target: 'telemetry.example.com', allowed: false },
    ])
  })

  it('reads a numeric port from net.connect(port, host)', () => {
    guard = installNetworkGuard({ mode: 'ollama' })

    const socket = net.connect(OLLAMA_PORT, '127.0.0.1')
    socket.on('error', () => {})
    socket.destroy()

    expect(guard.attempts()).toContainEqual({
      kind: 'tcp',
      target: `127.0.0.1:${OLLAMA_PORT}`,
      allowed: true,
    })
    expect(guard.blocked()).toEqual([])
  })

  it('leaves a directly connected socket path untouched', () => {
    guard = installNetworkGuard({ mode: 'offline' })

    const socket = new net.Socket().connect('\\\\.\\pipe\\mulat-not-a-network')
    socket.on('error', () => {})
    socket.destroy()

    expect(guard.attempts()).toEqual([])
  })

  it('refuses a loopback connect whose port it cannot read', () => {
    guard = installNetworkGuard({ mode: 'ollama' })

    // A non-numeric port is not a shape the types allow, but it is the shape a guard has
    // to survive: an unreadable port cannot be checked, so it must fail closed.
    const options = { host: '127.0.0.1', port: 'not-a-port' } as unknown as net.NetConnectOpts

    expect(() => net.connect(options)).toThrow(NetworkForbiddenError)
    expect(guard.blocked()).toEqual([{ kind: 'tcp', target: '127.0.0.1:0', allowed: false }])
  })
})
