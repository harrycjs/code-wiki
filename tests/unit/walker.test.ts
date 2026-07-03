import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFiles, detectLanguage } from '../../src/core/walker.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// tests/unit -> ../../examples/fixture-ts
const FIXTURE_ROOT = path.resolve(__dirname, '../../examples/fixture-ts')

describe('walker', () => {
  it('detects language by extension', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript')
    expect(detectLanguage('foo.tsx')).toBe('tsx')
    expect(detectLanguage('foo.py')).toBe('python')
    expect(detectLanguage('foo.go')).toBe('go')
    expect(detectLanguage('foo.rs')).toBe('rust')
    expect(detectLanguage('foo.rb')).toBe('ruby')
    expect(detectLanguage('foo.cpp')).toBe('cpp')
    expect(detectLanguage('foo.md')).toBe('unknown')
  })

  it('walks the fixture-ts tree and returns POSIX-style repoPaths', async () => {
    const files = await walkFiles({ root: FIXTURE_ROOT, ignoreGlobs: [] })
    expect(files.length).toBeGreaterThanOrEqual(6)
    const paths = files.map((f) => f.repoPath)
    expect(paths).toContain('src/auth/login.ts')
    expect(paths).toContain('src/auth/session.ts')
    expect(paths).toContain('src/billing/invoice.ts')
    expect(paths).toContain('src/api/middleware.ts')
    // POSIX only — no backslashes anywhere.
    for (const p of paths) expect(p).not.toMatch(/\\/)
  })

  it('honors the ignore globs', async () => {
    const files = await walkFiles({
      root: FIXTURE_ROOT,
      ignoreGlobs: ['**/billing/**', '**/api/**'],
    })
    const paths = files.map((f) => f.repoPath)
    expect(paths).not.toContain('src/billing/invoice.ts')
    expect(paths).not.toContain('src/api/middleware.ts')
    expect(paths).toContain('src/auth/login.ts')
  })
})
