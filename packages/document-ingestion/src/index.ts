export type { VersionedParser } from './parser'

export { createParserRegistry, defaultParsers, normalizeExtension } from './registry'
export type { ParserRegistry } from './registry'

export {
  createMarkdownParser,
  MARKDOWN_PARSER_ID,
  MARKDOWN_PARSER_VERSION,
} from './parsers/markdown'
export { createTextParser, TEXT_PARSER_ID, TEXT_PARSER_VERSION } from './parsers/text'
export {
  assembleDocument,
  firstNonBlankLine,
  normalizeNewlines,
  readDocumentText,
} from './parsers/base'

export { DEFAULT_IGNORED_DIRECTORIES, DEFAULT_MAX_FILE_SIZE_BYTES, scanFolder } from './scan'
export type { ScanOptions, ScanResult, ScanSkip, ScannedFile, SkipReason } from './scan'
