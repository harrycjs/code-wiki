import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { CodeWikiConfig } from '../config.js'
import type { FileIndex, ImportEdge, ModuleInfo } from '../types.js'
import { moduleForFile } from '../modules.js'

export interface ModulePageData {
  module: ModuleInfo
  files: Array<{
    repoPath: string
    oneLineSummary: string
    pagePath: string
    symbols: number
  }>
  importsCount: number
  dependentsCount: number
}

/**
 * Build a per-module markdown page: module purpose, file list with summaries,
 * public surface, plus an M8 dependency mini-diagram.
 */
export function buildModulePage(
  module: ModuleInfo,
  files: FileIndex[],
  filePagePaths: Map<string, string>,
  cfg: CodeWikiConfig,
  importEdges: ImportEdge[] = [],
  dependents: Record<string, string[]> = {},
): { page: WikiPage<ModulePageData>; body: string; tokens: number } {
  const lines: string[] = []
  lines.push(`# Module: ${module.title}`)
  lines.push('')
  lines.push(
    `> ${module.files.length} files, ${module.publicSurface.length} public symbols.`,
  )
  lines.push('')

  // M8 — dependencies mini-diagram (this module + directly-related ones only).
  const outgoing = new Set<string>()
  for (const e of importEdges) {
    const fromMod = moduleForFile(e.from, cfg)
    if (fromMod === module.id) {
      outgoing.add(moduleForFile(e.to, cfg))
    }
  }
  // Also resolve imports for: moduleForFile maps files -> module; we need the
  // module-level target. Done above.

  const incoming = new Set<string>()
  for (const t of Object.keys(dependents)) {
    const tgtMod = moduleForFile(t, cfg)
    if (tgtMod === module.id) {
      for (const d of dependents[t] ?? []) incoming.add(moduleForFile(d, cfg))
    }
  }

  if (outgoing.size > 0 || incoming.size > 0) {
    lines.push('## Dependencies')
    lines.push('')
    lines.push('```mermaid')
    lines.push('graph LR')
    const selfId = 'this'
    lines.push(`  ${selfId}["${module.title}"]`)
    let i = 0
    for (const m of outgoing) {
      if (m === module.id) continue
      lines.push(`  out${i}["${m}"]`)
      lines.push(`  ${selfId} --> out${i}`)
      i++
    }
    let j = 0
    for (const m of incoming) {
      if (m === module.id) continue
      lines.push(`  in${j}["${m}"]`)
      lines.push(`  in${j} --> ${selfId}`)
      j++
    }
    lines.push('```')
    lines.push('')
  }

  if (module.publicSurface.length > 0) {
    lines.push('## Public surface')
    lines.push('')
    for (const s of module.publicSurface.slice(0, 20)) {
      lines.push(`- \`${s}\``)
    }
    if (module.publicSurface.length > 20) {
      lines.push(`- _(${module.publicSurface.length - 20} more — see \`/wiki-search <id>\` for the rest)_`)
    }
    lines.push('')
  }

  lines.push('## Files')
  lines.push('')
  lines.push('| File | Summary | Symbols |')
  lines.push('| --- | --- | --- |')
  for (const fp of module.files) {
    const f = files.find((x) => x.repoPath === fp)
    if (!f) continue
    const pagePath = filePagePaths.get(fp) ?? `files/${fp}.md`
    const summary = (f.oneLineSummary || '').replace(/\|/g, '\\|').slice(0, 120)
    lines.push(`| [${fp}](./${pagePath}) | ${summary} | ${f.symbols.length} |`)
  }
  lines.push('')

  const body = lines.join('\n')
  const tokens = pageStats(body)

  const data: ModulePageData = {
    module,
    files: module.files
      .map((fp) => {
        const f = files.find((x) => x.repoPath === fp)
        if (!f) return null
        return {
          repoPath: fp,
          oneLineSummary: f.oneLineSummary,
          pagePath: filePagePaths.get(fp) ?? `files/${fp}.md`,
          symbols: f.symbols.length,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    importsCount: outgoing.size,
    dependentsCount: incoming.size,
  }

  const pagePath = `modules/${module.id}.md`
  const page = makePage<ModulePageData>(
    'module',
    module.id,
    module.title,
    pagePath,
    data,
    {
      repoPath: '',
      language: null,
      module: module.id,
    },
    false,
  )
  page.tokens = tokens
  return { page, body, tokens }
}

export function renderModule(page: WikiPage<ModulePageData>, body: string): string {
  return frontmatter(page) + body
}
