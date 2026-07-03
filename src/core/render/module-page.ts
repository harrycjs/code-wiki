import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { CodeWikiConfig } from '../config.js'
import type { FileIndex, ModuleInfo } from '../types.js'

export interface ModulePageData {
  module: ModuleInfo
  files: Array<{
    repoPath: string
    oneLineSummary: string
    pagePath: string
    symbols: number
  }>
}

/**
 * Build a per-module markdown page: module purpose, file list with summaries,
 * public surface, and (when available) a tiny mermaid diagram of internal call edges.
 */
export function buildModulePage(
  module: ModuleInfo,
  files: FileIndex[],
  filePagePaths: Map<string, string>,
  cfg: CodeWikiConfig,
): { page: WikiPage<ModulePageData>; body: string; tokens: number } {
  const lines: string[] = []
  lines.push(`# Module: ${module.title}`)
  lines.push('')
  lines.push(
    `> ${module.files.length} files, ${
      module.publicSurface.length
    } public symbols.`,
  )
  lines.push('')
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
