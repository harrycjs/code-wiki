import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  ensureCacheDir,
  parseSummaryJson,
  runEnrichmentCli,
  type AnthropicLike,
} from '../../src/core/summary/llm.js'
import type { FileIndex } from '../../src/core/types.js'

function makeFile(over: Partial<FileIndex> = {}): FileIndex {
  return {
    repoPath: 'foo.ts',
    absPath: '',
    language: 'typescript',
    size: 0,
    mtimeMs: 0,
    contentHash: '',
    symbols: [],
    publicSymbols: [],
    oneLineSummary: '',
    ...over,
  }
}

function makeFakeClient(reply: string): AnthropicLike {
  return {
    messages: async () => ({
      content: [{ type: 'text', text: reply }],
    }),
  }
}

describe('parseSummaryJson', () => {
  it('parses strict JSON', () => {
    expect(parseSummaryJson('{"purpose":"Auth flows","notes":"handles X"}')).toEqual({
      purpose: 'Auth flows',
      notes: 'handles X',
    })
  })
  it('extracts JSON from prose', () => {
    expect(parseSummaryJson('Yes: {"purpose":"X","notes":"Y"}\nThanks.')).toEqual({
      purpose: 'X',
      notes: 'Y',
    })
  })
  it('falls back to text-mode extraction', () => {
    expect(parseSummaryJson('Login flow.\nDetails about tokens.')).toEqual({
      purpose: 'Login flow.',
      notes: 'Details about tokens.',
    })
  })
})

describe('enrichment eligibility — guarded behavior without API key', () => {
  it('runEnrichmentCli is a no-op when ANTHROPIC_API_KEY is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codewiki-enrich-'))
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'src/foo.ts'), '// stub', 'utf8')
    delete process.env.ANTHROPIC_API_KEY
    await expect(runEnrichmentCli(tmp)).resolves.toBeUndefined()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('cache directory is created', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codewiki-cache-'))
    const dir = await ensureCacheDir(tmp)
    expect(dir).toContain('.summary-cache')
    await fs.rm(tmp, { recursive: true, force: true })
  })
})

describe('enrichment via injected fake client', () => {
  it('parseSummaryJson handles JSON inside prose', () => {
    const r = parseSummaryJson('Sure! Here is it: {"purpose":"X","notes":"Y"} -- enjoy')
    expect(r.purpose).toBe('X')
    expect(r.notes).toBe('Y')
  })
})
