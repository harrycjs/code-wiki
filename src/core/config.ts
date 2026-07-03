import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readJson, toPosix } from '../shared/fs.js'

/**
 * Configuration loader.
 *
 * Looks for (in priority order):
 *   1. CLI flag `--config <path>` (handled by commander)
 *   2. `<cwd>/.codewikirc.json`
 *   3. `<cwd>/.codewikirc`
 *   4. `<cwd>/package.json` key `"code-wiki"`
 *
 * Falls back to defaults if nothing is found.
 */

export interface CodeWikiConfig {
  /** Output directory (relative to project root). */
  outDir: string
  /** Source roots to index (defaults: project root, excluding outDir and ignore patterns). */
  sourceRoots: string[]
  /** Extra ignore globs (in addition to .gitignore and built-in defaults). */
  ignore: string[]
  /** File extensions to include without parsing (still indexed as files). */
  includeExtensions: string[]
  /** Module grouping rule. */
  modules: {
    rule: 'by-directory' | 'by-glob' | 'by-package'
    alias: Record<string, string>
    ignore: string[]
  }
  /** Nudge behavior for auto-prompting the model toward wiki pages. */
  nudge: {
    enabled: boolean
    ttlSeconds: number
    minFileLines: number
    blockOnFirstRead: boolean
    scope: 'all' | 'read-only'
  }
  /** LLM enrichment. */
  enrichment: {
    enabled: boolean
    concurrency: number
    fileModel: string
    moduleModel: string
  }
  /** Token budget caps per page type. */
  budgets: {
    file: number
    symbol: number
    module: number
    architecture: number
    /** Max nodes shown in a Mermaid diagram. */
    mermaidNodes: number
  }
}

export const DEFAULT_CONFIG: CodeWikiConfig = {
  outDir: '.codewiki',
  sourceRoots: ['.'],
  ignore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/target/**',
    '**/__pycache__/**',
    '**/.venv/**',
    '**/venv/**',
    '**/*.min.js',
    '**/*.lock',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/Cargo.lock',
    '**/*.wasm',
  ],
  includeExtensions: [],
  modules: {
    rule: 'by-directory',
    alias: {},
    ignore: ['_tests', '_root'],
  },
  nudge: {
    enabled: true,
    ttlSeconds: 300,
    minFileLines: 30,
    blockOnFirstRead: false,
    scope: 'all',
  },
  enrichment: {
    enabled: false,
    concurrency: 4,
    fileModel: 'claude-haiku-4-5',
    moduleModel: 'claude-sonnet-4-5',
  },
  budgets: {
    file: 600,
    symbol: 150,
    module: 800,
    architecture: 1200,
    mermaidNodes: 30,
  },
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function mergeConfig(base: CodeWikiConfig, override: unknown): CodeWikiConfig {
  if (!isPlainObject(override)) return base
  const merged: CodeWikiConfig = JSON.parse(JSON.stringify(base))
  for (const [k, v] of Object.entries(override)) {
    if (k in merged) {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic deep merge
      ;(merged as any)[k] = isPlainObject(v) && isPlainObject((merged as any)[k])
        ? mergeConfig((merged as any)[k], v)
        : v
    }
  }
  return merged
}

export async function loadConfig(cwd: string, configPath?: string): Promise<CodeWikiConfig> {
  let config: CodeWikiConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))

  if (configPath) {
    const override = await readJson(configPath)
    config = mergeConfig(config, override)
    return config
  }

  // 2. .codewikirc.json
  const jsonRc = path.join(cwd, '.codewikirc.json')
  if (await fileExists(jsonRc)) {
    const override = await readJson(jsonRc)
    config = mergeConfig(config, override)
    return config
  }

  // 3. .codewikirc (also JSON for v1 — keep it simple)
  const rc = path.join(cwd, '.codewikirc')
  if (await fileExists(rc)) {
    const text = await fs.readFile(rc, 'utf8')
    try {
      const override = JSON.parse(text)
      config = mergeConfig(config, override)
      return config
    } catch {
      // fall through
    }
  }

  // 4. package.json#code-wiki
  const pkg = path.join(cwd, 'package.json')
  const pkgJson = await readJson<{ 'code-wiki'?: unknown }>(pkg)
  if (pkgJson && pkgJson['code-wiki']) {
    config = mergeConfig(config, pkgJson['code-wiki'])
  }
  return config
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isFile()
  } catch {
    return false
  }
}

/** Pretty-print a config summary for logs. */
export function configSummary(c: CodeWikiConfig): string {
  return [
    `outDir=${toPosix(c.outDir)}`,
    `modules=${c.modules.rule}`,
    `languages=${c.includeExtensions.length || 'auto'}`,
    `nudge=${c.nudge.enabled ? 'on' : 'off'}`,
    `enrichment=${c.enrichment.enabled ? 'on' : 'off'}`,
  ].join(' ')
}
