import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { buildWiki } from '../../src/core/build.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.resolve(__dirname, '../../examples/fixture-ts')

describe('buildWiki (integration)', () => {
  beforeEach(async () => {
    // Clean any existing .codewiki from previous runs.
    await fs.rm(path.join(FIXTURE_ROOT, '.codewiki'), { recursive: true, force: true })
  })
  afterEach(async () => {
    await fs.rm(path.join(FIXTURE_ROOT, '.codewiki'), { recursive: true, force: true })
  })

  it('builds a full .codewiki/ for fixture-ts', async () => {
    const result = await buildWiki({ cwd: FIXTURE_ROOT })
    expect(result.fileCount).toBeGreaterThanOrEqual(5)
    expect(result.moduleCount).toBeGreaterThanOrEqual(1)
    expect(result.outDir).toBe('.codewiki')

    // Index file + meta + index page + at least one file page + module page.
    const base = path.join(FIXTURE_ROOT, '.codewiki')
    await expect(fs.stat(path.join(base, '.meta.json'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(base, '.index.json'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(base, 'INDEX.md'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(base, 'architecture.md'))).resolves.toBeTruthy()
    await expect(
      fs.stat(path.join(base, 'files', 'src', 'auth', 'login.ts.md')),
    ).resolves.toBeTruthy()
  })

  it('records git/wip metadata in .meta.json', async () => {
    await buildWiki({ cwd: FIXTURE_ROOT })
    const meta = JSON.parse(
      await fs.readFile(path.join(FIXTURE_ROOT, '.codewiki', '.meta.json'), 'utf8'),
    )
    expect(meta.schemaVersion).toBe(1)
    expect(meta.generator).toBe('code-wiki')
    expect(typeof meta.fileCount).toBe('number')
    expect(typeof meta.moduleCount).toBe('number')
  })
})
