import path from 'node:path'
import { Parser, type Language as TSLanguage, type Node } from 'web-tree-sitter'
import type { ImportEdge, Language } from '../types.js'
import { getLanguage } from '../extract/loader.js'
import { toPosix } from '../../shared/fs.js'

/**
 * Import-graph extraction via direct AST traversal.
 *
 * Different tree-sitter grammars use different node-type conventions for
 * imports and field naming isn't standardized. Rather than maintain 10
 * queries with their edge cases, we walk the tree for each language and
 * look for known import-related nodes by type.
 */

/** Map from language to AST-walker that returns `[{ source, specifiers }]`. */
type AstImportWalker = (
  root: Node,
  sourceText: string,
) => Array<{ source: string; specifiers: string[]; row: number }>

const WALKERS: Partial<Record<Language, AstImportWalker>> = {
  typescript: tsLike,
  tsx: tsLike,
  javascript: tsLike,
  jsx: tsLike,
  python: pyWalker,
  go: goWalker,
  rust: rustWalker,
  java: javaWalker,
  c: cppLike,
  cpp: cppLike,
  ruby: rubyWalker,
}

const TS_IMPORT_TYPES = new Set(['import_statement', 'export_statement'])

function tsLike(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  walk(root, (n) => {
    if (!TS_IMPORT_TYPES.has(n.type)) return
    let srcText = ''
    let depthOfString = -1
    const specs: string[] = []

    const visit = (m: Node, depth: number) => {
      if (!m) return
      if (depth > 4) return
      if (m.type === 'string') {
        // Take only the FIRST string at depth <= 1 — that's the import source;
        // anything deeper is inside a call argument / type annotation.
        if (srcText === '' && depth <= 2) {
          srcText = source.slice(m.startIndex, m.endIndex).trim()
          depthOfString = depth
        }
      }
      if (m.type === 'import_specifier' || m.type === 'export_specifier') {
        const name = findFirstNamedChildText(m, ['identifier', 'type_identifier'], source)
        if (name) specs.push(name)
      }
      for (let i = 0; i < m.childCount; i++) {
        visit(m.child(i)!, depth + 1)
      }
    }
    visit(n, 0)

    if (!srcText) return
    void depthOfString
    out.push({ source: srcText, specifiers: specs, row: n.startPosition.row })
  })
  return out
}

function pyWalker(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  walk(root, (n) => {
    if (n.type === 'import_statement') {
      const srcText = findFirstNamedChildText(n, ['dotted_name'], source)
      if (srcText) out.push({ source: srcText, specifiers: [], row: n.startPosition.row })
    } else if (n.type === 'import_from_statement') {
      // The middle child of `from X import Y, Z` is X (dotted_name | relative_import).
      let srcText = ''
      const specs: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === 'dotted_name' && !srcText) {
          // Could be the module name or an imported name; we walk in order.
          srcText = source.slice(c.startIndex, c.endIndex).trim()
        } else if (c.type === 'relative_import') {
          srcText = source.slice(c.startIndex, c.endIndex).trim()
        } else if (c.type === 'dotted_name' && srcText) {
          // Subsequent dotted_names after the import keyword are imported names.
          specs.push(source.slice(c.startIndex, c.endIndex).trim())
        } else if (c.type === 'aliased_import') {
          const name = findFirstNamedChildText(c, ['dotted_name'], source)
          if (name) specs.push(name)
        }
      }
      if (!srcText) {
        // Fallback: regex over the line.
        const text = source.slice(n.startIndex, n.endIndex)
        const m = /^from\s+(\S+)/.exec(text)
        if (m) srcText = m[1] ?? ''
      }
      if (!srcText) return
      out.push({ source: srcText, specifiers: specs, row: n.startPosition.row })
    }
  })
  return out
}

function goWalker(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  walk(root, (n) => {
    if (n.type !== 'import_spec') return
    // path: (interpreted_string_literal); optional name: (identifier | dot)
    let srcText = ''
    const specs: string[] = []
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (c.type === 'interpreted_string_literal') {
        srcText = source.slice(c.startIndex, c.endIndex).trim()
      } else if (c.type === 'identifier' || c.type === 'dot') {
        specs.push(source.slice(c.startIndex, c.endIndex).trim())
      }
    }
    if (!srcText) return
    out.push({ source: srcText, specifiers: specs, row: n.startPosition.row })
  })
  return out
}

function rustWalker(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  walk(root, (n) => {
    if (n.type !== 'use_declaration') return
    const text = source.slice(n.startIndex, n.endIndex)
    // Quick parse: `use X::Y::Z;`, `use X::{Y, Z};`, `use X as Y;`
    const m = /^use\s+([^;{]+?)\s*(::\s*\{([^}]+)\})?\s*;/.exec(text)
    if (!m) return
    const head = m[1]?.trim() ?? ''
    const group = m[3]?.trim()
    if (group) {
      const parts = group.split(',').map((s) => s.trim()).filter(Boolean)
      out.push({ source: head, specifiers: parts, row: n.startPosition.row })
    } else {
      out.push({ source: head, specifiers: [], row: n.startPosition.row })
    }
  })
  return out
}

