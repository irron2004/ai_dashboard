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
