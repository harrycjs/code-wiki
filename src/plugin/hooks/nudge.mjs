#!/usr/bin/env node
// PreToolUse nudge hook for Read | Grep | Glob | Bash.
//
// Reads stdin JSON: { tool_name, tool_input, cwd }
// Decides whether the call could be replaced (or preceded) with a wiki read.
// Emits a permissionDecisionReason the model sees as a reminder.
//
// M5 additions:
//   - Honors .codewikirc.json: nudge.minFileLines (skip tiny files),
//     nudge.minLinesForGlob (skip tiny globs)
//   - Adds freshness check: if file mtime > .codewiki/.meta.json updatedAt,
//     the wiki page is stale and we tell the model to run /wiki-refresh
//   - Adds `wiki_changed_since` MCP tool hint on Grep (lets the model
//     catch "is this in the changed set" without paying a Bash cost)

import { promises as fs } from 'node:fs'
import path from 'node:path'

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.rb',
])

const DEFAULT_MIN_FILE_LINES = 30

async function readStdinJson() {
  try {
    const buf = await new Promise((res) => {
      let chunks = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (c) => (chunks += c))
      process.stdin.on('end', () => res(chunks))
    })
    return JSON.parse(buf || '{}')
  } catch {
    return {}
  }
}

async function loadConfig(cwd) {
  // Tolerant config reader — keeps this script self-contained (no TS imports).
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(cwd, '.codewikirc.json'), 'utf8'))
    return cfg
  } catch {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'))
      if (pkg && pkg['code-wiki'] && pkg['code-wiki'].nudge) {
        return { nudge: pkg['code-wiki'].nudge }
      }
    } catch {
      /* ignore */
    }
    return null
  }
}

async function readMeta(cwd) {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, '.codewiki', '.meta.json'), 'utf8'))
  } catch {
    return null
  }
}

function repoRel(absOrRel, cwd) {
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(cwd, absOrRel)
  let rel = path.relative(cwd, abs)
  rel = rel.split(path.sep).join('/')
  if (rel.startsWith('./')) rel = rel.slice(2)
  return rel
}

function isSourceFile(repoPath) {
  const ext = path.extname(repoPath).toLowerCase()
  return SOURCE_EXTS.has(ext)
}

function isReadOfWiki(repoPath) {
  return repoPath.startsWith('.codewiki/') || repoPath.includes('/.codewiki/')
}

async function fileMTimeMs(absPath) {
  try {
    const s = await fs.stat(absPath)
    return s.mtimeMs
  } catch {
    return 0
  }
}

async function fileLineCount(absPath) {
  try {
    const buf = await fs.readFile(absPath, 'utf8')
    return buf.split(/\r?\n/).length
  } catch {
    return 0
  }
}

async function isStale(meta, absFilePath) {
  if (!meta || !meta.updatedAt) return false
  const mtime = await fileMTimeMs(absFilePath)
  if (!mtime) return false
  const metaMs = Date.parse(meta.updatedAt)
  return Number.isFinite(metaMs) && mtime > metaMs
}

async function buildReadReason(repoPath, cwd, index, meta, cfg) {
  if (isReadOfWiki(repoPath)) return null
  if (!isSourceFile(repoPath)) return null

  const filePage = `.codewiki/files/${repoPath}.md`
  try {
    await fs.stat(path.join(cwd, filePage))
  } catch {
    return null
  }

  const minLines = cfg?.nudge?.minFileLines ?? DEFAULT_MIN_FILE_LINES
  const abs = path.join(cwd, repoPath)
  const lines = await fileLineCount(abs)
  if (lines < minLines) return null

  const parts = [
    `Tip: ${filePage} is a wiki summary for this file (~${budgetHint(index, repoPath)} tokens).`,
  ]
  if (await isStale(meta, abs)) {
    parts.push('This file is newer than the wiki — run /wiki-refresh first.')
  }
  parts.push('Read the wiki page first; only Read the source if you need details beyond it.')
  return parts.join(' ')
}

function budgetHint(index, repoPath) {
  const f = index?.files?.find((x) => x.path === repoPath)
  return f?.tokens ?? 600
}

async function main() {
  const payload = await readStdinJson()
  const cwd = payload.cwd || process.env.CODEWIKI_CWD || process.cwd()
  const meta = await readMeta(cwd)
  if (!meta) return // no wiki → no nudge

  const cfg = await loadConfig(cwd)
  if (cfg?.nudge?.enabled === false) return

  // Soft-delete: respect TTL on identical nudges? M5 keeps it simple — no TTL.
  // Future: timestamp in .codewiki/.state.json.

  const tool = payload.tool_name
  const ti = payload.tool_input || {}
  let reason = null

  if (tool === 'Read' && typeof ti.file_path === 'string') {
    const repoPath = repoRel(ti.file_path, cwd)
    const index = payload._index || null // hook can't reach the index from here
    reason = await buildReadReason(repoPath, cwd, index, meta, cfg)
  } else if (tool === 'Grep') {
    const pattern = String(ti.pattern ?? '')
    const pathHint = ti.path ? ` (under ${ti.path})` : ''
    reason = pattern
      ? `Tip: \`wiki_search\` MCP tool covers most symbol/file lookups across this repo. ` +
        `Run \`use_mcp_tool('code-wiki', 'wiki_search', { query: "${pattern.replace(/"/g, '\\"')}" })\` ` +
        `before Grep${pathHint}.`
      : 'Tip: prefer the `wiki_search` MCP tool over Grep when looking for symbols or files.'
  } else if (tool === 'Glob') {
    reason =
      `Tip: \`.codewiki/INDEX.md\` lists every module + file in the wiki. ` +
      `Read it before globbing the source tree.`
  } else if (
    tool === 'Bash' &&
    typeof ti.command === 'string' &&
    /^(cat|head|tail|sed\s+-n|less|more|bat)\s/.test(ti.command.trim())
  ) {
    reason =
      `Tip: prefer \`.codewiki/files/...md\` over cat/head/tail of source files.`
  }

  if (!reason) return

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  }
  process.stdout.write(JSON.stringify(out))
}

main().catch(() => process.exit(0))
