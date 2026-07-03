import type { Node } from 'web-tree-sitter'
import type { Symbol, SymbolKind } from '../types.js'
import {
  findDocstringAbove,
  isRubyPrivate,
  makeSignature,
  makeSymbolId,
  runGenericExtract,
  approxComplexity,
  type SymbolBuilder,
  type RawMatch,
} from './generic.js'
import { getLanguage } from './loader.js'
import { Parser } from 'web-tree-sitter'

/**
 * M3 language extractors — Python, Go, Rust, Java, C, C++, Ruby.
 *
 * Each follows the same shape: a `.scm` query capturing `(name) @def.X.name
 * (full) @def.X`, then a small SymbolBuilder that maps the kind name + emits
 * Symbol values.
 */

// -----------------------------------------------------------------------
// Python
// -----------------------------------------------------------------------

const PYTHON_QUERY = `
(function_definition
  name: (identifier) @def.function.name) @def.function

(class_definition
  name: (identifier) @def.class.name) @def.class
`

const pythonBuilder: SymbolBuilder = {
  kindOf: (k) => (k === 'function' || k === 'class' ? (k as SymbolKind) : null),
  build: (raw) => buildPublicPython(raw),
}

function buildPublicPython(raw: RawMatch): Symbol | null {
  const name = textOfNode(raw.nameNode, raw.source)
  if (!name) return null
  const kind: SymbolKind = raw.kindName === 'class' ? 'class' : 'function'
  const vis = name.startsWith('_') ? 'internal' : 'public'
  return makeSymbol(raw, kind, name, vis)
}

// -----------------------------------------------------------------------
// Go
// -----------------------------------------------------------------------

const GO_QUERY = `
(function_declaration
  name: (identifier) @def.function.name) @def.function

(method_declaration
  name: (field_identifier) @def.method.name) @def.method

(type_declaration) @def.type
`

const goBuilder: SymbolBuilder = {
  kindOf: (k) => {
    if (k === 'function' || k === 'method') return k as SymbolKind
    if (k === 'type') return 'class' as SymbolKind // Go "type Foo struct/interface" maps to class/interface
    return null
  },
  build: (raw) => {
    const text = textOf(raw.fullNode, raw.source) ?? ''
    const nameMatch = /(?:^|\n)\s*type\s+([A-Za-z_]\w*)/.exec(text)
    const name = nameMatch
      ? nameMatch[1]!
      : textOfNode(raw.nameNode, raw.source)
    if (!name) return null
    const vis = /^[A-Z]/.test(name) ? 'public' : 'internal'

    let kind: SymbolKind = 'type'
    if (raw.kindName === 'function' || raw.kindName === 'method') {
      kind = raw.kindName as SymbolKind
    } else if (/^\s*type\s+\w+\s+struct\b/.test(' ' + text)) {
      kind = 'class'
    } else if (/^\s*type\s+\w+\s+interface\b/.test(' ' + text)) {
      kind = 'interface'
    } else {
      return null // Skip type aliases for now (YAGNI)
    }

    return makeSymbol(raw, kind, name, vis)
  },
}

// -----------------------------------------------------------------------
// Rust
// -----------------------------------------------------------------------

const RUST_QUERY = `
(function_item
  name: (identifier) @def.function.name) @def.function

(struct_item
  name: (type_identifier) @def.class.name) @def.class

(enum_item
  name: (type_identifier) @def.enum.name) @def.enum

(trait_item
  name: (type_identifier) @def.interface.name) @def.interface

(impl_item
  trait: (type_identifier) @def.interface.name) @def.interface
`

const rustBuilder: SymbolBuilder = {
  kindOf: (k) => {
    const m: Record<string, SymbolKind> = {
      function: 'function',
      class: 'class',
      interface: 'interface',
      enum: 'enum',
    }
    return m[k] ?? null
  },
  build: (raw) => {
    const text = textOf(raw.fullNode, raw.source) ?? ''
    const isPublic = /\bpub\s/.test(text)
    const vis = isPublic ? 'public' : 'internal'
    const name = textOf(raw.nameNode, raw.source)
    if (!name) return null
    const map: Record<string, SymbolKind> = {
      function: 'function',
      class: 'class',
      interface: 'interface',
      enum: 'enum',
    }
    return makeSymbol(raw, map[raw.kindName]!, name, vis)
  },
}

