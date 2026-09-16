import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, IPC_EVENTS, PRIVACY_MESSAGE } from '../src/ipc'

describe('IPC_CHANNELS', () => {
  it('has no duplicate channel names', () => {
    const values = Object.values(IPC_CHANNELS)

    expect(new Set(values).size).toBe(values.length)
  })

  it('namespaces every channel as resource:action', () => {
    for (const value of Object.values(IPC_CHANNELS)) {
      expect(value, value).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('does not collide with an event name', () => {
    const events = new Set<string>(Object.values(IPC_EVENTS))

    for (const value of Object.values(IPC_CHANNELS)) {
      expect(events.has(value), value).toBe(false)
    }
  })

  it('exposes no generic passthrough channel', () => {
    expect(Object.values(IPC_CHANNELS)).not.toContain('invoke')
    expect(Object.values(IPC_CHANNELS).some((value) => value.includes('*'))).toBe(false)
  })
})

describe('IPC_EVENTS', () => {
  it('has no duplicate event names', () => {
    const values = Object.values(IPC_EVENTS)

    expect(new Set(values).size).toBe(values.length)
  })
})

describe('PRIVACY_MESSAGE', () => {
  it('is the exact promise the product makes', () => {
    expect(PRIVACY_MESSAGE).toBe('Your files stay on this device.')
  })
})
