import { type WikiPage, makePage, pageStats, frontmatter } from '../render.js'
import type { Symbol } from '../types.js'

export interface SymbolPageData {
  symbol: Symbol
  fileRepoPath: string
}

/**
 * Build a per-symbol markdown page. Pages are tiny (~50-150 tokens each) so
 * the model can drill without breaking the bank.
 */
export function buildSymbolPage(symbol: Symbol, fileRepoPath: string): {
  page: WikiPage<SymbolPageData>
  body: string
  tokens: number
} {
  const lines: string[] = []
  lines.push(`# ${symbol.kind}: \`${symbol.name}\``)
  lines.push('')
  lines.push(
    `> Defined in \`${fileRepoPath}\`, lines ${symbol.lineRange[0]}-${symbol.lineRange[1]}.`,
  )
  lines.push('')
  lines.push('## Signature')
  lines.push('')
  lines.push('```' + inferLang(fileRepoPath))
  lines.push(symbol.signature || symbol.name)
  lines.push('```')
  lines.push('')
  if (symbol.docstring) {
    lines.push('## Description')
    lines.push('')
    lines.push(symbol.docstring)
    lines.push('')
  }
  lines.push('## Metadata')
  lines.push('')
  lines.push(`- **Visibility**: ${symbol.visibility}`)
  lines.push(`- **Complexity**: ${symbol.complexity}`)
  lines.push('')

  const body = lines.join('\n')
  const tokens = pageStats(body)

  const pagePath = `symbols/${fileRepoPath}/${symbol.kind}.${symbol.name}.md`
  const data: SymbolPageData = { symbol, fileRepoPath }
  const page = makePage<SymbolPageData>(
    'symbol',
    symbol.id,
    symbol.name,
    pagePath,
    data,
    {
      repoPath: fileRepoPath,
      language: null,
      module: null,
      lineRange: symbol.lineRange,
      symbol: symbol.name,
      symbolKind: symbol.kind,
      signature: symbol.signature,
    },
    false,
  )
  page.tokens = tokens
  return { page, body, tokens }
}

export function renderSymbol(page: WikiPage<SymbolPageData>, body: string): string {
  return frontmatter(page) + body
}

function inferLang(path: string): string {
  const ext = path.split('.').pop() ?? ''
  if (ext === 'ts' || ext === 'tsx') return 'typescript'
  if (ext === 'js' || ext === 'jsx') return 'javascript'
  if (ext === 'py') return 'python'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rust'
  if (ext === 'java') return 'java'
  if (ext === 'rb') return 'ruby'
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') return 'cpp'
  if (ext === 'c' || ext === 'h') return 'c'
  if (ext === 'hpp' || ext === 'hh') return 'cpp'
  return ''
}
