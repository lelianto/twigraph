import { describe, expect, it } from 'vitest'
import { canonicalFolderPath, folderIdFor } from '../src/folders'

describe('folderIdFor', () => {
  it('is stable for the same folder', () => {
    expect(folderIdFor('/home/someone/Documents', 'linux')).toBe(
      folderIdFor('/home/someone/Documents', 'linux'),
    )
  })

  it('ignores a trailing separator', () => {
    const withSeparator = folderIdFor('/home/someone/Documents/', 'linux')
    const without = folderIdFor('/home/someone/Documents', 'linux')

    expect(withSeparator).toBe(without)
  })

  it('treats the two Windows separators as the same folder', () => {
    expect(folderIdFor('C:\\Users\\someone\\Docs', 'win32')).toBe(
      folderIdFor('C:/Users/someone/Docs', 'win32'),
    )
  })

  it('folds case on Windows but not on Linux', () => {
    expect(folderIdFor('C:\\Users\\Someone\\Docs', 'win32')).toBe(
      folderIdFor('c:\\users\\someone\\docs', 'win32'),
    )
    expect(folderIdFor('/home/Someone/Docs', 'linux')).not.toBe(
      folderIdFor('/home/someone/docs', 'linux'),
    )
  })

  it('separates different folders', () => {
    expect(folderIdFor('/home/someone/A', 'linux')).not.toBe(
      folderIdFor('/home/someone/B', 'linux'),
    )
  })

  it('is a short hex string, safe to use as a directory name', () => {
    expect(folderIdFor('/home/someone/Documents', 'linux')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('canonicalFolderPath', () => {
  it('makes a relative path absolute', () => {
    expect(canonicalFolderPath('relative/dir')).toBe(
      canonicalFolderPath(`${process.cwd()}/relative/dir`),
    )
  })

  it('drops a trailing separator', () => {
    const resolved = canonicalFolderPath(`${process.cwd()}/relative/dir`)
    expect(canonicalFolderPath(`${process.cwd()}/relative/dir/`)).toBe(resolved)
  })

  it('keeps a filesystem root intact', () => {
    const root = canonicalFolderPath(process.cwd())
    expect(root.length).toBeGreaterThan(1)
  })

  it('resolves . and .. segments', () => {
    expect(canonicalFolderPath('a/b/../c')).toBe(canonicalFolderPath('a/c'))
  })
})