// -----------------------------------------------------------------------
// Java
// -----------------------------------------------------------------------

const JAVA_QUERY = `
(method_declaration
  name: (identifier) @def.method.name) @def.method

(class_declaration
  name: (identifier) @def.class.name) @def.class

(interface_declaration
  name: (identifier) @def.interface.name) @def.interface

(enum_declaration
  name: (identifier) @def.enum.name) @def.enum
`

const javaBuilder: SymbolBuilder = {
  kindOf: (k) => {
    const m: Record<string, SymbolKind> = {
      method: 'method',
      class: 'class',
      interface: 'interface',
      enum: 'enum',
    }
    return m[k] ?? null
  },
  build: (raw) => {
    const text = textOf(raw.fullNode, raw.source) ?? ''
    const isPublic = /\bpublic\s/.test(text)
    const vis = isPublic ? 'public' : 'internal'
    const name = textOf(raw.nameNode, raw.source)
    if (!name) return null
    const map: Record<string, SymbolKind> = {
      method: 'method',
      class: 'class',
      interface: 'interface',
      enum: 'enum',
    }
    return makeSymbol(raw, map[raw.kindName]!, name, vis)
  },
}

// -----------------------------------------------------------------------
// C
// -----------------------------------------------------------------------

const C_QUERY = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @def.function.name)) @def.function
`

const cBuilder: SymbolBuilder = {
  kindOf: (k) => (k === 'function' ? 'function' : null),
  build: (raw) => {
    const text = textOf(raw.fullNode, raw.source) ?? ''
    const isStatic = /^static\s/m.test(text)
    const vis = isStatic ? 'internal' : 'public'
    const name = textOf(raw.nameNode, raw.source)
    if (!name) return null
    return makeSymbol(raw, 'function', name, vis)
  },
}

// -----------------------------------------------------------------------
// C++
// -----------------------------------------------------------------------

const CPP_QUERY = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @def.function.name)) @def.function

(function_definition
  declarator: (function_declarator
    declarator: (field_identifier) @def.method.name)) @def.method

(class_specifier
  name: (type_identifier) @def.class.name) @def.class

(struct_specifier
  name: (type_identifier) @def.class.name) @def.class

(class_specifier
  name: (primitive_type) @def.class.name) @def.class
`

const cppBuilder: SymbolBuilder = {
  kindOf: (k) => {
    const m: Record<string, SymbolKind> = {
      function: 'function',
      method: 'method',
      class: 'class',
    }
    return m[k] ?? null
  },
  build: (raw) => {
    const text = textOf(raw.fullNode, raw.source) ?? ''
    // Visibility is tracked via access specifiers; absent defaults to private.
    // Heuristic: scan the recent lines before this node for a "public:" specifier.
    // For simplicity, treat top-level non-static functions as public; class members
    // default to public unless we explicitly see `private:` above. v0.1.0 says
    // method visibility is approximately right ~70% of the time.
    const isStatic = /^static\s/m.test(text)
    const isPrivate = /private\s*:/.test(textOfSlice(raw, 250))
    const vis = isPrivate ? 'internal' : 'public'
    void isStatic
    const name = textOf(raw.nameNode, raw.source)
    if (!name) return null
    const map: Record<string, SymbolKind> = {
      function: 'function',
      method: 'method',
      class: 'class',
    }
    return makeSymbol(raw, map[raw.kindName]!, name, vis)
  },
}

// -----------------------------------------------------------------------
// Ruby
// -----------------------------------------------------------------------

const RUBY_QUERY = `
(method
  name: (identifier) @def.method.name) @def.method

(singleton_method
  name: (identifier) @def.method.name) @def.method

(class
  name: (constant) @def.class.name) @def.class

(module
  name: (constant) @def.module.name) @def.module
`

