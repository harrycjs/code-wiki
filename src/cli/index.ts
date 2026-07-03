#!/usr/bin/env node
import process from 'node:process'
import path from 'node:path'
import { Command } from 'commander'
import { buildWiki } from '../core/build.js'
import { loadConfig } from '../core/config.js'
import { log, child } from '../shared/log.js'
import { exists, writeJson, readJson } from '../shared/fs.js'

const pkg = { name: 'code-wiki', version: '0.1.0' }

async function main(): Promise<void> {
  const program = new Command()
  program
    .name('codewiki')
    .description('Token-efficient code wiki generator and Claude Code plugin entry point')
    .version(pkg.version)
    .option('--cwd <path>', 'project root', process.cwd())

  program
    .command('build')
    .description('Build or rebuild the .codewiki/ index for the current project')
    .option('--full', 'force a full rebuild (skip incremental cache)')
    .option('--config <path>', 'path to a config JSON file')
    .option('--quiet', 'suppress non-error output')
    .option('--verbose', 'verbose output')
    .action(async (opts) => {
      const cwd = path.resolve(opts.parent?.cwd ?? process.cwd())
      const t0 = Date.now()
      const result = await buildWiki({
        cwd,
        configPath: opts.config,
        full: !!opts.full,
      })
      const dur = Date.now() - t0
      process.stdout.write(
        `code-wiki built .codewiki/ in ${result.durationMs}ms (${result.fileCount} files, ${result.moduleCount} modules)\n`,
      )
      void dur
    })

  program
    .command('refresh')
    .description('Incrementally refresh .codewiki/ based on git diff since last index')
    .option('--config <path>', 'path to a config JSON file')
    .action(async (opts) => {
      const cwd = path.resolve(opts.parent?.cwd ?? process.cwd())
      const t0 = Date.now()
      // v1: refresh is identical to build. M6 will add git-diff short-circuit.
      const result = await buildWiki({ cwd, configPath: opts.config })
      process.stdout.write(
        `code-wiki refreshed .codewiki/ in ${result.durationMs}ms\n`,
      )
    })

  program
    .command('search <query>')
    .description('Search the wiki for symbols, files, or modules')
    .option('--limit <n>', 'max results', '20')
    .option('--json', 'emit machine-readable JSON')
    .action(async (query, opts) => {
      const cwd = path.resolve(opts.parent?.cwd ?? process.cwd())
      const cfg = await loadConfig(cwd)
      const indexPath = path.join(cwd, cfg.outDir, '.index.json')
      const tree = await readJson<{ files: Array<{ path: string; module: string }>; modules: Array<{ id: string; path: string }>; symbols: Array<{ id: string; name: string; kind: string; file: string }> }>(indexPath)
      if (!tree) {
        process.stderr.write(`No .codewiki found at ${cfg.outDir}/. Run \`codewiki build\` first.\n`)
        process.exit(1)
      }
      const q = String(query).toLowerCase()
      const results: Array<{ kind: string; id: string; file?: string; module?: string }> = []
      for (const m of tree.modules) {
        if (m.id.toLowerCase().includes(q)) results.push({ kind: 'module', id: m.id, module: m.id, file: m.path })
      }
      for (const f of tree.files) {
        if (f.path.toLowerCase().includes(q)) results.push({ kind: 'file', id: f.path, file: f.path, module: f.module })
      }
      for (const s of tree.symbols) {
        if (s.name.toLowerCase().includes(q)) results.push({ kind: 'symbol', id: s.id, file: s.file })
      }
      const limit = Number(opts.limit) || 20
      const trimmed = results.slice(0, limit)
      if (opts.json) {
        process.stdout.write(JSON.stringify(trimmed, null, 2) + '\n')
      } else {
        for (const r of trimmed) {
          process.stdout.write(`${r.kind.padEnd(7)} ${r.id}  ${r.file ?? ''}\n`)
        }
      }
    })

  program
    .command('show <pathOrSymbol>')
    .description('Print a wiki page to stdout')
    .action(async (pathOrSymbol) => {
      const cwd = path.resolve(process.cwd())
      const cfg = await loadConfig(cwd)
      const wikiBase = path.join(cwd, cfg.outDir)
      const rel = String(pathOrSymbol).replace(/^\.\//, '')
      // Try direct wiki page first.
      const candidates = [
        path.join(wikiBase, rel.endsWith('.md') ? rel : `${rel}.md`),
        path.join(wikiBase, 'files', `${rel}.md`),
        path.join(wikiBase, 'modules', `${rel}.md`),
        path.join(wikiBase, 'symbols', `${rel.replace('::', '/')}.md`),
      ]
      for (const c of candidates) {
        if (await exists(c)) {
          const buf = await import('node:fs/promises').then((m) => m.readFile(c, 'utf8'))
          process.stdout.write(buf)
          return
        }
      }
      process.stderr.write(`No wiki page matches ${pathOrSymbol}\n`)
      process.exit(1)
    })

  program
    .command('invalidate <path>')
    .description('Mark a single file for incremental re-render (used by hooks)')
    .action(async (p) => {
      const cwd = path.resolve(process.cwd())
      const cfg = await loadConfig(cwd)
      const statePath = path.join(cwd, cfg.outDir, '.state.json')
      const state = (await readJson<{ files: Record<string, { hash: string; mtimeMs: number; size: number; lastIndexedAt: string; symbols: number; publicSignatureChanged: boolean }>; lastHead: string }>(statePath)) ?? { files: {}, lastHead: 'uncommitted' }
      state.files[String(p)] ??= {
        hash: '',
        mtimeMs: 0,
        size: 0,
        lastIndexedAt: new Date().toISOString(),
        symbols: 0,
        publicSignatureChanged: true,
      }
      state.files[String(p)]!.publicSignatureChanged = true
      await writeJson(statePath, state)
    })

  program
    .command('validate')
    .description('Sanity-check that .codewiki/ is well-formed')
    .action(async () => {
      const cwd = path.resolve(process.cwd())
      const cfg = await loadConfig(cwd)
      const base = path.join(cwd, cfg.outDir)
      if (!(await exists(base))) {
        process.stderr.write(`No .codewiki at ${cfg.outDir}. Run \`codewiki build\` first.\n`)
        process.exit(1)
      }
      const meta = await readJson<{ schemaVersion?: number }>(path.join(base, '.meta.json'))
      if (!meta || meta.schemaVersion !== 1) {
        process.stderr.write(`.meta.json missing or wrong schemaVersion: got ${meta?.schemaVersion}\n`)
        process.exit(1)
      }
      process.stdout.write(`${cfg.outDir} looks valid.\n`)
    })

  program
    .command('clean')
    .description('Remove .codewiki/ from the current project')
    .option('--yes', 'do not prompt')
    .action(async (opts) => {
      const cwd = path.resolve(process.cwd())
      const cfg = await loadConfig(cwd)
      const dir = path.join(cwd, cfg.outDir)
      if (await exists(dir)) {
        if (!opts.yes) {
          process.stderr.write(`Pass --yes to confirm removal of ${cfg.outDir}/\n`)
          process.exit(2)
        }
        const fs = await import('node:fs/promises')
        await fs.rm(dir, { recursive: true, force: true })
        process.stdout.write(`Removed ${cfg.outDir}/\n`)
      } else {
        process.stdout.write(`No ${cfg.outDir}/ to remove.\n`)
      }
    })

  await program.parseAsync(process.argv)
  void log
  void child
}

main().catch((err) => {
  process.stderr.write(`codewiki: ${err?.stack ?? err}\n`)
  process.exit(1)
})
