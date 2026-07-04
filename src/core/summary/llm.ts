import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import PQueue from 'p-queue'
import pRetry from 'p-retry'
import { log } from '../../shared/log.js'
import { countTokens } from '../tokenize.js'
import { exists, writeJson, readJson, writeText } from '../../shared/fs.js'
import type { FileIndex } from '../types.js'
import { groupModules } from '../modules.js'
import type { CodeWikiConfig } from '../config.js'

/**
 * M7: Optional LLM enrichment.
 *
 * Two passes:
 *   1. File-level — for each complex file, ask Claude Haiku for a one-line
 *      purpose + a short "Notes" section. Concurrency 4. Cost ~$0.001/file.
 *   2. Module-level — when ANY of a module's files changed, regenerate the
 *      module's public surface summary using Sonnet. Cost ~$0.005/module.
 *
 * Cost & performance budget:
 *   - Per-build, run only when ANTHROPIC_API_KEY is set (v0.1).
 *   - Cached by content hash — re-runs without file changes are free.
 *   - Default concurrency 4; configurable via `.codewikirc`.
 *
 * Output:
 *   - `.codewiki/.summary-cache/<sha256>.json` raw response
 *   - `.codewiki/.summary-cache/<sha256>.md` rendered summary
 *   - File pages fold the rendered summary under the static template.
 *   - Module pages substitute the LLM summary if present.
 */

interface AnthropicLike {
  messages: (args: { model: string; max_tokens: number; messages: { role: 'user' | 'assistant'; content: string }[] }) => Promise<{ content: Array<{ type: string; text: string }> }>
}

interface EnrichmentOpts {
  cwd: string
  files: FileIndex[]
  config: CodeWikiConfig
  client?: AnthropicLike
}

const SYSTEM_PROMPT =
  'You are a precise code summarizer. Output ONLY a one-line PURPOSE and a 1-3 sentence NOTES section. No bullet lists, no headings, no markdown formatting. Tone: terse, technical, factual.'

