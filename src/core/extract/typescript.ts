import { Parser, Query, type Language, type Node } from 'web-tree-sitter'
import type { Symbol, SymbolKind } from '../types.js'
import { getLanguage } from './loader.js'

/**
 * Tree-sitter extraction for TypeScript / TSX / JavaScript / JSX.
 *
 * Captures top-level + nested declarations: function, class, method,
 * interface, type alias, enum. The `kind` is mapped by the capture name.
 *
 * Variables bound to function expressions / arrows are also captured as
 * `function` symbols.
 */

export const TYPESCRIPT_QUERY = `
; top-level function declarations
(function_declaration
  name: (identifier) @def.function.name) @def.function

; exported function declarations
(export_statement
  (function_declaration
    name: (identifier) @def.function.name) @def.function)

; variable-declared functions / arrows
(variable_declaration
  (variable_declarator
    name: (identifier) @def.function.name
    value: [(function_expression) (arrow_function)]) @def.function)

; class declarations
(class_declaration
  name: (type_identifier) @def.class.name) @def.class
(export_statement
  (class_declaration
    name: (type_identifier) @def.class.name) @def.class)

; class members (methods)
(method_definition
  name: (property_identifier) @def.method.name) @def.method

; interfaces
(interface_declaration
  name: (type_identifier) @def.interface.name) @def.interface
(export_statement
  (interface_declaration
    name: (type_identifier) @def.interface.name) @def.interface)

; type aliases
(type_alias_declaration
  name: (type_identifier) @def.type.name) @def.type
(export_statement
  (type_alias_declaration
    name: (type_identifier) @def.type.name) @def.type)

; enums
(enum_declaration
  name: (identifier) @def.enum.name) @def.enum
(export_statement
  (enum_declaration
    name: (identifier) @def.enum.name) @def.enum)
`

const NAME_CAPTURE_RE = /^def\.(\w+)\.name$/
const FULL_CAPTURE_RE = /^def\.(\w+)$/

export interface ExtractOptions {
  /** Source file content. */
  source: string
  /** Tree-sitter Language instance. */
  language: Language
  /** Repo-relative path (for parentId stability). */
  repoPath: string
}

export interface ExtractResult {
  symbols: Symbol[]
}

export async function extractTypeScript(opts: ExtractOptions): Promise<ExtractResult> {
  const { source, language, repoPath } = opts

  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  if (!tree) return { symbols: [] }

  const query = new Query(language, TYPESCRIPT_QUERY)
  const matches = query.matches(tree.rootNode)

  // First pass: build (nodeId -> name, kind) using BOTH @def.X.name and @def.X captures.
  const nameByNodeId = new Map<number, string>()
  const kindByNodeId = new Map<number, SymbolKind>()
  const nodeById = new Map<number, Node>()

  for (const m of matches) {
    let nameText: string | null = null
    let kindName: SymbolKind | null = null
    let fullNode: Node | null = null

    for (const cap of m.captures) {
      nodeById.set(cap.node.id, cap.node)
      if (NAME_CAPTURE_RE.test(cap.name)) {
        nameText = source.slice(cap.node.startIndex, cap.node.endIndex)
        const k = cap.name.replace('def.', '').replace('.name', '')
        kindName = k as SymbolKind
      } else if (FULL_CAPTURE_RE.test(cap.name)) {
        fullNode = cap.node
      }
    }
    if (fullNode && nameText && kindName) {
      nameByNodeId.set(fullNode.id, nameText)
      kindByNodeId.set(fullNode.id, kindName)
    }
  }

  // Second pass: walk matches, emit one Symbol per full-node (de-dupe by id).
  const out: Symbol[] = []
  const seen = new Set<number>()
  for (const m of matches) {
    let fullNode: Node | null = null
    for (const cap of m.captures) {
      nodeById.set(cap.node.id, cap.node)
      if (FULL_CAPTURE_RE.test(cap.name)) {
        fullNode = cap.node
      }
    }
    if (!fullNode) continue
    if (seen.has(fullNode.id)) continue
    seen.add(fullNode.id)

    const name = nameByNodeId.get(fullNode.id)
    const kind = kindByNodeId.get(fullNode.id)
    if (!name || !kind) continue

    const sig = source
      .slice(fullNode.startIndex, Math.min(fullNode.endIndex, fullNode.startIndex + 400))
      .split('\n')
      .slice(0, 2)
      .join(' ')
      .trim()

    const docstring = extractDocstring(source, fullNode)
    const vis = isExported(fullNode) ? 'public' : 'internal'
    const cx = approxComplexity(fullNode)

    // For methods: parentId is the enclosing class.
    let parentId: string | null = null
    if (kind === 'method') {
      let p: Node | null = fullNode.parent
      while (p) {
        if (p.type === 'class_declaration' || p.type === 'class') {
          const pName = nameByNodeId.get(p.id)
          const pKind = kindByNodeId.get(p.id)
          if (pName && pKind === 'class') {
            parentId = buildId(repoPath, 'class', pName)
          }
          break
        }
        p = p.parent
      }
    }

    out.push({
      id: buildId(repoPath, kind, name),
      name,
      kind,
      signature: sig,
      lineRange: [
        fullNode.startPosition.row + 1,
        fullNode.endPosition.row + 1,
      ],
      docstring,
      parentId,
      visibility: vis,
      complexity: cx,
    })
  }

  // Silence unused warning; nodeById is useful for future passing-out extension.
  void nodeById
  return { symbols: out }
}

