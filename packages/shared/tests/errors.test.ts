import { describe, expect, it } from 'vitest'
import { isTwigraphError, TwigraphError, toWireError } from '../src/errors'

describe('TwigraphError', () => {
  it('carries a stable code, a human message and its name', () => {
    const error = new TwigraphError('PARSE_FAILED', 'Could not read the document')

    expect(error.code).toBe('PARSE_FAILED')
    expect(error.message).toBe('Could not read the document')
    expect(error.name).toBe('TwigraphError')
    expect(error).toBeInstanceOf(Error)
  })

  it('serializes to the wire without a stack or a cause', () => {
    const error = new TwigraphError('PARSE_FAILED', 'Could not read the PDF', {
      detail: { extension: '.pdf' },
      cause: new Error('secret internal detail'),
    })

    expect(error.toWire()).toEqual({
      code: 'PARSE_FAILED',
      message: 'Could not read the PDF',
      detail: { extension: '.pdf' },
    })
    expect(JSON.stringify(error.toWire())).not.toContain('secret internal detail')
    expect(JSON.stringify(error.toWire())).not.toContain('stack')
  })

  it('omits detail when none was given', () => {
    expect(new TwigraphError('INDEX_NOT_FOUND', 'No such index').toWire()).toEqual({
      code: 'INDEX_NOT_FOUND',
      message: 'No such index',
    })
  })

  it('keeps the cause off the wire but available in process', () => {
    const cause = new Error('root cause')
    const error = new TwigraphError('INDEX_FAILED', 'Indexing failed', { cause })

    expect(error.cause).toBe(cause)
    expect(error.toWire()).not.toHaveProperty('cause')
  })
})

describe('isTwigraphError', () => {
  it('recognizes a TwigraphError', () => {
    expect(isTwigraphError(new TwigraphError('INTERNAL', 'x'))).toBe(true)
  })

  it('rejects a plain Error and a foreign object that merely looks similar', () => {
    expect(isTwigraphError(new Error('x'))).toBe(false)
    expect(isTwigraphError({ code: 'INTERNAL', message: 'x' })).toBe(false)
    expect(isTwigraphError(null)).toBe(false)
    expect(isTwigraphError('PARSE_FAILED')).toBe(false)
  })
})

describe('toWireError', () => {
  it('passes a TwigraphError through unchanged', () => {
    const error = new TwigraphError('FOLDER_NOT_FOUND', 'That folder is not indexed')

    expect(toWireError(error)).toEqual(error.toWire())
  })

  it('never leaks the message of an unknown throwable', () => {
    const wire = toWireError(new Error('C:\\Users\\someone\\private-notes.txt failed'))

    expect(wire.code).toBe('INTERNAL')
    expect(wire.detail).toBeUndefined()
    expect(JSON.stringify(wire)).not.toContain('private-notes')
  })

  it('handles a non-Error throwable', () => {
    expect(toWireError('just a string').code).toBe('INTERNAL')
  })
})
