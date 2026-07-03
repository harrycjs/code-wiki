import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { loadConfig, DEFAULT_CONFIG } from '../../src/core/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('config', () => {
  it('returns defaults when no config file present', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codewiki-config-'))
    const c = await loadConfig(tmp)
    expect(c.outDir).toBe(DEFAULT_CONFIG.outDir)
    expect(c.nudge.enabled).toBe(DEFAULT_CONFIG.nudge.enabled)
    // Should not throw on missing files.
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('merges .codewikirc.json overrides', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codewiki-config-'))
    await fs.writeFile(
      path.join(tmp, '.codewikirc.json'),
      JSON.stringify({ nudge: { enabled: false } }),
    )
    const c = await loadConfig(tmp)
    expect(c.nudge.enabled).toBe(false)
    expect(c.outDir).toBe(DEFAULT_CONFIG.outDir)
    await fs.rm(tmp, { recursive: true, force: true })
  })
})
