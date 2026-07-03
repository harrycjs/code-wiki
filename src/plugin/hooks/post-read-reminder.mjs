#!/usr/bin/env node
// PostToolUse hook on Read: emit a one-line note with the wiki page path so
// the model remembers the wiki location and avoids re-reading the source next
// time.

import { promises as fs } from 'node:fs'
import path from 'node:path'

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
  const filePath = ti.file_path
  if (!filePath) return

  let rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
  rel = rel.split(path.sep).join('/')
  if (rel.startsWith('./')) rel = rel.slice(2)
  if (rel.startsWith('.codewiki/')) return

  const wikiPage = `.codewiki/files/${rel}.md`
  try {
    await fs.stat(path.join(cwd, wikiPage))
  } catch {
    return
  }

  // M5 will pull symbol hints from .index.json. For now, just the file page.
  let hint = ''
  try {
    const idx = JSON.parse(await fs.readFile(path.join(cwd, '.codewiki', '.index.json'), 'utf8'))
    const fileEntry = idx.files?.find((x) => x.path === rel)
    if (fileEntry?.tokens) {
      hint = ` (~${fileEntry.tokens} tokens vs the source file's many more)`
    }
  } catch {
    /* ignore */
  }

  process.stdout.write(
    `<system-reminder>\nFor future reference, the wiki summary for \`${rel}\` is at \`${wikiPage}\`${hint}.\n</system-reminder>\n`,
  )
}

main().catch(() => process.exit(0))
