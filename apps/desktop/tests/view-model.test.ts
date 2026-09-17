import { describe, expect, it } from 'vitest'

import type { Answer, Citation, SearchHit } from '@twigraph/shared'
import type { FolderSummary } from '@twigraph/shared/ipc'

import {
  accessibleHitLabel,
  answerLines,
  citationFor,
  citationLabel,
  describeIndexProgress,
  formatBytes,
  formatScore,
  formatWhen,
  folderName,
  folderStateLine,
  groupAnswerSources,
  hitHeading,
  hitPageRange,
  resultStatus,
  workspacePhase,
} from '../src/renderer/view-model'

const hit: SearchHit = {
  chunkId: '6fa170768c2f2b6d:1',
  documentId: '6fa170768c2f2b6d',
  filename: 'storage.md',
  absolutePath: 'C:\\notes\\storage.md',
  headingPath: ['Storage', 'Atomic writes'],
  excerpt: 'A write goes to a temporary file and is then renamed into place.',
  text: 'Atomic writes\n\nA write goes to a temporary file.\n\nIt is then renamed into place.',
  score: 0.6690140845070423,
  ranks: { bm25: 0 },
}

const citation: Citation = {
  marker: 2,
  chunkId: hit.chunkId,
  filename: hit.filename,
  absolutePath: hit.absolutePath,
  page: 4,
  pageEnd: 6,
  headingPath: hit.headingPath,
  excerpt: hit.excerpt,
}

const answer: Answer = {
  status: 'answered',
  text: 'A write goes to a temporary file. [1]\n\nThe staging directory is swapped in. [2] [1]',
  passages: [],
  citations: [{ ...citation, marker: 1 }, citation],
  provider: 'extractive',
  unverifiedMarkers: [],
  sources: [hit],
}

describe('choosing the workspace phase', () => {
  const folder: FolderSummary = {
    id: '7c5ff45cf68f1b5a',
    path: 'C:\\notes',
    addedAtMs: 1_700_000_000_000,
    lastIndexedAtMs: null,
    documentCount: 0,
    chunkCount: 0,
    failedCount: 0,
    indexSizeBytes: 0,
  }

  it('distinguishes first run, indexing setup and a ready workspace', () => {
    expect(workspacePhase({ folders: [], activeFolderId: null, answer: null, result: null })).toBe(
      'no-folders',
    )
    expect(
      workspacePhase({ folders: [folder], activeFolderId: folder.id, answer: null, result: null }),
    ).toBe('needs-index')
    expect(
      workspacePhase({
        folders: [{ ...folder, lastIndexedAtMs: 1_700_000_000_000, documentCount: 4 }],
        activeFolderId: folder.id,
        answer: null,
        result: null,
      }),
    ).toBe('ready')
  })

  it('lets an answer or search result take priority over the idle phase', () => {
    expect(
      workspacePhase({ folders: [folder], activeFolderId: folder.id, answer, result: null }),
    ).toBe('answer')
    expect(
      workspacePhase({
        folders: [folder],
        activeFolderId: folder.id,
        answer: null,
        result: { query: 'atomic', mode: 'lexical', hits: [hit], tookMs: 3 },
      }),
    ).toBe('search-results')
  })
})

describe('describing result evidence', () => {
  it('separates cited sources from additional retrieved passages', () => {
    const additional = { ...hit, chunkId: 'another:1', filename: 'other.md' }
    const grouped = groupAnswerSources({ ...answer, sources: [hit, additional] })

    expect(grouped.cited).toEqual([hit])
    expect(grouped.additional).toEqual([additional])
  })

  it('builds a useful accessible name for a source row', () => {
    expect(accessibleHitLabel(hit)).toBe('storage.md, § Storage › Atomic writes, relevance 0.67')
  })

  it('announces answer, insufficient and search outcomes plainly', () => {
    expect(resultStatus({ answer, result: null })).toBe('Answer ready with 2 sources.')
    expect(resultStatus({ answer: { ...answer, status: 'insufficient' }, result: null })).toBe(
      'No reliable answer. 1 closest passage available.',
    )
    expect(
      resultStatus({
        answer: null,
        result: { query: 'atomic', mode: 'lexical', hits: [hit], tookMs: 3 },
      }),
    ).toBe('1 matching passage found.')
  })
})

describe('turning an answer into lines', () => {
  it('keeps one line per passage, in the order the engine wrote them', () => {
    const lines = answerLines(answer.text)

    expect(lines).toHaveLength(2)
    expect(lines[0]?.markers).toEqual([1])
    expect(lines[1]?.markers).toEqual([2, 1])
  })

  it('takes the markers out of the text, leaving a sentence that reads on its own', () => {
    const lines = answerLines(answer.text)

    expect(lines[0]?.text).toBe('A write goes to a temporary file.')
    expect(lines[1]?.text).toBe('The staging directory is swapped in.')
  })

  it('reports a marker only once, however often it appears', () => {
    expect(answerLines('Same source twice. [3] [3]')[0]?.markers).toEqual([3])
  })

  it('leaves an answer with no markers as a single line', () => {
    expect(answerLines('No reliable answer found.')).toEqual([
      { text: 'No reliable answer found.', markers: [] },
    ])
  })

  it('ignores blank space between passages', () => {
    expect(answerLines('\n\n  First. [1]  \n\n\n')).toHaveLength(1)
  })

  it('treats square brackets that are not markers as text', () => {
    expect(answerLines('See the [docs] for more.')[0]?.text).toBe('See the [docs] for more.')
  })
})