const rubyBuilder: SymbolBuilder = {
  kindOf: (k) => {
    const m: Record<string, SymbolKind> = {
      method: 'method',
      class: 'class',
      module: 'module',
    }
    return m[k] ?? null
  },
  build: (raw) => {
    const isPrivate = isRubyPrivate(raw.source, raw.fullNode)
    const vis = isPrivate ? 'internal' : 'public'
    const name = textOfNode(raw.nameNode, raw.source)
    if (!name) return null
    const map: Record<string, SymbolKind> = {
      method: 'method',
      class: 'class',
      module: 'module',
    }
    return makeSymbol(raw, map[raw.kindName]!, name, vis)
  },
}

// -----------------------------------------------------------------------
// Dispatch entry
// -----------------------------------------------------------------------

export async function extractOtherLanguage(
  source: string,
  lang: 'python' | 'go' | 'rust' | 'java' | 'c' | 'cpp' | 'ruby',
  repoPath: string,
): Promise<Symbol[]> {
  const language = await getLanguage(lang)
  if (!language) return []

  const spec: Record<typeof lang, { query: string; builder: SymbolBuilder }> = {
    python: { query: PYTHON_QUERY, builder: pythonBuilder },
    go: { query: GO_QUERY, builder: goBuilder },
    rust: { query: RUST_QUERY, builder: rustBuilder },
    java: { query: JAVA_QUERY, builder: javaBuilder },
    c: { query: C_QUERY, builder: cBuilder },
    cpp: { query: CPP_QUERY, builder: cppBuilder },
    ruby: { query: RUBY_QUERY, builder: rubyBuilder },
  }
  const s = spec[lang]
  return runGenericExtract({ source, language, query: s.query, builder: s.builder, repoPath })
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function textOf(node: Node, source: string, kind?: string): string | null {
  if (kind) {
    // Find descendant of `node` whose own type === kind.
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === kind) {
        return source.slice(n.startIndex, n.endIndex).trim()
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    return null
  }
  return source.slice(node.startIndex, node.endIndex).trim()
}

/** Slice source text for a captured name node (the symbol's own identifier). */
function textOfNode(node: Node, source: string): string | null {
  return source.slice(node.startIndex, node.endIndex).trim()
}

function textOfSlice(raw: RawMatch, before: number): string {
  const start = Math.max(0, raw.fullNode.startIndex - before)
  return raw.source.slice(start, raw.fullNode.endIndex)
}

function makeSymbol(
  raw: RawMatch,
  kind: SymbolKind,
  name: string,
  visibility: 'public' | 'internal',
): Symbol {
  const sig = makeSignature(raw.source, raw.fullNode)
  const docstring = findDocstringAbove(raw.source, raw.fullNode)
  const cx = approxComplexity(raw.fullNode)

  // If the symbol is wrapped in a class definition, promote to 'method'.
  let finalKind: SymbolKind = kind
  let parentId: string | null = null
  let p: Node | null = raw.fullNode.parent
  while (p) {
    if (p.type === 'class_definition' || p.type === 'class_declaration' || p.type === 'class_specifier' || p.type === 'impl_item') {
      // Find class name.
      const classNameNode = findFirstIdentifierNode(p)
      if (classNameNode) {
        const className = raw.source.slice(classNameNode.startIndex, classNameNode.endIndex).trim()
        if (className) {
          parentId = makeSymbolId(raw.repoPath, 'class', className)
          if (kind === 'function') finalKind = 'method'
          break
        }
      }
      break
    }
    p = p.parent
  }

  return {
    id: makeSymbolId(raw.repoPath, finalKind, name),
    name,
    kind: finalKind,
    signature: sig,
    lineRange: [
      raw.fullNode.startPosition.row + 1,
      raw.fullNode.endPosition.row + 1,
    ],
    docstring,
    parentId,
    visibility,
    complexity: cx,
  }
}

/** Find the class/decl name node. Search only the direct children subtree up to
 * depth 2 — we don't want to descend into function bodies whose `identifier`
 * is the function name. */
function findFirstIdentifierNode(node: Node): Node | null {
  function visit(n: Node, depth: number): Node | null {
    if (
      n.type === 'identifier' ||
      n.type === 'type_identifier' ||
      n.type === 'constant'
    ) {
      return n
    }
    if (depth >= 2) return null
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) {
        const found = visit(c, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return visit(node, 0)
}

/** Re-export Parser for callers that need it. */
export { Parser }
