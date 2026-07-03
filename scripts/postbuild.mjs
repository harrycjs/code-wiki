#!/usr/bin/env node
// Post-build: copy the Claude Code plugin surface into dist/plugin/ so that
// `claude plugin install code-wiki` (or the npm package) works without a
// separate install step. Also copies README/CHANGELOG/LICENSE to dist/.

import { promises as fs } from 'node:fs'
import path from 'node:path'

async function cpDir(src, dst) {
  await fs.mkdir(dst, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) await cpDir(s, d)
    else await fs.copyFile(s, d)
  }
}

async function cpFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true })
  await fs.copyFile(src, dst)
}

async function main() {
  // Copy plugin surface
  await cpDir('src/plugin', 'dist/plugin')

  // Copy WASM grammars into dist/grammars/ so the runtime can find them
  // regardless of cwd. unbuild bundles code, breaking `import.meta.url` paths.
  const grammarPairs = [
    ['node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm', 'typescript.wasm'],
    ['node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm', 'tsx.wasm'],
    ['node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm', 'javascript.wasm'],
  ]
  for (const [src, dst] of grammarPairs) {
    try {
      await cpFile(src, path.join('dist', 'grammars', dst))
    } catch {
      console.warn(`postbuild: skipped grammar ${dst} (not present)`)
    }
  }

  // Copy static docs into dist/
  for (const f of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
    try {
      await cpFile(f, path.join('dist', f))
    } catch {
      /* optional */
    }
  }
  console.log('postbuild: copied plugin surface + grammars + docs to dist/')
}

main().catch((err) => {
  console.error('postbuild failed:', err)
  process.exit(1)
})
