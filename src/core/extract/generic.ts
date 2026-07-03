import { Parser, Query, type Language, type Node } from 'web-tree-sitter'
import type { Symbol, SymbolKind } from '../types.js'

/**
 * Generic tree-sitter walker used by every language extractor.
 *
 * The extractor's contract: every language contributes a `.scm` query that
 * uses the convention `(@def.<kind>.name)` for the name node and
 * `(@def.<kind>)` for the full symbol node. The helper walks matches, joins
 * the two captures by `node.id`, then lets a per-language `extractSymbol`
 * function convert the matched node + name into a Symbol.
 */

export interface RawMatch {
  fullNode: Node
  nameNode: Node
  kindName: string // 'function' | 'class' | ...
  source: string
  repoPath: string
}

export interface SymbolBuilder {
  /** Map the captured kind name to the SymbolKind emitted in the wiki. */
  kindOf(name: string): SymbolKind | null
  /** Build a Symbol from one captured (fullNode, name) pair. */
  build(raw: RawMatch): Symbol | null
}

const NAME_RE = /^def\.([\w]+)\.name$/
const FULL_RE = /^def\.([\w]+)$/

export async function runGenericExtract(opts: {
  source: string
  language: Language
  query: string
  builder: SymbolBuilder
  repoPath: string
}): Promise<Symbol[]> {
  const { source, language, query, builder, repoPath } = opts

  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  if (!tree) return []

  const q = new Query(language, query)
  const matches = q.matches(tree.rootNode)

  const seen = new Set<number>()
  const out: Symbol[] = []
  for (const m of matches) {
    let fullNode: Node | null = null
    let nameNode: Node | null = null
    let kindName: string | null = null

    for (const cap of m.captures) {
      if (FULL_RE.test(cap.name)) {
        fullNode = cap.node
        kindName = cap.name.slice(4) // 'def.<kind>'
      } else if (NAME_RE.test(cap.name)) {
        nameNode = cap.node
      }
    }
    // Some languages (Go `type_declaration`) only declare @def.type with no
    // .name capture — the builder pulls the name from text instead.
    if (!fullNode || !kindName) continue
    if (seen.has(fullNode.id)) continue
    seen.add(fullNode.id)

    const symbolKind = builder.kindOf(kindName)
    if (!symbolKind) continue

    const raw: RawMatch = {
      fullNode,
      nameNode: nameNode ?? fullNode,
      kindName,
      source,
      repoPath,
    }
    const sym = builder.build(raw)
    if (sym) out.push(sym)
  }
  return out
}

/** Read the source text for a span, trimmed to signature length. */
export function makeSignature(source: string, node: Node, max = 400): string {
  const slice = source
    .slice(node.startIndex, Math.min(node.endIndex, node.startIndex + max))
  // collapse newlines + extra whitespace into one readable summary
  return slice
    .split('\n')
    .slice(0, 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findDocstringAbove(source: string, node: Node): string | null {
  // First try ABOVE the node (JSDoc, //, #, /* */, Python """ before).
  const above = findDocstringAboveOnly(source, node)
  if (above) return above

  // Then try INSIDE the function/class body (Python docstring lives there).
  const inside = findDocstringInside(source, node)
  return inside
}

function findDocstringAboveOnly(source: string, node: Node): string | null {
  // Walk up to the top-level statement.
  let top: Node | null = node
  while (
    top &&
    top.parent &&
    top.parent.type !== 'program' &&
    top.parent.type !== 'translation_unit' &&
    top.parent.type !== 'source_file' &&
    top.parent.type !== 'module'
  ) {
    top = top.parent
  }
  if (!top) return null

  let windowStart = 0
  let cursor: Node | null = top.previousNamedSibling
  let safety = 16
  while (cursor && safety-- > 0) {
    if (cursor.startIndex > 0) windowStart = cursor.startIndex
    const dist = top.startIndex - windowStart
    if (dist > 4096) break
    cursor = cursor.previousNamedSibling
  }
  const text = source.slice(windowStart, top.startIndex)
  const lines = text.split('\n').slice(-12)

  const jsdoc = /\/\*\*([\s\S]*?)\*\//.exec(text)
  if (jsdoc) {
    const cleaned = jsdoc[1]!.replace(/^\s*\* ?/gm, '').trim()
    if (cleaned) return firstParagraph(cleaned, 400)
  }
  const comment = /\/\*([\s\S]*?)\*\//.exec(text)
  if (comment) {
    const cleaned = comment[1]!.replace(/^\s*\* ?/gm, '').trim()
    if (cleaned) return firstParagraph(cleaned, 400)
  }

  const hashLines: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i] ?? ''
    const m = /^\s*#\s?(.*)$/.exec(ln)
    if (!m) {
      if (hashLines.length > 0) break
      continue
    }
    hashLines.unshift(m[1] ?? '')
  }
  if (hashLines.length > 0) return firstParagraph(hashLines.join(' '), 400)

  const slashLines: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i] ?? ''
    const m = /^\s*\/\/\s?(.*)$/.exec(ln)
    if (!m) {
      if (slashLines.length > 0) break
      continue
    }
    slashLines.unshift(m[1] ?? '')
  }
  if (slashLines.length > 0) return firstParagraph(slashLines.join(' '), 400)

  return null
}