function javaWalker(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  walk(root, (n) => {
    if (n.type !== 'import_declaration') return
    const text = source.slice(n.startIndex, n.endIndex)
    const m = /^import\s+(?:static\s+)?([\w.]+)/.exec(text)
    if (!m) return
    const lastDot = m[1]!.lastIndexOf('.')
    const head = lastDot >= 0 ? m[1]!.slice(0, lastDot) : ''
    const tail = lastDot >= 0 ? m[1]!.slice(lastDot + 1) : m[1]!
    const srcText = head ? `${head}.${tail}` : (m[1] ?? '')
    out.push({
      source: srcText,
      specifiers: tail ? [tail] : [],
      row: n.startPosition.row,
    })
  })
  return out
}

function cppLike(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  walk(root, (n) => {
    if (n.type !== 'preproc_include') return
    const text = source.slice(n.startIndex, n.endIndex)
    const m = /#\s*include\s+([<"])([^>"]+)[>"]/.exec(text)
    if (!m) return
    const delim = m[1]
    if (delim === '<') return // skip system headers
    const srcText = m[2] ?? ''
    out.push({ source: srcText, specifiers: [], row: n.startPosition.row })
  })
  return out
}

function rubyWalker(root: Node, source: string) {
  const out: Array<{ source: string; specifiers: string[]; row: number }> = []
  const IMPORT_METHODS = new Set(['require', 'require_relative', 'load'])
  walk(root, (n) => {
    if (n.type !== 'call') return
    let methodName = ''
    let strText = ''
    const visit = (m: Node) => {
      if (m.type === 'identifier' && !methodName) {
        methodName = source.slice(m.startIndex, m.endIndex)
      } else if (m.type === 'string') {
        strText = source.slice(m.startIndex, m.endIndex).trim()
      }
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c) visit(c)
      }
    }
    visit(n)
    if (!IMPORT_METHODS.has(methodName)) return
    if (!strText) return
    out.push({ source: strText, specifiers: [], row: n.startPosition.row })
  })
  return out
}

/** Recursive walk. */
function walk(node: Node, fn: (n: Node) => void) {
  fn(node)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c) walk(c, fn)
  }
}

function findFirstNamedChildText(node: Node, want: string[], source: string): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && want.includes(c.type)) {
      return source.slice(c.startIndex, c.endIndex).trim()
    }
  }
  return null
}

/**
 * Parse the file and return the per-language walker output.
 */
export async function extractImports(
  source: string,
  repoPath: string,
  lang: Language,
): Promise<ImportEdge[]> {
  const languageObj = await getLanguage(lang)
  if (!languageObj) return []
  const walker = WALKERS[lang]
  if (!walker) return []

  const parser = new Parser()
  parser.setLanguage(languageObj)
  const tree = parser.parse(source)
  if (!tree) return []

  const hits = walker(tree.rootNode, source)
  const edges: ImportEdge[] = []
  const seen = new Set<string>()

  for (const hit of hits) {
    const rawSource = stripQuotes(hit.source.trim())
    const target = resolveImport(repoPath, rawSource, lang)
    if (!target) continue

    const key = `${repoPath}->${target}|${hit.specifiers.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)

    edges.push({ from: repoPath, to: target, specifiers: hit.specifiers })
  }

  return edges
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function resolveImport(importerRepoPath: string, rawSource: string, lang: Language): string | null {
  if (!rawSource) return null
  if (lang === 'python') {
    if (rawSource.startsWith('.')) return resolveRelative(importerRepoPath, rawSource)
    return rawSource.replace(/\./g, '/')
  }
  if (lang === 'c' || lang === 'cpp') {
    if (rawSource.startsWith('"')) return resolveRelative(importerRepoPath, rawSource.slice(1, -1))
    return null
  }
  if (lang === 'java') {
    return rawSource.replace(/\./g, '/') + '.java'
  }
  if (lang === 'ruby' && rawSource.startsWith('.')) {
    return resolveRelative(importerRepoPath, rawSource)
  }
  if (rawSource.startsWith('.') || rawSource.startsWith('/')) {
    return resolveRelative(importerRepoPath, rawSource)
  }
  return rawSource
}

function resolveRelative(importerRepoPath: string, rel: string): string | null {
  // For Python: leading dots encode parent directory traversal.
  let normalizedRel = rel
  if (/^\.+$/.test(rel) || /^\.+[\w]/.test(rel)) {
    // `.foo` or `..foo` or just `..` — count leading dots and resolve.
    const dots = (rel.match(/^\.+/)?.[0] ?? '').length
    const base = rel.slice(dots)
    const importerDir = path.posix.dirname(importerRepoPath)
    let dir = importerDir
    for (let i = 1; i < dots; i++) {
      const parent = path.posix.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
    if (!base) return toPosix(dir)
    // `from .foo import bar` → within current package's `foo/` module → dir/foo
    normalizedRel = `${dir}/${base}`.replace(/^\.?\//, '')
    return toPosix(normalizedRel)
  }
  const importerDir = path.posix.dirname(importerRepoPath)
  const normalized = path.posix.normalize(path.posix.join(importerDir, rel))
  if (normalized.startsWith('..') || normalized === '') return null
  return toPosix(normalized)
}

export function computeDependents(edges: ImportEdge[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const e of edges) {
    const list = map[e.to] ?? []
    if (!list.includes(e.from)) list.push(e.from)
    map[e.to] = list
  }
  return map
}

export interface GraphFile {
  schemaVersion: 1
  imports: ImportEdge[]
  calls: Array<{ from: string; to: string; line: number }>
  dependents: Record<string, string[]>
}

// Silence unused-import warning when `Language` is only referenced via types.
void (null as unknown as TSLanguage)
