import path from 'node:path'
import { promises as fs } from 'node:fs'
import { log, child } from '../shared/log.js'
import { atomicWriteText, exists, repoRel, writeJson } from '../shared/fs.js'
import { configSummary, loadConfig, type CodeWikiConfig } from './config.js'
import { walkFiles } from './walker.js'
import { groupModules } from './modules.js'
import { sha256Hex } from '../shared/hash.js'
import {
  buildArchitecturePage,
  renderArchitecture,
} from './render/architecture.js'
import {
  buildIndexPage,
  renderIndex,
} from './render/index-page.js'
import {
  buildModulePage,
  renderModule,
} from './render/module-page.js'
import {
  buildFilePage,
  renderFile,
} from './render/file-page.js'
import {
  buildSymbolPage,
  renderSymbol,
} from './render/symbol-page.js'
import type {
  FileIndex,
  IndexTree,
  Language,
  ModuleInfo,
  Symbol,
  WikiMeta,
} from './types.js'
import { SCHEMA_VERSION } from './types.js'

/**
 * Orchestrator: walks the repo, builds in-memory index, renders pages,
 * writes `.codewiki/`. v1 is static-only — tree-sitter extraction lands in M2.
 */

export interface BuildOptions {
  cwd: string
  config?: CodeWikiConfig
  configPath?: string
  full?: boolean
  log?: (msg: string) => void
}

export interface BuildResult {
  meta: WikiMeta
  root: string
  outDir: string
  durationMs: number
  fileCount: number
  moduleCount: number
  symbolCount: number
}

