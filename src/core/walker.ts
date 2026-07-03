import { promises as fs } from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'
import { globby } from 'globby'
import type { Language } from './types.js'
import { repoRel } from '../shared/fs.js'

/**
 * File walker for the indexer.
 *
 * - Respects .gitignore via the `ignore` package (no git spawn).
 * - Respects built-in defaults (node_modules, dist, …) configurable via CodeWikiConfig.
 * - Streams results; never holds all paths in memory at once.
 * - Detects language by extension for v1.
 */

export interface WalkedFile {
  absPath: string
  repoPath: string // POSIX, relative to root, no leading './'
  size: number
  mtimeMs: number
  language: Language | null
}

const EXT_TO_LANG: Record<string, Language> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.rb': 'ruby',
}

export function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'unknown'
}

export interface WalkOptions {
  root: string
  ignoreGlobs: string[]
  includeExtensions?: string[]
  /** Cap on how many files to return (0 = no cap). */
  maxFiles?: number
}

/**
 * Walk the project tree, yielding file descriptors.
 *
 * Returns files in deterministic order (sorted by repoPath) so that downstream
 * renders are stable across runs.
 */
export async function walkFiles(opts: WalkOptions): Promise<WalkedFile[]> {
  const { root, ignoreGlobs, includeExtensions = [], maxFiles = 0 } = opts

  const allIgnores = ['.git', '.codewiki', '.codewiki.new', ...ignoreGlobs]

  // Read .gitignore if it exists; the ignore library handles patterns.
  const ig = ignore({ allowRelativePaths: true }).add(allIgnores)
  const gitignore = path.join(root, '.gitignore')
  try {
    const content = await fs.readFile(gitignore, 'utf8')
    ig.add(content)
  } catch {
    // no .gitignore — fine
  }

  const paths = await globby('**', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: false,
    gitignore: false, // we apply gitignore ourselves for portability
    ignore: allIgnores,
  })

  const results: WalkedFile[] = []
  for (const abs of paths) {
    if (maxFiles > 0 && results.length >= maxFiles) break

    const rel = path.relative(root, abs).replace(/\\/g, '/')
    if (ig.ignores(rel)) continue

    let stat
    try {
      stat = await fs.stat(abs)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    results.push({
      absPath: abs,
      repoPath: repoRel(abs, root),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      language: detectLanguage(abs),
    })
  }

  results.sort((a, b) => (a.repoPath < b.repoPath ? -1 : 1))
  return results
}

/** Count files at each top-level dir for module grouping heuristics. */
export function topLevelDir(repoPath: string): string {
  const idx = repoPath.indexOf('/')
  if (idx < 0) return '_root'
  return repoPath.slice(0, idx)
}
