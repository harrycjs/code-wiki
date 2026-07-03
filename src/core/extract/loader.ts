import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Parser, Language } from 'web-tree-sitter'
import { log } from '../../shared/log.js'
import type { Language as LangId } from '../types.js'

/**
 * Lazy singleton: load WASM grammars once per process.
 *
 * web-tree-sitter's Parser must be initialized once (Parser.init()), and each
 * grammar must be compiled via Language.load(wasmBytes). We cache the
 * Language instance keyed by the LangId.
 *
 * Path resolution: we check several candidate locations because unbuild
 * bundles the code and breaks `import.meta.url`:
 *   1. `dist/grammars/...wasm` (production layout)
 *   2. `node_modules/tree-sitter-X/...wasm` walking up from cwd (dev)
 *   3. The literal path that prebuilt packages ship
 */

interface GrammarSpec {
  basename: string // e.g. 'tree-sitter-typescript.wasm'
  // lookup under each of these locations, in order
  candidateNames: string[]
}

const GRAMMAR_PATHS: Partial<Record<LangId, GrammarSpec>> = {
  typescript: {
    basename: 'tree-sitter-typescript.wasm',
    candidateNames: [
      'dist/grammars/typescript.wasm',
      'node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm',
    ],
  },
  tsx: {
    basename: 'tree-sitter-tsx.wasm',
    candidateNames: [
      'dist/grammars/tsx.wasm',
      'node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm',
    ],
  },
  javascript: {
    basename: 'tree-sitter-javascript.wasm',
    candidateNames: [
      'dist/grammars/javascript.wasm',
      'node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm',
    ],
  },
  python: {
    basename: 'tree-sitter-python.wasm',
    candidateNames: [
      'dist/grammars/python.wasm',
      'node_modules/tree-sitter-python/tree-sitter-python.wasm',
    ],
  },
  go: {
    basename: 'tree-sitter-go.wasm',
    candidateNames: [
      'dist/grammars/go.wasm',
      'node_modules/tree-sitter-go/tree-sitter-go.wasm',
    ],
  },
  rust: {
    basename: 'tree-sitter-rust.wasm',
    candidateNames: [
      'dist/grammars/rust.wasm',
      'node_modules/tree-sitter-rust/tree-sitter-rust.wasm',
    ],
  },
  java: {
    basename: 'tree-sitter-java.wasm',
    candidateNames: [
      'dist/grammars/java.wasm',
      'node_modules/tree-sitter-java/tree-sitter-java.wasm',
    ],
  },
  c: {
    basename: 'tree-sitter-c.wasm',
    candidateNames: [
      'dist/grammars/c.wasm',
      'node_modules/tree-sitter-c/tree-sitter-c.wasm',
    ],
  },
  cpp: {
    basename: 'tree-sitter-cpp.wasm',
    candidateNames: [
      'dist/grammars/cpp.wasm',
      'node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm',
    ],
  },
  ruby: {
    basename: 'tree-sitter-ruby.wasm',
    candidateNames: [
      'dist/grammars/ruby.wasm',
      'node_modules/tree-sitter-ruby/tree-sitter-ruby.wasm',
    ],
  },
}

let initPromise: Promise<void> | null = null
const languageCache = new Map<LangId, Language>()

async function ensureParserInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init().then(() => {
      log.debug('web-tree-sitter Parser initialised')
    })
  }
  return initPromise
}

async function findWasm(candidates: string[]): Promise<string | null> {
  // Walk up from cwd, checking each candidate under each ancestor.
  let cwd = process.cwd()
  for (let i = 0; i < 8; i++) {
    for (const rel of candidates) {
      const abs = path.join(cwd, rel)
      try {
        await fs.access(abs)
        return abs
      } catch {
        // not here
      }
    }
    const parent = path.dirname(cwd)
    if (parent === cwd) break
    cwd = parent
  }
  return null
}

export async function getLanguage(lang: LangId): Promise<Language | null> {
  const cached = languageCache.get(lang)
  if (cached) return cached
  const spec = GRAMMAR_PATHS[lang]
  if (!spec) return null
  await ensureParserInit()
  const wasmPath = await findWasm(spec.candidateNames)
  if (!wasmPath) {
    log.warn({ lang }, 'tree-sitter grammar wasm not found; check dist/grammars/')
    return null
  }
  try {
    const bytes = await fs.readFile(wasmPath)
    const language = await Language.load(bytes)
    languageCache.set(lang, language)
    return language
  } catch (err) {
    log.warn({ lang, err: String(err) }, 'failed to load grammar')
    return null
  }
}

/** Clear cached grammars (useful for tests). */
export function clearGrammarCache(): void {
  languageCache.clear()
  initPromise = null
}

export function isGrammarSupported(lang: LangId): boolean {
  return lang in GRAMMAR_PATHS
}