export async function buildWiki(opts: BuildOptions): Promise<BuildResult> {
  const t0 = Date.now()
  const cfg = opts.config ?? (await loadConfig(opts.cwd, opts.configPath))
  const root = opts.cwd
  const outRel = cfg.outDir
  const outAbs = path.resolve(root, outRel)
  const outNew = `${outAbs}.new`

  const log_ = child({ phase: 'build', root, out: outRel })
  log_.info({ cfg: configSummary(cfg) }, 'starting build')

  // 1. Walk files.
  const walked = await walkFiles({
    root,
    ignoreGlobs: cfg.ignore,
    includeExtensions: cfg.includeExtensions,
  })
  log_.info({ count: walked.length }, 'walked files')

  // 2. Build FileIndex entries. v1: tree-sitter symbol extraction is deferred
  //    to M2; for now we expose file metadata + language detection + content hash.
  const files: FileIndex[] = []
  const languages = new Set<Language>()

  for (const w of walked) {
    if (w.repoPath.startsWith('.codewiki/') || w.repoPath.startsWith('.git/')) continue
    if (!w.language) continue // M1 only emits pages for languages we can name
    languages.add(w.language)

    let content = ''
    try {
      content = await fs.readFile(w.absPath, 'utf8')
    } catch (err) {
      log_.debug({ path: w.repoPath, err: String(err) }, 'failed to read')
      continue
    }
    const hash = sha256Hex(content)
    const summary = makeStaticFileSummary(content, w.repoPath)
    const publicSymbols: Symbol[] = [] // filled in M2
    files.push({
      repoPath: w.repoPath,
      absPath: w.absPath,
      language: w.language,
      size: w.size,
      mtimeMs: w.mtimeMs,
      contentHash: hash,
      symbols: [],
      publicSymbols,
      oneLineSummary: summary,
    })
  }

  // 3. Group modules.
  const modules = groupModules(files, cfg)
  const visibleModuleCount = [...modules.keys()].filter(
    (id) => !cfg.modules.ignore.includes(id),
  ).length

  // 4. Render pages.
  const filePagePaths = new Map<string, string>()
  const moduleTokens = new Map<string, number>()
  const symbolCount = files.reduce((a, f) => a + f.symbols.length, 0)

  // Architecture
  const meta: WikiMeta = {
    schemaVersion: SCHEMA_VERSION,
    generator: 'code-wiki',
    generatorVersion: '0.1.0',
    git: { head: 'uncommitted', branch: null, dirty: true, remote: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    durationMs: 0,
    languages: [...languages],
    fileCount: files.length,
    moduleCount: visibleModuleCount,
    symbolCount,
    models: {
      staticSummaryVersion: 'static-v1',
      llmSummaryModel: null,
      llmSummaryModelModule: null,
    },
    options: {
      enrichment: cfg.enrichment.enabled,
      concurrency: cfg.enrichment.concurrency,
    },
  }

  const arch = buildArchitecturePage(meta, files, cfg)
  await writeText(outNew, 'architecture.md', renderArchitecture(arch.page, arch.body))

  // Per-file pages
  for (const f of files) {
    const fp = buildFilePage(f)
    filePagePaths.set(f.repoPath, fp.page.path)
    const safePath = path.join(outNew, fp.page.path)
    await fs.mkdir(path.dirname(safePath), { recursive: true })
    await fs.writeFile(safePath, renderFile(fp.page, fp.body), 'utf8')
  }

  // Per-module pages
  for (const [id, m] of modules) {
    const mp = buildModulePage(m, files, filePagePaths, cfg)
    moduleTokens.set(id, mp.tokens)
    const safePath = path.join(outNew, 'modules', `${id}.md`)
    await fs.mkdir(path.dirname(safePath), { recursive: true })
    await fs.writeFile(safePath, renderModule(mp.page, mp.body), 'utf8')
  }

  // INDEX
  const index = buildIndexPage(meta, modules, pagePathMap(modules, files, filePagePaths), moduleTokens, [], cfg)
  await writeText(outNew, 'INDEX.md', renderIndex(index.page, index.body))

  // .meta.json + .index.json
  meta.durationMs = Date.now() - t0
  meta.updatedAt = new Date().toISOString()
  await writeJson(path.join(outNew, '.meta.json'), meta)
  const tree: IndexTree = buildIndexTree(files, modules, filePagePaths, moduleTokens)
  await writeJson(path.join(outNew, '.index.json'), tree)

  // Atomic swap
  await replaceDir(outAbs, outNew)

  log_.info(
    { files: files.length, modules: visibleModuleCount, durationMs: meta.durationMs },
    'build complete',
  )

  return {
    meta,
    root,
    outDir: outRel,
    durationMs: meta.durationMs,
    fileCount: files.length,
    moduleCount: visibleModuleCount,
    symbolCount,
  }
}

function pagePathMap(
  modules: Map<string, ModuleInfo>,
  files: FileIndex[],
  filePagePaths: Map<string, string>,
): Map<string, string> {
  // Returns repoPath → module-page path. (M2 will tighten.)
  void modules
  void files
  return filePagePaths
}

function buildIndexTree(
  files: FileIndex[],
  modules: Map<string, ModuleInfo>,
  filePagePaths: Map<string, string>,
  moduleTokens: Map<string, number>,
): IndexTree {
  const tree: IndexTree = {
    schemaVersion: SCHEMA_VERSION,
    modules: [...modules.entries()]
      .filter(([id]) => id !== '_tests')
      .map(([id, m]) => ({
        id,
        title: m.title,
        path: `modules/${id}.md`,
        files: m.files,
        tokens: moduleTokens.get(id) ?? 0,
      })),
    files: files.map((f) => ({
      path: f.repoPath,
      module: idForRepoPath(f.repoPath, modules),
      kind: 'source' as const,
      language: f.language,
      tokens: estimateFileTokens(f),
      symbols: f.symbols.length,
      stale: false,
      pagePath: filePagePaths.get(f.repoPath) ?? `files/${f.repoPath}.md`,
    })),
    symbols: [],
  }
  return tree
}

function idForRepoPath(repoPath: string, modules: Map<string, ModuleInfo>): string {
  for (const [id, m] of modules) {
    if (m.files.includes(repoPath)) return id
  }
  return '_root'
}

function estimateFileTokens(f: FileIndex): number {
  // Rough heuristic: ~4 chars per token.
  return Math.max(50, Math.round(f.size / 4))
}

function makeStaticFileSummary(content: string, repoPath: string): string {
  const fname = repoPath.split('/').pop() ?? repoPath
  const lines = content.split(/\r?\n/)
  let firstNonBlank = ''
  for (const ln of lines) {
    const t = ln.trim()
    if (t && !t.startsWith('//') && !t.startsWith('#') && !t.startsWith('/*') && !t.startsWith('*')) {
      firstNonBlank = t
      break
    }
  }
  const lc = lines.length
  return `${fname}: ${lc} lines.${firstNonBlank ? ` Starts with: ${firstNonBlank.slice(0, 120)}` : ''}`
}

async function writeText(outDir: string, relPath: string, content: string): Promise<void> {
  await atomicWriteText(path.join(outDir, relPath), content)
}

async function replaceDir(target: string, replacement: string): Promise<void> {
  if (await exists(target)) {
    await fs.rm(target, { recursive: true, force: true })
  }
  await fs.rename(replacement, target)
}
