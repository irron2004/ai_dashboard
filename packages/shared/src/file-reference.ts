import { z } from 'zod'

export const FileReferenceForm = z.enum(['markdown', 'inline_code', 'quoted', 'bare'])
export type FileReferenceForm = z.infer<typeof FileReferenceForm>

export const FilePreviewKind = z.enum(['markdown', 'html', 'python'])
export type FilePreviewKind = z.infer<typeof FilePreviewKind>

const ParsedFileReferenceObjectSchema = z.object({
  raw: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  form: FileReferenceForm,
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
}).strict()

export const ParsedFileReferenceSchema = ParsedFileReferenceObjectSchema.refine((value) => value.end > value.start, {
  message: 'end must be greater than start',
  path: ['end'],
})
export type ParsedFileReference = z.infer<typeof ParsedFileReferenceSchema>

export const ResolvedFileReferenceSchema = ParsedFileReferenceObjectSchema.extend({
  token: z.string().min(1),
  projectId: z.string().min(1),
  canonicalPath: z.string().min(1),
  displayPath: z.string().min(1),
  workspaceRoot: z.string().min(1),
  kind: FilePreviewKind,
  size: z.number().int().nonnegative(),
}).strict().refine((value) => value.end > value.start, {
  message: 'end must be greater than start',
  path: ['end'],
})
export type ResolvedFileReference = z.infer<typeof ResolvedFileReferenceSchema>

export const FileRefsResolveReqSchema = z.object({
  projectId: z.string().min(1),
  activeWorktreePath: z.string().min(1).optional(),
  sessionWorkspacePath: z.string().min(1).optional(),
  candidates: z.array(ParsedFileReferenceSchema).max(100),
}).strict()
export type FileRefsResolveReq = z.infer<typeof FileRefsResolveReqSchema>

export const FileRefsResolveResSchema = z.object({
  resolved: z.array(ResolvedFileReferenceSchema),
  unresolved: z.array(z.object({
    candidate: ParsedFileReferenceSchema,
    reason: z.string().min(1),
  }).strict()),
}).strict()
export type FileRefsResolveRes = z.infer<typeof FileRefsResolveResSchema>

export const FilePreviewReadReqSchema = z.object({
  projectId: z.string().min(1),
  token: z.string().min(1),
}).strict()
export type FilePreviewReadReq = z.infer<typeof FilePreviewReadReqSchema>

export const FilePreviewReadResSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    reference: ResolvedFileReferenceSchema,
    content: z.string(),
    encoding: z.literal('utf8'),
  }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.string().min(1),
  }).strict(),
])
export type FilePreviewReadRes = z.infer<typeof FilePreviewReadResSchema>

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const MAX_PARSED_FILE_REFERENCES = 100
const FILE_EXTENSION_PATTERN = /\.(?:markdown|html|mdx|htm|md|py)/giu
const LOCATION_SUFFIX_PATTERN = /^(?::[1-9]\d*(?::[1-9]\d*)?|#L[1-9]\d*(?:C[1-9]\d*)?)/iu
const TRAILING_SOURCE_PUNCTUATION = /^[\])}>.,;!?…。，、；！？'"”’`]*$/u
const FOLLOWING_TEXT_BOUNDARY_PATTERN = /^[\])}>.,;!?…。，、；！？'"”’`]+\s/u

type SourceRange = { start: number; end: number }
type ParsedPathLocation = { path: string; line?: number; column?: number }

