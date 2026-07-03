#!/usr/bin/env node
// SessionStart hook: emit a banner that the model sees as a system reminder.
// Output format: JSON to stdout; Claude Code parses the hookSpecificOutput.
// Falls back to plain stdout text when JSON is not supported.

import { promises as fs } from 'node:fs'
import path from 'node:path'

async function main() {
  const cwd = process.env.CODEWIKI_CWD || process.cwd()
  const metaPath = path.join(cwd, '.codewiki', '.meta.json')
  const reminders = []

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'))
    reminders.push(
      `<system-reminder>\n` +
        `code-wiki is enabled for this repo. A .codewiki/ index exists (built ${meta.updatedAt ?? 'recently'}, modules=${meta.moduleCount ?? '?'} files=${meta.fileCount ?? '?'} symbols=${meta.symbolCount ?? '?'}).\n` +
        `Prefer reading .codewiki/INDEX.md and .codewiki/files/**/*.md over grepping source. Use the \`wiki_search\` MCP tool before grep.\n` +
        `Commands: /wiki-build /wiki-refresh /wiki-search /wiki-symbol /wiki-architecture /wiki-graph /wiki-enrich /wiki-help.\n` +
        `</system-reminder>`,
    )
  } catch {
    reminders.push(
      `<system-reminder>\n` +
        `code-wiki is enabled but no .codewiki/ index yet. Run /wiki-build to create one before expecting wiki-aware behavior.\n` +
        `</system-reminder>`,
    )
  }

  // Output to stdout. Claude Code picks this up as additional context.
  process.stdout.write(reminders.join('\n'))
}

main().catch(() => {
  // never block session start on hook failure
  process.exit(0)
})
