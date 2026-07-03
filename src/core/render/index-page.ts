import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { CodeWikiConfig } from '../config.js'
import type { FileIndex, IndexTree, ModuleInfo, WikiMeta } from '../types.js'

export interface IndexPageData {
  meta: WikiMeta
  modules: Array<ModuleInfo & { pagePath: string; tokens: number }>
  recentlyChanged: string[]
}

/**
 * Build the top-level INDEX.md — the entry point the model reads first.
 */
export function buildIndexPage(
  meta: WikiMeta,
  modules: Map<string, ModuleInfo>,
  modulePagePaths: Map<string, string>,
  moduleTokens: Map<string, number>,
  recent: string[],
  cfg: CodeWikiConfig,
): { page: WikiPage<IndexPageData>; body: string; tokens: number } {
  const modList = [...modules.entries()]
    .filter(([id]) => !cfg.modules.ignore.includes(id))
    .map(([id, m]) => ({
      ...m,
      pagePath: modulePagePaths.get(id) ?? `modules/${id}.md`,
      tokens: moduleTokens.get(id) ?? 0,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))

  const data: IndexPageData = {
    meta,
    modules: modList,
    recentlyChanged: recent,
  }

  const lines: string[] = []
  lines.push('# Code Index')
  lines.push('')
  lines.push(
    `> ${meta.fileCount} files across ${meta.moduleCount} modules. Generated ${meta.updatedAt}.`,
  )
  lines.push('')
  lines.push('## Modules')
  lines.push('')
  for (const m of modList) {
    lines.push(`- [${m.title}](./${m.pagePath}) — ${m.files.length} files, ~${m.tokens} tokens`)
  }
  if (recent.length > 0) {
    lines.push('')
    lines.push('## Recently changed')
    lines.push('')
    for (const p of recent) lines.push(`- \`${p}\``)
  }
  lines.push('')
  lines.push('## Search hints')
  lines.push('')
  lines.push('- Use `/wiki-search <query>` or the `wiki_search` MCP tool.')
  lines.push('- Use `/wiki-symbol <path>:<name>` to drill into one symbol.')
  lines.push('- Use `/wiki-architecture` for the system view (and a Mermaid diagram).')
  lines.push('')

  const body = lines.join('\n')
  const tokens = pageStats(body)
  const page = makePage<IndexPageData>(
    'index',
    'index',
    'Code Index',
    'INDEX.md',
    data,
    undefined,
    false,
  )
  page.tokens = tokens
  return { page, body, tokens }
}

export function renderIndex(page: WikiPage<IndexPageData>, body: string): string {
  return frontmatter(page) + body
}

export function emptyIndexTree(): IndexTree {
  return {
    schemaVersion: 1,
    modules: [],
    files: [],
    symbols: [],
  }
}