/** Pure allow-list classification. Path resolution and containment belong to the main process. */
export function filePreviewKindForPath(path: string): FilePreviewKind | undefined {
  const clean = path.toLowerCase().split(/[?#]/, 1)[0] ?? ''
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = clean.slice(dot)
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
  if (HTML_EXTENSIONS.has(extension)) return 'html'
  if (extension === '.py') return 'python'
  return undefined
}

function overlaps(range: SourceRange, ranges: readonly SourceRange[]): boolean {
  return ranges.some((other) => range.start < other.end && range.end > other.start)
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function parsePathLocation(value: string): ParsedPathLocation | null {
  let path = value.trim()
  if (!path || /[\0\r\n]/u.test(path)) return null

  let line: number | undefined
  let column: number | undefined
  const hashLocation = /^(.*)#L([1-9]\d*)(?:C([1-9]\d*))?$/iu.exec(path)
  const colonLocation = /^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/u.exec(path)
  const location = hashLocation ?? colonLocation
  if (location) {
    path = location[1]!.trimEnd()
    line = Number(location[2])
    if (location[3]) column = Number(location[3])
  }

  const windowsDrive = /^[A-Za-z]:[\\/]/u.test(path)
  if (!windowsDrive && /^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) return null
  if (path.includes('?') || path.includes('#')) return null
  if (!filePreviewKindForPath(path)) return null

  return { path, line, column }
}

function sourceFileEnd(value: string, allowFollowingText: boolean): {
  end: number
  location: ParsedPathLocation
} | null {
  FILE_EXTENSION_PATTERN.lastIndex = 0
  for (let extension = FILE_EXTENSION_PATTERN.exec(value); extension; extension = FILE_EXTENSION_PATTERN.exec(value)) {
    const extensionEnd = extension.index + extension[0].length
    const suffix = LOCATION_SUFFIX_PATTERN.exec(value.slice(extensionEnd))?.[0] ?? ''
    const end = extensionEnd + suffix.length
    const remainder = value.slice(end)
    const validBoundary = remainder.length === 0
      || TRAILING_SOURCE_PUNCTUATION.test(remainder)
      || (allowFollowingText && /^\s/u.test(remainder))
      || (allowFollowingText && FOLLOWING_TEXT_BOUNDARY_PATTERN.test(remainder))
    if (!validBoundary) continue
    const location = parsePathLocation(value.slice(0, end))
    if (location) return { end, location }
  }
  return null
}

function fencedCodeRanges(text: string): SourceRange[] {
  const ranges: SourceRange[] = []
  let open: { start: number; marker: '`' | '~'; length: number } | null = null
  let cursor = 0

  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor)
    const lineEnd = newline < 0 ? text.length : newline
    const fullEnd = newline < 0 ? text.length : newline + 1
    const line = text.slice(cursor, lineEnd).replace(/\r$/u, '')
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence) {
      const marker = fence[1]![0] as '`' | '~'
      const length = fence[1]!.length
      if (!open) {
        open = { start: cursor, marker, length }
      } else if (marker === open.marker && length >= open.length && fence[2]!.trim() === '') {
        ranges.push({ start: open.start, end: fullEnd })
        open = null
      }
    }
    cursor = fullEnd
  }

  if (open) ranges.push({ start: open.start, end: text.length })
  return ranges
}

function urlRanges(text: string): SourceRange[] {
  const ranges: SourceRange[] = []
  const pattern = /\b(?:https?:\/\/|mailto:)[^\s<>"'`]+/giu
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

function findMarkdownLabelStart(text: string, closeBracket: number): number | null {
  let depth = 1
  for (let cursor = closeBracket - 1; cursor >= 0 && text[cursor] !== '\n'; cursor -= 1) {
    if (isEscaped(text, cursor)) continue
    if (text[cursor] === ']') depth += 1
    if (text[cursor] === '[') {
      depth -= 1
      if (depth === 0) return cursor > 0 && text[cursor - 1] === '!' ? cursor - 1 : cursor
    }
  }
  return null
}

function findClosingParenthesis(text: string, openParenthesis: number): number | null {
  let depth = 1
  for (let cursor = openParenthesis + 1; cursor < text.length; cursor += 1) {
    if (isEscaped(text, cursor)) continue
    if (text[cursor] === '(') depth += 1
    if (text[cursor] === ')') {
      depth -= 1
      if (depth === 0) return cursor
    }
  }
  return null
}

function markdownDestination(value: string): ParsedPathLocation | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('<')) {
    const closing = trimmed.indexOf('>')
    if (closing > 0) return parsePathLocation(trimmed.slice(1, closing))
    return null
  }

  const whole = parsePathLocation(trimmed)
  if (whole) return whole

  // A CommonMark title may follow the destination. Prefer the longest valid prefix so
  // paths containing spaces remain intact when no title is present.
  for (let cursor = trimmed.length - 1; cursor > 0; cursor -= 1) {
    if (!/\s/u.test(trimmed[cursor]!)) continue
    const candidate = parsePathLocation(trimmed.slice(0, cursor))
    if (candidate) return candidate
  }
  return null
}

function exactClosingBackticks(text: string, from: number, length: number): number | null {
  const run = '`'.repeat(length)
  let cursor = text.indexOf(run, from)
  while (cursor >= 0) {
    if (text[cursor - 1] !== '`' && text[cursor + length] !== '`') return cursor
    cursor = text.indexOf(run, cursor + 1)
  }
  return null
}

/**
 * Finds previewable path candidates without touching the filesystem.
 *
 * Priority is Markdown destination → inline code → quoted text → bare path. Fenced
 * code and URL/mailto spans are deliberately excluded. Bare paths may contain spaces
 * when they start with an absolute, drive, UNC, explicit-relative, or directory prefix;
 * otherwise wrapping the path removes the ambiguity.
 */