function findDocstringInside(source: string, node: Node): string | null {
  // Walk all children of `node` for the first `string` node — Python
  // convention puts the docstring as the first statement in a function/class
  // body. Cap depth to avoid descending into nested function bodies.
  function visit(n: Node, depth: number): string | null {
    if (n.type === 'string') {
      const text = source.slice(n.startIndex, n.endIndex).trim()
      const cleaned = text.replace(/^(['"]{3}|['"])|(['"]{3}|['"])$/g, '').trim()
      if (cleaned) return firstParagraph(cleaned, 400)
      return null
    }
    if (depth >= 6) return null
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) {
        const found = visit(c, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return visit(node, 0)
}

/**
 * Detect if Ruby `private`/`protected`/`public` keyword precedes the method.
 * Ruby treats a top-level visibility modifier as the modifier for all
 * following defs in the same class/module until another modifier or `end`.
 */
export function isRubyPrivate(source: string, node: Node): boolean {
  // Walk up to the enclosing class/module/program.
  let top: Node | null = node
  while (top && top.parent) {
    const pt = top.parent.type
    if (pt === 'class' || pt === 'module' || pt === 'program' || pt === 'source_file') break
    top = top.parent
  }
  if (!top || !top.parent) return false

  // The class/module start is top.parent.startIndex; class end is top.parent.endIndex.
  const clsStart = top.parent.startIndex
  const clsEnd = top.parent.endIndex
  const classBody = source.slice(clsStart, clsEnd)
  const methodStart = node.startIndex - clsStart
  if (methodStart < 0) return false
  const head = classBody.slice(0, methodStart)

  // Walk lines back from the method until we hit `end`, the class open, or another def.
  const lines = head.split('\n').slice(-30)
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = (lines[i] ?? '').trim()
    if (ln === '' || ln === 'end') continue
    if (ln.startsWith('def ') || ln.startsWith('class ') || ln.startsWith('module ')) return false
    if (ln === 'private' || ln === 'protected' || ln.startsWith('private ') || ln.startsWith('protected ')) {
      return true
    }
    return false
  }
  return false
}

function firstParagraph(text: string, max: number): string {
  const idx = text.indexOf('\n\n')
  const first = idx >= 0 ? text.slice(0, idx) : text
  return first.length > max ? `${first.slice(0, max)}…` : first
}

/** Cheap cyclomatic complexity approximation. */
export function approxComplexity(node: Node): number {
  let count = 1
  walk(node, (n) => {
    switch (n.type) {
      case 'if_statement':
      case 'elif_clause':
      case 'else_clause':
      case 'for_statement':
      case 'for_in_statement':
      case 'while_statement':
      case 'do_statement':
      case 'case_clause':
      case 'switch_case':
      case 'catch_clause':
        count++
        break
    }
  })
  return count
}

function walk(node: Node, fn: (n: Node) => void): void {
  fn(node)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c) walk(c, fn)
  }
}

/** Build a Symbol.id from {repoPath, kind, name}. */
export function makeSymbolId(repoPath: string, kind: SymbolKind, name: string): string {
  return `${repoPath}::${kind}.${name}`
}
