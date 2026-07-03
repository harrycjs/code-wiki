#!/usr/bin/env node
// UserPromptSubmit hook: emit a brief reminder after every user prompt.
// Only fires when .codewiki/ exists.

import { promises as fs } from 'node:fs'
import path from 'node:path'

async function main() {
  const cwd = process.env.CODEWIKI_CWD || process.cwd()
  const metaPath = path.join(cwd, '.codewiki', '.meta.json')

  let exists = false
  try {
    await fs.stat(metaPath)
    exists = true
  } catch {
    /* ignore */
  }
  if (!exists) return

  process.stdout.write(
    `<system-reminder>\n` +
      `Reminder: prefer .codewiki/ pages (or the wiki_search MCP tool) over reading source files directly. If you edit files since the last index, run /wiki-refresh.\n` +
      `</system-reminder>\n`,
  )
}

main().catch(() => process.exit(0))