describe('finding the source behind a marker', () => {
  it('finds the citation the marker points at', () => {
    expect(citationFor(answer, 2)?.page).toBe(4)
  })

  it('has nothing to show for a marker that is not in the answer', () => {
    expect(citationFor(answer, 9)).toBeUndefined()
  })
})

describe('labelling a location', () => {
  it('names the file and how to find the passage in it', () => {
    expect(citationLabel(citation)).toBe('storage.md — pp. 4–6 · § Storage › Atomic writes')
  })

  it('falls back to the filename for a format with no headings or pages', () => {
    expect(
      citationLabel({ ...citation, page: undefined, pageEnd: undefined, headingPath: [] }),
    ).toBe('storage.md — storage.md')
  })

  it('shows a heading trail for a search hit, which has no marker yet', () => {
    expect(hitHeading(hit)).toBe('§ Storage › Atomic writes')
  })

  it('shows no heading for a plain text file', () => {
    expect(hitHeading({ ...hit, headingPath: [] })).toBeNull()
  })

  it('shows a page range only when the format has pages', () => {
    expect(hitPageRange({ ...hit, page: 2, pageEnd: 3 })).toBe('pp. 2–3')
    expect(hitPageRange(hit)).toBeNull()
  })
})

describe('naming a folder', () => {
  it('takes the last segment of a path on either separator', () => {
    expect(folderName('C:\\Users\\me\\Documents')).toBe('Documents')
    expect(folderName('/home/me/Documents')).toBe('Documents')
  })

  it('ignores a trailing separator', () => {
    expect(folderName('C:\\Users\\me\\Documents\\')).toBe('Documents')
  })

  it('falls back to the whole string rather than showing nothing', () => {
    expect(folderName('Documents')).toBe('Documents')
    expect(folderName('C:\\')).toBe('C:')
  })
})

describe('formatting numbers for the screen', () => {
  it('describes a score to two places', () => {
    expect(formatScore(0.6690140845070423)).toBe('0.67')
    expect(formatScore(1)).toBe('1.00')
  })

  it('describes a size in the unit a person would say', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(28318)).toBe('27.7 KB')
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB')
  })
})

describe('what a folder row says', () => {
  const folder: FolderSummary = {
    id: '7c5ff45cf68f1b5a',
    path: 'C:\\notes',
    addedAtMs: 1_700_000_000_000,
    lastIndexedAtMs: null,
    documentCount: 0,
    chunkCount: 0,
    failedCount: 0,
    indexSizeBytes: 0,
  }

  it('says plainly that a folder has never been indexed', () => {
    expect(folderStateLine(folder)).toBe('Not indexed yet')
  })

  it('counts the documents, the chunks, the failures and the size', () => {
    expect(
      folderStateLine({
        ...folder,
        lastIndexedAtMs: 1_700_000_000_000,
        documentCount: 11,
        chunkCount: 18,
        failedCount: 3,
        indexSizeBytes: 27238,
      }),
    ).toBe('11 documents  18 chunks  3 unreadable  26.6 KB')
  })

  it('leaves out the failure count when nothing failed', () => {
    expect(
      folderStateLine({
        ...folder,
        lastIndexedAtMs: 1_700_000_000_000,
        documentCount: 1,
        chunkCount: 2,
        indexSizeBytes: 500,
      }),
    ).toBe('1 document  2 chunks  500 B')
  })

  it('does not report an index of nothing as a size', () => {
    expect(
      folderStateLine({ ...folder, lastIndexedAtMs: 1_700_000_000_000, indexSizeBytes: 358 }),
    ).toBe('Indexed, but nothing in it could be read')
  })
})

describe('saying when something last happened', () => {
  const now = 1_700_000_000_000

  it('says plainly when a folder has never been indexed', () => {
    expect(formatWhen(null, now)).toBe('Not indexed yet')
  })

  it('uses words for the recent past and a date for anything older', () => {
    expect(formatWhen(now - 5_000, now)).toBe('Just now')
    expect(formatWhen(now - 60_000, now)).toBe('1 minute ago')
    expect(formatWhen(now - 12 * 60_000, now)).toBe('12 minutes ago')
    expect(formatWhen(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(formatWhen(now - 2 * 86_400_000, now)).toBe('2 days ago')
    expect(formatWhen(now - 40 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('does not claim a future time', () => {
    expect(formatWhen(now + 60_000, now)).toBe('Just now')
  })
})

describe('describing an index run', () => {
  it('names the file being read and how far along it is', () => {
    expect(
      describeIndexProgress({
        folderId: 'abc',
        phase: 'parsing',
        documentsTotal: 11,
        documentsProcessed: 4,
        chunksWritten: 7,
        currentFile: 'notes/storage.md',
      }),
    ).toBe('Reading notes/storage.md — 4 of 11')
  })

  it('says it is writing when there is no file in hand', () => {
    expect(
      describeIndexProgress({
        folderId: 'abc',
        phase: 'writing',
        documentsTotal: 11,
        documentsProcessed: 11,
        chunksWritten: 18,
        currentFile: null,
      }),
    ).toBe('Writing the index — 11 of 11')
  })
})