export function parseFileReferences(text: string): ParsedFileReference[] {
  const references: ParsedFileReference[] = []
  const fences = fencedCodeRanges(text)
  const reserved: SourceRange[] = [...fences, ...urlRanges(text)]

  const add = (start: number, end: number, location: ParsedPathLocation, form: FileReferenceForm) => {
    const range = { start, end }
    if (references.length >= MAX_PARSED_FILE_REFERENCES || overlaps(range, references)) return
    references.push({
      raw: text.slice(start, end),
      path: location.path,
      line: location.line,
      column: location.column,
      form,
      start,
      end,
    })
  }

  // Markdown links reserve their complete syntax so later passes cannot tokenize labels
  // or invalid/remote destinations as unrelated bare paths.
  for (let closeBracket = text.indexOf(']('); closeBracket >= 0; closeBracket = text.indexOf('](', closeBracket + 2)) {
    const start = findMarkdownLabelStart(text, closeBracket)
    const closeParenthesis = findClosingParenthesis(text, closeBracket + 1)
    if (start === null || closeParenthesis === null) continue
    const end = closeParenthesis + 1
    const range = { start, end }
    if (!overlaps(range, fences)) {
      const location = markdownDestination(text.slice(closeBracket + 2, closeParenthesis))
      if (location && !overlaps(range, reserved)) add(start, end, location, 'markdown')
      reserved.push(range)
    }
    closeBracket = closeParenthesis
  }

  for (let cursor = 0; cursor < text.length;) {
    if (text[cursor] !== '`' || overlaps({ start: cursor, end: cursor + 1 }, fences)) {
      cursor += 1
      continue
    }
    let length = 1
    while (text[cursor + length] === '`') length += 1
    const closing = exactClosingBackticks(text, cursor + length, length)
    if (closing === null) {
      cursor += length
      continue
    }
    const end = closing + length
    const range = { start: cursor, end }
    const content = text.slice(cursor + length, closing).trim()
    const location = content.includes('\n') ? null : parsePathLocation(content)
    if (location && !overlaps(range, reserved)) add(cursor, end, location, 'inline_code')
    reserved.push(range)
    cursor = end
  }

  const quotePairs: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' }
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const opening = text[cursor]!
    const closingQuote = quotePairs[opening]
    if (!closingQuote || overlaps({ start: cursor, end: cursor + 1 }, reserved)) continue
    if (opening === "'" && cursor > 0 && /[\p{L}\p{N}]/u.test(text[cursor - 1]!)) continue
    let closing = text.indexOf(closingQuote, cursor + 1)
    while (closing >= 0 && isEscaped(text, closing)) closing = text.indexOf(closingQuote, closing + 1)
    if (closing < 0) continue
    const range = { start: cursor, end: closing + 1 }
    const location = parsePathLocation(text.slice(cursor + 1, closing))
    if (location && !overlaps(range, reserved)) {
      add(cursor, closing + 1, location, 'quoted')
      reserved.push(range)
    }
    cursor = closing
  }

  // Prefix-led paths can safely retain spaces until the first allow-listed filename.
  const prefixPattern = /(^|[\s([{<])(?:[A-Za-z]:[\\/]|\\\\|\/\/|\/(?!\/)|~[\\/]|\.{1,2}[\\/]|[\p{L}\p{N}_.-]+[\\/])/gmu
  for (let match = prefixPattern.exec(text); match; match = prefixPattern.exec(text)) {
    const boundaryLength = match[1]?.length ?? 0
    const start = match.index + boundaryLength
    let searchEnd = text.length
    for (const delimiter of ['\n', '\r', '\t', '`', '"', '“', '”']) {
      const found = text.indexOf(delimiter, start)
      if (found >= 0) searchEnd = Math.min(searchEnd, found)
    }
    searchEnd = Math.min(searchEnd, start + 4096)
    const found = sourceFileEnd(text.slice(start, searchEnd), true)
    if (!found) continue
    const range = { start, end: start + found.end }
    if (overlaps(range, reserved)) continue
    add(range.start, range.end, found.location, 'bare')
    reserved.push(range)
  }

  // Basenames and compact relative paths are unambiguous inside one non-space token.
  const tokenPattern = /\S+/gu
  for (let match = tokenPattern.exec(text); match; match = tokenPattern.exec(text)) {
    let start = match.index
    let token = match[0]
    while (token && /^[([{<'"“‘]/u.test(token)) {
      start += 1
      token = token.slice(1)
    }
    if (!token || overlaps({ start, end: start + token.length }, reserved)) continue
    const found = sourceFileEnd(token, false)
    if (!found) continue
    const range = { start, end: start + found.end }
    if (overlaps(range, reserved)) continue
    add(range.start, range.end, found.location, 'bare')
    reserved.push(range)
  }

  return references.sort((left, right) => left.start - right.start || left.end - right.end)
}

/** Alias retained for callers that name the pure operation after the plan's tokenizer terminology. */
export const tokenizeFileReferences = parseFileReferences
