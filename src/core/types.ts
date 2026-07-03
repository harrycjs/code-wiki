/**
 * Core domain types shared across the indexer, renderer, and MCP server.
 * Stable on disk; bump schemaVersion when changing shape.
 */

/** Schema versions of persisted wiki files. */
export const SCHEMA_VERSION = 1 as const

export type Language =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'ruby'
  | 'unknown'

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'module'

export interface Symbol {
  /** Stable id: `<repoRelFile>::<kind>.<name>`. */
  id: string
  name: string
  kind: SymbolKind
  /** Reconstructed source for the header only (signature line(s)). */
  signature: string
  /** 1-indexed inclusive line range in the source file. */
  lineRange: [number, number]
  /** First paragraph of docstring / leading comment, stripped of decorators. */
  docstring: string | null
  /** For methods: the owning class id. */
  parentId: string | null
  /** Heuristic: whether this is reachable from outside the module. */
  visibility: 'public' | 'internal'
  /** Cyclomatic complexity approximation from control-flow node counts. */
  complexity: number
}

export interface FileIndex {
  /** Repo-relative POSIX path. */
  repoPath: string
  /** Absolute path on disk at build time. */
  absPath: string
  /** Language for AST; null for unsupported files. */
  language: Language | null
  /** Size on disk at the time of indexing. */
  size: number
  /** mtime in milliseconds since epoch. */
  mtimeMs: number
  /** sha256(content) for content-based invalidation. */
  contentHash: string
  /** Extracted symbols (empty if no parser for this language). */
  symbols: Symbol[]
  /** Public functions/methods/classes — used by callers/callees resolution. */
  publicSymbols: Symbol[]
  /** First-paragraph docstring or summary of the file. */
  oneLineSummary: string
}

export interface ModuleInfo {
  id: string
  title: string
  files: string[]
  publicSurface: string[]
}

export interface ImportEdge {
  from: string
  to: string
  specifiers: string[]
}

export interface CallEdge {
  from: string
  to: string
}

export interface Graph {
  imports: ImportEdge[]
  calls: CallEdge[]
  dependents: Record<string, string[]>
}

export interface IndexTree {
  schemaVersion: number
  modules: Array<{
    id: string
    title: string
    path: string
    files: string[]
    tokens: number
  }>
  files: Array<{
    path: string
    module: string
    kind: 'source' | 'config' | 'docs'
    language: Language | null
    tokens: number
    symbols: number
    stale: boolean
    pagePath: string
  }>
  symbols: Array<{
    id: string
    name: string
    kind: SymbolKind
    file: string
    lineRange: [number, number]
    pagePath: string
    tokens: number
  }>
}

export interface WikiMeta {
  schemaVersion: number
  generator: string
  generatorVersion: string
  git: {
    head: string
    branch: string | null
    dirty: boolean
    remote: string | null
  }
  createdAt: string
  updatedAt: string
  durationMs: number
  languages: Language[]
  fileCount: number
  moduleCount: number
  symbolCount: number
  models: {
    staticSummaryVersion: string
    llmSummaryModel: string | null
    llmSummaryModelModule: string | null
  }
  options: {
    enrichment: boolean
    concurrency: number
  }
}

export interface WikiState {
  files: Record<
    string,
    {
      hash: string
      mtimeMs: number
      size: number
      lastIndexedAt: string
      symbols: number
      publicSignatureChanged: boolean
    }
  >
  lastHead: string
  nudged: Record<string, number> // path -> timestamp(ms) of last nudge
}

export interface WikiPage<T = unknown> {
  kind: 'architecture' | 'index' | 'module' | 'file' | 'symbol'
  id: string
  title: string
  /** Path within .codewiki/, POSIX style. */
  path: string
  source?: {
    repoPath: string
    language: Language | null
    module: string | null
    lineRange?: [number, number]
    symbol?: string
    symbolKind?: SymbolKind
    signature?: string
  }
  tokens: number
  stale: boolean
  generatedAt: string
  generator: string
  data: T
}
