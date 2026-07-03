import { type FileIndex, type WikiPage } from './types.js'
import { countTokens } from './tokenize.js'

/**
 * Markdown rendering helpers shared across page kinds.
 *
 * Conventions:
 * - All pages begin with YAML frontmatter the model can grep for.
 * - Page token counts are stored in the frontmatter so the model can self-budget.
 * - Mermaid diagrams use stable node IDs and never exceed N nodes.
 */

export const GENERATOR = `code-wiki`
const VERSION = '0.1.0'

export function frontmatter(page: WikiPage): string {
  const srcBlock = page.source
    ? `\n  source:\n    repoPath: ${yamlStr(page.source.repoPath)}\n    language: ${yamlStr(page.source.language ?? 'null')}\n    module: ${yamlStr(page.source.module ?? 'null')}${
        page.source.lineRange
          ? `\n    lineRange: [${page.source.lineRange[0]}, ${page.source.lineRange[1]}]`
          : ''
      }${page.source.symbol ? `\n    symbol: ${yamlStr(page.source.symbol)}` : ''}${
        page.source.symbolKind ? `\n    symbolKind: ${yamlStr(page.source.symbolKind)}` : ''
      }${page.source.signature ? `\n    signature: ${yamlStr(page.source.signature)}` : ''}`
    : ''

  return [
    '---',
    `kind: ${page.kind}`,
    `id: ${yamlStr(page.id)}`,
    `title: ${yamlStr(page.title)}`,
    `path: ${yamlStr(page.path)}`,
    `tokens: ${page.tokens}`,
    `stale: ${page.stale}`,
    `generatedAt: ${yamlStr(page.generatedAt)}`,
    `generator: ${yamlStr(page.generator)}` + srcBlock,
    '---',
    '',
  ].join('\n')
}

export function yamlStr(s: string | null | undefined): string {
  if (s == null) return 'null'
  // Quote the string and escape any embedded quotes / control chars.
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return `"${escaped}"`
}

export function pageStats(body: string): number {
  return countTokens(body)
}

export function makePage<T>(
  kind: WikiPage['kind'],
  id: string,
  title: string,
  relPath: string,
  data: T,
  source: WikiPage['source'] = undefined,
  stale = false,
): WikiPage<T> {
  return {
    kind,
    id,
    title,
    path: relPath,
    source,
    tokens: 0, // filled in after rendering
    stale,
    generatedAt: new Date().toISOString(),
    generator: `${GENERATOR}/${VERSION}`,
    data,
  }
}

/** Pretty-print one symbol's signature + docstring for a file page. */
export function renderSymbolList(files: FileIndex[]): string {
  if (files.length === 0) return '_No files indexed._'
  const lines: string[] = []
  for (const f of files) {
    lines.push(`### ${f.repoPath}`)
    lines.push('')
    if (f.oneLineSummary) lines.push(`> ${f.oneLineSummary}`)
    if (f.symbols.length === 0) {
      lines.push('_No symbols extracted (unsupported language or empty file)._')
    } else {
      lines.push('')
      lines.push('| Symbol | Kind | Lines | Signature |')
      lines.push('| --- | --- | --- | --- |')
      for (const s of f.symbols) {
        const sig = (s.signature || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
        lines.push(
          `| ${s.name} | ${s.kind} | ${s.lineRange[0]}-${s.lineRange[1]} | \`${sig}\` |`,
        )
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export type { WikiPage, FileIndex } from './types.js'
