import type { CodeWikiConfig } from './config.js'
import type { FileIndex, ModuleInfo } from './types.js'

/**
 * Module grouping.
 *
 * Default `by-directory` rule: each top-level directory under the source root
 * is one module. Files at the source root form a synthetic `_root` module.
 * Test-style files form `_tests` (hidden from architecture diagrams by default).
 *
 * The alias map in `.codewikirc.modules.alias` allows renaming:
 *   alias: { "src/components/forms": "ui/forms", "src/components/layout": "ui/layout" }
 *
 * This produces flatter, more useful modules for monorepos and component libs.
 */

const TEST_PATTERNS = [
  /(^|\/)__tests__\//,
  /\.test\.[a-z]+$/,
  /\.spec\.[a-z]+$/,
  /(^|\/)test_(.+)\.[a-z]+$/,
  /(^|\/)(.+)_test\.[a-z]+$/,
  /(^|\/)spec\//,
]

function isTestFile(repoPath: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(repoPath))
}

export function moduleForFile(repoPath: string, cfg: CodeWikiConfig): string {
  if (isTestFile(repoPath)) return '_tests'

  // Apply alias rules (longest prefix match).
  for (const [from, to] of Object.entries(cfg.modules.alias)) {
    if (repoPath === from || repoPath.startsWith(`${from}/`)) {
      // Replace leading prefix and continue with by-directory on the result.
      const remainder = repoPath.slice(from.length).replace(/^\//, '')
      const top = remainder.split('/')[0] || '_root'
      const candidate = `${to}/${remainder === '' ? '' : top}`.replace(/\/$/, '')
      return candidate.split('/')[0] || '_root'
    }
  }

  const top = repoPath.split('/')[0]
  return top || '_root'
}

export function groupModules(
  files: FileIndex[],
  cfg: CodeWikiConfig,
): Map<string, ModuleInfo> {
  const map = new Map<string, ModuleInfo>()
  for (const f of files) {
    // Skip files within .codewiki itself (defensive).
    if (f.repoPath.startsWith('.codewiki/')) continue

    const id = moduleForFile(f.repoPath, cfg)
    let entry = map.get(id)
    if (!entry) {
      entry = {
        id,
        title: id,
        files: [],
        publicSurface: [],
      }
      map.set(id, entry)
    }
    entry.files.push(f.repoPath)
    for (const s of f.publicSymbols) {
      entry.publicSurface.push(`${s.kind === 'method' ? 'method' : s.kind} ${s.name}`)
    }
  }

  // Drop ignored modules
  for (const id of [...map.keys()]) {
    if (cfg.modules.ignore.includes(id)) {
      map.delete(id)
    }
  }

  return map
}
