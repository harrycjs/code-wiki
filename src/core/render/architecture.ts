import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { CodeWikiConfig } from '../config.js'
import type { FileIndex, ModuleInfo, WikiMeta } from '../types.js'
import { groupModules } from '../modules.js'

export interface ArchitecturePageData {
  meta: WikiMeta
  modules: Array<{
    id: string
    title: string
    fileCount: number
    purpose: string
    pagePath: string
  }>
}

/**
 * Build the architecture overview — highest-level page the model reads first
 * when entering a new module or repo.
 */
export function buildArchitecturePage(
  meta: WikiMeta,
  files: FileIndex[],
  cfg: CodeWikiConfig,
): { page: WikiPage<ArchitecturePageData>; body: string; tokens: number } {
  const modules = groupModules(files, cfg)
  const lines: string[] = []
  lines.push('# Architecture')
  lines.push('')
  lines.push(
    `> ${meta.fileCount} files, ${meta.moduleCount} modules, ${meta.symbolCount} symbols.`,
  )
  lines.push('')

  // Drop ignored modules for diagram purposes.
  const visible = [...modules.entries()]
    .filter(([id]) => !cfg.modules.ignore.includes(id))
    .sort(([a], [b]) => (a < b ? -1 : 1))

  if (visible.length > 0) {
    lines.push('## Module map')
    lines.push('')
    lines.push('```mermaid')
    lines.push('graph LR')
    for (const [id, m] of visible.slice(0, cfg.budgets.mermaidNodes)) {
      const nodeId = diagramId(id)
      lines.push(`  ${nodeId}["${m.title}"]`)
    }
    if (visible.length > cfg.budgets.mermaidNodes) {
      lines.push(`  more["... (${visible.length - cfg.budgets.mermaidNodes} more)"]`)
    }
    lines.push('```')
    lines.push('')
  }

  lines.push('## Modules')
  lines.push('')
  lines.push('| Module | Files | One-line purpose |')
  lines.push('| --- | --- | --- |')
  for (const [id, m] of visible) {
    const purpose =
      m.publicSurface.length > 0
        ? `Public surface: \`${m.publicSurface.slice(0, 3).join('`, `')}\`...`
        : '_Internal-only module._'
    lines.push(`| [${m.title}](./modules/${id}.md) | ${m.files.length} | ${purpose} |`)
  }
  lines.push('')

  const body = lines.join('\n')
  const tokens = pageStats(body)
  const data: ArchitecturePageData = {
    meta,
    modules: visible.map(([id, m]) => ({
      id,
      title: m.title,
      fileCount: m.files.length,
      purpose:
        m.publicSurface.length > 0
          ? `Public: ${m.publicSurface.slice(0, 3).join(', ')}...`
          : 'Internal-only',
      pagePath: `modules/${id}.md`,
    })),
  }
  const page = makePage<ArchitecturePageData>(
    'architecture',
    'architecture',
    'Architecture',
    'architecture.md',
    data,
    undefined,
    false,
  )
  page.tokens = tokens
  return { page, body, tokens }
}

export function renderArchitecture(
  page: WikiPage<ArchitecturePageData>,
  body: string,
): string {
  return frontmatter(page) + body
}

function diagramId(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '_').replace(/^(\d)/, '_$1')
}
