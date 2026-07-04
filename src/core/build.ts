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
import type {
  FileIndex,
  ImportEdge,
  IndexTree,
  Language,
  ModuleInfo,
  Symbol,
  WikiMeta,
} from './types.js'
import { SCHEMA_VERSION } from './types.js'
import { extractSymbols, isExtractable } from './extract/index.js'
import { buildSymbolPage, renderSymbol } from './render/symbol-page.js'
import { computeDependents, extractImports } from './graph/imports.js'

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

  // 2. Build FileIndex entries — with tree-sitter extraction for supported langs.
  const files: FileIndex[] = []
  const languages = new Set<Language>()

  for (const w of walked) {
    if (w.repoPath.startsWith('.codewiki/') || w.repoPath.startsWith('.git/')) continue
    if (!w.language) continue
    languages.add(w.language)

    let content = ''
    try {
      content = await fs.readFile(w.absPath, 'utf8')
    } catch (err) {
      log_.debug({ path: w.repoPath, err: String(err) }, 'failed to read')
      continue
    }
    const hash = sha256Hex(content)

    // Extract symbols via tree-sitter (M2: TS/JS family; M3 adds more langs).
    let symbols: Symbol[] = []
    if (isExtractable(w.language)) {
      try {
        symbols = await extractSymbols({
          source: content,
          repoPath: w.repoPath,
          language: w.language,
        })
      } catch (err) {
        log_.debug({ path: w.repoPath, err: String(err) }, 'extractor failed')
        symbols = []
      }
    }

    const publicSymbols = symbols.filter((s) => s.visibility === 'public')
    const summary = makeStaticFileSummary(content, w.repoPath, symbols, publicSymbols)

    files.push({
      repoPath: w.repoPath,
      absPath: w.absPath,
      language: w.language,
      size: w.size,
      mtimeMs: w.mtimeMs,
      contentHash: hash,
      symbols,
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

  // M4/M8: extract imports + dependents first so architecture + module pages
  // can render dependency diagrams inline. We re-read each file here rather
  // than threading source through the loop. Cost: ~µs per file, dominated by
  // the tree-sitter extraction that already ran.
  const importEdges: ImportEdge[] = []
  for (const f of files) {
    if (!f.language) continue
    let content = ''
    try {
      content = await fs.readFile(f.absPath, 'utf8')
    } catch {
      continue
    }
    const edges = await extractImports(content, f.repoPath, f.language)
    importEdges.push(...edges)
  }
  const dependents = computeDependents(importEdges)

  const arch = buildArchitecturePage(meta, files, cfg, importEdges, dependents)
  await writeText(outNew, 'architecture.md', renderArchitecture(arch.page, arch.body))

  // Per-file pages AND per-symbol pages (M2: TS/JS family extracted symbols).
  for (const f of files) {
    const fp = buildFilePage(f)
    filePagePaths.set(f.repoPath, fp.page.path)
    const safePath = path.join(outNew, fp.page.path)
    await fs.mkdir(path.dirname(safePath), { recursive: true })
    await fs.writeFile(safePath, renderFile(fp.page, fp.body), 'utf8')

    for (const s of f.symbols) {
      const sp = buildSymbolPage(s, f.repoPath)
      const symPath = path.join(outNew, sp.page.path)
      await fs.mkdir(path.dirname(symPath), { recursive: true })
      await fs.writeFile(symPath, renderSymbol(sp.page, sp.body), 'utf8')
    }
  }

  // Per-module pages (M8: passes import edges + dependents for dep diagram).
  for (const [id, m] of modules) {
    const mp = buildModulePage(m, files, filePagePaths, cfg, importEdges, dependents)
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

  // Graph already extracted above; just persist the artifact here.
  await writeJson(path.join(outNew, '.graph.json'), {
    schemaVersion: SCHEMA_VERSION,
    imports: importEdges,
    calls: [],
    dependents,
  })

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
    symbols: files.flatMap((f) =>
      f.symbols.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        file: f.repoPath,
        lineRange: s.lineRange,
        pagePath: `symbols/${f.repoPath}/${s.kind}.${s.name}.md`,
        tokens: 150,
      })),
    ),
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

function makeStaticFileSummary(
  content: string,
  repoPath: string,
  symbols: Symbol[] = [],
  publicSymbols: Symbol[] = [],
): string {
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
  const parts: string[] = [`${lc} lines`]
  if (symbols.length > 0) {
    parts.push(`${symbols.length} symbols (${publicSymbols.length} public)`)
  }
  if (firstNonBlank) parts.push(`starts: \`${firstNonBlank.slice(0, 80)}\``)
  return `${fname}: ${parts.join(', ')}.`
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
