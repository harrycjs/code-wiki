#!/usr/bin/env node
// PreCompact hook: write a marker file so SessionStart can detect that the
// session was compacted and trigger a smart refresh in the background.

import { promises as fs } from 'node:fs'
import path from 'node:path'

async function main() {
  const cwd = process.env.CODEWIKI_CWD || process.cwd()
  const marker = path.join(cwd, '.codewiki', '.last-compact')
  try {
    await fs.mkdir(path.dirname(marker), { recursive: true })
    await fs.writeFile(
      marker,
      JSON.stringify({
        at: new Date().toISOString(),
        head: process.env.CODEWIKI_GIT_HEAD || 'uncommitted',
      }),
    )
  } catch {
    /* never block compact */
  }
}

main().catch(() => process.exit(0))
