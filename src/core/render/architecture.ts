import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { CodeWikiConfig } from '../config.js'
import type { FileIndex, ImportEdge, ModuleInfo, WikiMeta } from '../types.js'
import { groupModules, moduleForFile } from '../modules.js'

export interface ArchitecturePageData {
  meta: WikiMeta
  modules: Array<{
    id: string
    title: string
    fileCount: number
    purpose: string
    pagePath: string
    importsCount: number
    dependentsCount: number
  }>
}

/**
 * Build the architecture overview — highest-level page the model reads first
 * when entering a new module or repo.
 *
 * M8: the module map now includes inter-module import edges, capped at
 * `cfg.budgets.mermaidNodes` so the system prompt stays bounded.
 */
export function buildArchitecturePage(
  meta: WikiMeta,
  files: FileIndex[],
  cfg: CodeWikiConfig,
  importEdges: ImportEdge[] = [],
  dependents: Record<string, string[]> = {},
): { page: WikiPage<ArchitecturePageData>; body: string; tokens: number } {
  const modules = groupModules(files, cfg)
  const lines: string[] = []
  lines.push('# Architecture')
  lines.push('')
  lines.push(
    `> ${meta.fileCount} files, ${meta.moduleCount} modules, ${meta.symbolCount} symbols.`,
  )
  lines.push('')

  const visible = [...modules.entries()]
    .filter(([id]) => !cfg.modules.ignore.includes(id))
    .sort(([a], [b]) => (a < b ? -1 : 1))

  if (visible.length > 0) {
    // Module-level imports: collapse per-file imports into per-source/target module edges.
    const moduleEdges = new Map<string, number>() // key: from|to -> count
    for (const e of importEdges) {
      const fromMod = moduleForFile(e.from, cfg)
      const toMod = moduleForFile(e.to, cfg)
      if (fromMod === toMod) continue
      if (!visible.find(([id]) => id === fromMod)) continue
      if (!visible.find(([id]) => id === toMod)) continue
      const key = `${fromMod}|${toMod}`
      moduleEdges.set(key, (moduleEdges.get(key) ?? 0) + 1)
    }

    lines.push('## Module map')
    lines.push('')
    lines.push('```mermaid')
    lines.push('graph LR')
    const cap = cfg.budgets.mermaidNodes
    const displayedNodes = visible.slice(0, cap)
    for (const [id, m] of displayedNodes) {
      lines.push(`  ${diagramId(id)}["${m.title}"]`)
    }
    if (visible.length > cap) {
      lines.push(`  more["...(${visible.length - cap} more)"]`)
    }
    // Edges — also capped to avoid blowing the cap.
    const edgesArr = [...moduleEdges.entries()].filter(
      ([k]) =>
        displayedNodes.find(([id]) => id === k.split('|')[0]) &&
        displayedNodes.find(([id]) => id === k.split('|')[1]),
    )
    for (const [key, count] of edgesArr.slice(0, cap)) {
      const [from, to] = key.split('|')
      lines.push(`  ${diagramId(from!)} -->|${count} edge${count === 1 ? '' : 'es'}| ${diagramId(to!)}`)
    }
    lines.push('```')
    lines.push('')
  }

  lines.push('## Modules')
  lines.push('')
  lines.push(
    '| Module | Files | Public surface | Imports | Imported by |',
  )
  lines.push('| --- | --- | --- | --- | --- |')
  for (const [id, m] of visible) {
    const purpose =
      m.publicSurface.length > 0
        ? `\`${m.publicSurface.slice(0, 3).join('`, `')}\`...`
        : '_Internal-only_'
    const outCount = countOutgoing(importEdges, files, cfg, id)
    const inCount = countIncoming(dependents, files, cfg, id)
    lines.push(
      `| [${m.title}](./modules/${id}.md) | ${m.files.length} | ${purpose} | ${outCount} | ${inCount} |`,
    )
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
      importsCount: countOutgoing(importEdges, files, cfg, id),
      dependentsCount: countIncoming(dependents, files, cfg, id),
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

function countOutgoing(
  edges: ImportEdge[],
  _files: FileIndex[],
  cfg: CodeWikiConfig,
  moduleId: string,
): number {
  let n = 0
  const seen = new Set<string>()
  for (const e of edges) {
    const fromMod = moduleForFile(e.from, cfg)
    if (fromMod !== moduleId) continue
    const toMod = moduleForFile(e.to, cfg)
    const key = `${fromMod}|${toMod}`
    if (!seen.has(key)) {
      seen.add(key)
      n++
    }
  }
  return n
}

function countIncoming(
  dependents: Record<string, string[]>,
  _files: FileIndex[],
  cfg: CodeWikiConfig,
  moduleId: string,
): number {
  // Sum unique modules that import any file in this module.
  const counts = new Set<string>()
  for (const t of Object.keys(dependents)) {
    const tgt = moduleForFile(t, cfg)
    if (tgt === moduleId) {
      for (const d of dependents[t] ?? []) counts.add(moduleForFile(d, cfg))
    }
  }
  return counts.size
}
