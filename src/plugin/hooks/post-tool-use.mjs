#!/usr/bin/env node
// PostToolUse hook on Write | Edit | MultiEdit:
// Mark the affected file for incremental re-render.
// Plus a small PostToolUse reminder: log the wiki page for the touched file
// so the model sees an inline pointer in subsequent requests.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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

  const ti = payload.tool_input || {}
  const filePath = ti.file_path || ti.path
  if (!filePath) return

  let rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
  rel = rel.split(path.sep).join('/')
  if (rel.startsWith('./')) rel = rel.slice(2)
  if (!rel || rel.startsWith('.codewiki/')) return

  // Mark in .state.json for incremental rebuild.
  // Path: this script lives at hooks/post-tool-use.mjs inside the plugin root.
  // The bundled CLI is at dist/codewiki.mjs.
  const here = new URL(import.meta.url).pathname.replace(/^\//, '')
  const hooksDir = path.dirname(here)
  const pluginRoot = path.dirname(hooksDir)
  spawnSync(
    'node',
    [path.join(pluginRoot, 'dist', 'codewiki.mjs'), 'invalidate', rel],
    { cwd, stdio: 'ignore' },
  )

  // The inline reminder (Claude Code shows it inline after the tool result).
  const wikiPage = `.codewiki/files/${rel}.md`
  // Verify the wiki page actually exists; otherwise skip.
  try {
    await fs.stat(path.join(cwd, wikiPage))
  } catch {
    return
  }
  process.stdout.write(
    `<system-reminder>\nFile \`${rel}\` was just edited. Its wiki page is at \`${wikiPage}\` and may now be stale. Run /wiki-refresh (or just continue — the next refresh will pick it up).\n</system-reminder>\n`,
  )
}

main().catch(() => process.exit(0))
