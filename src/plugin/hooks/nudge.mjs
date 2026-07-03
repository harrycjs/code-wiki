#!/usr/bin/env node
// PreToolUse nudge hook for Read | Grep | Glob | Bash.
//
// Reads stdin JSON:
//   { tool_name, tool_input, cwd }
// Decides whether the call could be replaced with a wiki page (or could be
// preceded by one). If so, emits a permissionDecisionReason that Claude Code
// shows as the model's reminder for this tool call.
//
// Never blocks (always returns allow + reason).

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

const READ_NUDGE_MIN_LINES = 30

async function wikiExists(cwd) {
  try {
    await fs.stat(path.join(cwd, '.codewiki', '.meta.json'))
    return true
  } catch {
    return false
  }
}

async function readIndex(cwd) {
  try {
    const txt = await fs.readFile(path.join(cwd, '.codewiki', '.index.json'), 'utf8')
    return JSON.parse(txt)
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

async function fileLineCount(absPath) {
  try {
    const buf = await fs.readFile(absPath, 'utf8')
    return buf.split(/\r?\n/).length
  } catch {
    return 0
  }
}

async function buildReadReason(repoPath, cwd, index) {
  if (isReadOfWiki(repoPath)) return null
  if (!isSourceFile(repoPath)) return null

  const filePage = `.codewiki/files/${repoPath}.md`
  try {
    await fs.stat(path.join(cwd, filePage))
  } catch {
    return null
  }

  const lines = await fileLineCount(path.join(cwd, repoPath))
  if (lines < READ_NUDGE_MIN_LINES) return null

  const symbolHint = findSymbolHint(repoPath, index)
  const parts = [
    `Tip: ${filePage} is a wiki summary for this file (~${filePageBudgetHint(index, repoPath)} tokens).`,
  ]
  if (symbolHint) {
    parts.push(`Symbol pages available: ${symbolHint}`)
  }
  parts.push(`Read the wiki page first; only Read the source if you need details beyond it.`)
  return parts.join(' ')
}

function filePageBudgetHint(index, repoPath) {
  // Pull the cached token count from .index.json if present
  const f = index?.files?.find((x) => x.path === repoPath)
  return f?.tokens ?? 600
}

function findSymbolHint(repoPath, index) {
  if (!index?.symbols) return null
  const syms = index.symbols
    .filter((s) => s.file === repoPath)
    .slice(0, 3)
    .map((s) => `.codewiki/symbols/${repoPath}/${s.kind}.${s.name}.md`)
  return syms.length > 0 ? syms.join(', ') : null
}

async function main() {
  let payload
  try {
    const buf = await new Promise((res) => {
      let chunks = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (c) => (chunks += c))
      process.stdin.on('end', () => res(chunks))
    })
    payload = JSON.parse(buf || '{}')
  } catch {
    payload = {}
  }

  const cwd = payload.cwd || process.env.CODEWIKI_CWD || process.cwd()
  if (!(await wikiExists(cwd))) return

  const tool = payload.tool_name
  const ti = payload.tool_input || {}
  let reason = null

  if (tool === 'Read' && typeof ti.file_path === 'string') {
    const repoPath = repoRel(ti.file_path, cwd)
    const index = await readIndex(cwd)
    reason = await buildReadReason(repoPath, cwd, index)
  } else if (tool === 'Grep') {
    reason =
      `Tip: try the wiki_search MCP tool first — symbols, files, and modules are in the wiki.`
  } else if (tool === 'Glob') {
    reason =
      `Tip: .codewiki/INDEX.md lists all modules and a tree of files. Read it before globbing the source tree.`
  } else if (
    tool === 'Bash' &&
    typeof ti.command === 'string' &&
    /^(cat|head|tail|sed\s+-n|less|more|bat)\s/.test(ti.command.trim())
  ) {
    reason =
      `Tip: prefer .codewiki/files/...md over cat/head/tail of source files.`
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