function buildId(repoPath: string, kind: SymbolKind, name: string): string {
  return `${repoPath}::${kind}.${name}`
}

/**
 * Pull the leading JSDoc block, or the trailing line comments above.
 * Walks the source text directly above the node — robust to tree-sitter
 * node attachment quirks.
 */
function extractDocstring(source: string, node: Node): string | null {
  // Find the row that contains the node start.
  let top: Node | null = node
  while (top && top.parent && top.parent.type !== 'program') {
    top = top.parent
  }
  if (!top) return null

  // Walk back across all preceding nodes at the program level, building a
  // window of source text. Stop after we have ~5 statements OR hit EOF.
  const programRoot = top.parent
  if (!programRoot) return null
  let windowStart = 0
  // For each named sibling preceding `top`, accumulate up to 2KB back.
  const maxWindow = 4096
  let cursor: Node | null = top.previousNamedSibling
  let safety = 16
  while (cursor && safety-- > 0) {
    if (cursor.startIndex > 0) windowStart = cursor.startIndex
    const dist = top.startIndex - windowStart
    if (dist > maxWindow) break
    cursor = cursor.previousNamedSibling
  }

  const window = source.slice(windowStart, top.startIndex)
  // Prefer /** ... */ JSDoc.
  const jsdocMatch = /\/\*\*([\s\S]*?)\*\//.exec(window)
  if (jsdocMatch) {
    const cleaned = jsdocMatch[1]!.replace(/^\s*\* ?/gm, '').trim()
    if (cleaned) return firstParagraph(cleaned, 400)
  }
  // Otherwise collect // leading line comments.
  const lines = window.split('\n').slice(-8)
  const commentLines: string[] = []
  for (const ln of lines.reverse()) {
    const m = /^\s*\/\/\s?(.*)$/.exec(ln)
    if (!m) {
      if (commentLines.length > 0) break
      continue
    }
    commentLines.unshift(m[1] ?? '')
  }
  if (commentLines.length === 0) return null
  return firstParagraph(commentLines.join(' '), 400)
}

function firstParagraph(text: string, max: number): string {
  const idx = text.indexOf('\n\n')
  const first = idx >= 0 ? text.slice(0, idx) : text
  return first.length > max ? `${first.slice(0, max)}…` : first
}

/** True if `node` is an immediate child of an `export_statement`. */
function isExported(node: Node): boolean {
  let p: Node | null = node.parent
  while (p) {
    if (p.type === 'export_statement') return true
    p = p.parent
  }
  return false
}

/** Cheap cyclomatic-complexity approximation. */
function approxComplexity(node: Node): number {
  let count = 1
  walk(node, (n) => {
    if (
      n.type === 'if_statement' ||
      n.type === 'for_statement' ||
      n.type === 'for_in_statement' ||
      n.type === 'while_statement' ||
      n.type === 'do_statement' ||
      n.type === 'case_statement' ||
      n.type === 'catch_clause' ||
      n.type === 'switch_case'
    ) {
      count++
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

export async function extractWithGrammar(
  source: string,
  lang: 'typescript' | 'tsx' | 'javascript' | 'jsx',
  repoPath: string,
): Promise<Symbol[]> {
  const language = await getLanguage(lang)
  if (!language) return []
  const { symbols } = await extractTypeScript({ source, language, repoPath })
  return symbols
}