function client(opts: { env?: Record<string, string | undefined>; client?: AnthropicLike }): AnthropicLike | null {
  // Allow tests / future tooling to inject a fake client via factory.
  if (opts.client) return opts.client
  const key = opts.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const sdk = new Anthropic({ apiKey: key })
  return sdk as unknown as AnthropicLike
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

async function readCache(cwd: string, hash: string): Promise<{ purpose: string; notes: string } | null> {
  const p = path.join(cwd, '.codewiki', '.summary-cache', `${hash}.json`)
  const cached = await readJson<{ purpose: string; notes: string }>(p)
  return cached ?? null
}

async function writeCache(cwd: string, hash: string, payload: { purpose: string; notes: string }): Promise<void> {
  const p = path.join(cwd, '.codewiki', '.summary-cache', `${hash}.json`)
  await writeJson(p, payload)
}

function isEligible(file: FileIndex): boolean {
  if (!file.language) return false
  if (file.symbols.length === 0) return false
  // 1) no docstring on any symbol; 2) complexity > 15; 3) tokens > 800.
  if (file.symbols.every((s) => !s.docstring)) return true
  const maxCx = file.symbols.reduce((m, s) => Math.max(m, s.complexity), 0)
  if (maxCx > 15) return true
  if (countTokens(file.oneLineSummary + '\n' + file.symbols.map((s) => s.signature).join('\n')) > 800) {
    return true
  }
  return false
}

/**
 * Run file-level enrichment. Returns a Map<repoPath, summary>.
 */
export async function enrichFiles(opts: EnrichmentOpts): Promise<Map<string, { purpose: string; notes: string }>> {
  const { cwd, files, config } = opts
  const eligible = files.filter(isEligible)
  if (eligible.length === 0) return new Map()

  const anthropic = client({})
  if (!anthropic) {
    log.info({ count: eligible.length }, 'enrichment skipped: ANTHROPIC_API_KEY not set')
    return new Map()
  }
  log.info(
    { count: eligible.length, model: config.enrichment.fileModel, concurrency: config.enrichment.concurrency },
    'starting file-level enrichment',
  )

  const queue = new PQueue({ concurrency: config.enrichment.concurrency })
  const out = new Map<string, { purpose: string; notes: string }>()

  const tasks = eligible.map((file) =>
    queue.add(async () => {
      const hash = sha256(file.contentHash + '|enrich-file')
      const cached = await readCache(cwd, hash)
      if (cached) {
        out.set(file.repoPath, cached)
        return
      }
      try {
        const summary = await pRetry(
          () =>
            callFileSummary(anthropic, file, config).then((s) => ({
              purpose: s.purpose,
              notes: s.notes,
            })),
          { retries: 2, minTimeout: 500, factor: 2 },
        )
        await writeCache(cwd, hash, summary)
        out.set(file.repoPath, summary)
      } catch (err) {
        log.warn({ path: file.repoPath, err: String(err) }, 'file enrichment failed')
      }
    }),
  )
  await Promise.all(tasks)

  log.info({ written: out.size }, 'file enrichment done')
  return out
}

async function callFileSummary(
  anthropic: AnthropicLike,
  file: FileIndex,
  config: CodeWikiConfig,
): Promise<{ purpose: string; notes: string }> {
  const symbols = file.symbols
    .slice(0, 30)
    .map((s) => `[${s.kind}] ${s.signature}${s.docstring ? ` — ${s.docstring}` : ''}`)
    .join('\n')
  const userPrompt = `File: ${file.repoPath} (language=${file.language})\n\nSymbols:\n${symbols}\n\nReturn JSON: {"purpose": "...", "notes": "..."} with at most 30 words of notes. No markdown.`
  const resp = await anthropic.messages({
    model: config.enrichment.fileModel,
    max_tokens: 400,
    messages: [
      { role: 'user', content: SYSTEM_PROMPT + '\n\n' + userPrompt },
    ],
  })
  const text = resp.content.map((c) => c.text).join('')
  return parseSummaryJson(text)
}

export function parseSummaryJson(text: string): { purpose: string; notes: string } {
  // Try strict JSON parse; fall back to a hash-based extraction.
  try {
    const m = /\{[\s\S]*?\}/.exec(text)
    if (m) {
      const obj = JSON.parse(m[0]!)
      if (typeof obj.purpose === 'string' && typeof obj.notes === 'string') {
        return { purpose: obj.purpose, notes: obj.notes }
      }
    }
  } catch {
    // fall through
  }
  // Last-ditch: take first sentence as purpose, rest as notes.
  const lines = text.split('\n').filter(Boolean)
  return {
    purpose: (lines[0] ?? '').slice(0, 200),
    notes: lines.slice(1).join(' ').slice(0, 400),
  }
}

/**
 * Run module-level enrichment: regenerate module summaries if any of their
 * files changed (cache invalidates by member-set hash).
 */
export async function enrichModules(opts: EnrichmentOpts): Promise<Map<string, { purpose: string; notes: string }>> {
  const { cwd, files, config } = opts
  const anthropic = client({})
  if (!anthropic) return new Map()

  const modules = groupModules(files, config)
  const out = new Map<string, { purpose: string; notes: string }>()
  const queue = new PQueue({ concurrency: config.enrichment.concurrency })

  const tasks: Promise<void>[] = []
  for (const [id, m] of modules) {
    tasks.push(
      queue.add(async () => {
        const memberHashes = m.files
          .map((p) => files.find((f) => f.repoPath === p)?.contentHash ?? '')
          .sort()
          .join('|')
        const hash = sha256(memberHashes + '|enrich-module')
        const cached = await readCache(cwd, hash)
        if (cached) {
          out.set(id, cached)
          return
        }
        try {
          const summary = await pRetry(
            () =>
              callModuleSummary(anthropic, id, m, files, config).then((s) => ({
                purpose: s.purpose,
                notes: s.notes,
              })),
            { retries: 2, minTimeout: 500, factor: 2 },
          )
          await writeCache(cwd, hash, summary)
          out.set(id, summary)
        } catch (err) {
          log.warn({ module: id, err: String(err) }, 'module enrichment failed')
        }
      }),
    )
  }
  await Promise.all(tasks)
  log.info({ written: out.size }, 'module enrichment done')
  return out
}

async function callModuleSummary(
  anthropic: AnthropicLike,
  moduleId: string,
  m: { files: string[]; publicSurface: string[] },
  files: FileIndex[],
  config: CodeWikiConfig,
): Promise<{ purpose: string; notes: string }> {
  const fileLines = m.files
    .slice(0, 12)
    .map((p) => {
      const f = files.find((x) => x.repoPath === p)
      return f ? `${p}: ${f.oneLineSummary}` : p
    })
    .join('\n')
  const userPrompt = `Module: ${moduleId}\n\nFiles:\n${fileLines}\n\nReturn JSON: {"purpose": "...", "notes": "..."}. <=25 words notes. No markdown.`
  const resp = await anthropic.messages({
    model: config.enrichment.moduleModel,
    max_tokens: 350,
    messages: [
      { role: 'user', content: SYSTEM_PROMPT + '\n\n' + userPrompt },
    ],
  })
  const text = resp.content.map((c) => c.text).join('')
  return parseSummaryJson(text)
}

/**
 * Public entry: run both passes synchronously. Caller decides whether to
 * embed the result into the wiki pages. This is intentionally separate so
 * tests can drive the same path without touching disk.
 */
export async function enrichAll(opts: EnrichmentOpts): Promise<{
  files: Map<string, { purpose: string; notes: string }>
  modules: Map<string, { purpose: string; notes: string }>
}> {
  const [files, modules] = await Promise.all([
    enrichFiles(opts),
    enrichModules(opts),
  ])
  return { files, modules }
}

/**
 * CLI-friendly entry: write all summaries to disk and report.
 */
export async function runEnrichmentCli(cwd: string, opts: { client?: AnthropicLike } = {}): Promise<void> {
  const { loadConfig } = await import('../config.js')
  const { walkFiles } = await import('../walker.js')
  const cfg = await loadConfig(cwd)
  const walked = await walkFiles({ root: cwd, ignoreGlobs: cfg.ignore })
  const fileIndexes: FileIndex[] = walked.map((f) => ({
    repoPath: f.repoPath,
    absPath: f.absPath,
    language: f.language,
    size: f.size,
    mtimeMs: f.mtimeMs,
    contentHash: '',
    symbols: [],
    publicSymbols: [],
    oneLineSummary: '',
  }))
  await enrichAll({ cwd, files: fileIndexes, config: cfg, client: opts.client })
}

/** Smoke test - ensure the cache dir exists, return its path. */
export async function ensureCacheDir(cwd: string): Promise<string> {
  const dir = path.join(cwd, '.codewiki', '.summary-cache')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

// Unused - keep imports quiet
void writeText
void exists
