import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { FileIndex } from '../types.js'

export interface FilePageData {
  file: FileIndex
}

/**
 * Build a per-file markdown page: imports, exported symbol index, and (when
 * available) inline symbol pages.
 */
export function buildFilePage(file: FileIndex): {
  page: WikiPage<FilePageData>
  body: string
  tokens: number
} {
  const lines: string[] = []
  lines.push(`# File: ${file.repoPath}`)
  lines.push('')
  if (file.oneLineSummary) lines.push(`> ${file.oneLineSummary}`)
  lines.push('')
  lines.push(`- **Language**: ${file.language ?? 'unknown'}`)
  lines.push(`- **Size**: ${file.size} bytes`)
  lines.push(`- **Symbols**: ${file.symbols.length}`)
  lines.push('')

  if (file.symbols.length > 0) {
    lines.push('## Symbols')
    lines.push('')
    lines.push('| Name | Kind | Lines | Signature |')
    lines.push('| --- | --- | --- | --- |')
    for (const s of file.symbols) {
      const sig = (s.signature || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      lines.push(
        `| ${s.name} | ${s.kind} | ${s.lineRange[0]}-${s.lineRange[1]} | \`${sig.slice(0, 200)}\` |`,
      )
    }
    lines.push('')
  } else {
    lines.push('_No symbols extracted (language not yet supported or file is empty)._')
    lines.push('')
  }

  lines.push('## Notes')
  lines.push('')
  lines.push(
    'This is the static summary. Run `/wiki-enrich` (with `ANTHROPIC_API_KEY` set) for richer prose.',
  )
  lines.push('')

  const body = lines.join('\n')
  const tokens = pageStats(body)
  const pagePath = `files/${file.repoPath}.md`
  const data: FilePageData = { file }
  const page = makePage<FilePageData>(
    'file',
    file.repoPath,
    file.repoPath,
    pagePath,
    data,
    {
      repoPath: file.repoPath,
      language: file.language,
      module: null,
    },
    false,
  )
  page.tokens = tokens
  return { page, body, tokens }
}

export function renderFile(page: WikiPage<FilePageData>, body: string): string {
  return frontmatter(page) + body
}
