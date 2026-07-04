#!/usr/bin/env node
import process from 'node:process'
import path from 'node:path'
import { Command } from 'commander'
import chokidar from 'chokidar'
import { buildWiki } from '../core/build.js'
import { loadConfig } from '../core/config.js'
import { log, child } from '../shared/log.js'
import { exists, writeJson, readJson, atomicWriteText } from '../shared/fs.js'
import {
  loadState,
  saveState,
  changedFilesSince,
  currentHead,
  enqueueInvalidation,
} from '../core/incremental.js'

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
    .description(
      'Incrementally refresh .codewiki/. Reports git diff since last index; re-runs the full build (incremental re-render lands in v0.2).',
    )
    .option('--config <path>', 'path to a config JSON file')
    .option('--full', 'force a full rebuild')
    .action(async (opts) => {
      const cwd = path.resolve(opts.parent?.cwd ?? process.cwd())
      const state = await loadState(cwd)
      const head = await currentHead(cwd)
      const changed = await changedFilesSince(cwd, state.lastHead)
      process.stdout.write(
        `code-wiki refresh: ${state.lastHead} -> ${head}, ${changed.length} files in git diff.\n`,
      )
      if (changed.length > 0 && changed.length <= 20) {
        for (const f of changed) process.stdout.write(`  - ${f}\n`)
      } else if (changed.length > 20) {
        for (const f of changed.slice(0, 20)) process.stdout.write(`  - ${f}\n`)
        process.stdout.write(`  ... and ${changed.length - 20} more\n`)
      }
      const t0 = Date.now()
      const result = await buildWiki({
        cwd,
        configPath: opts.config,
        full: !!opts.full,
      })
      const newState = {
        ...state,
        lastHead: head,
        files: state.files, // populated by subsequent invalidations
      }
      await saveState(cwd, newState)
      process.stdout.write(
        `code-wiki refreshed .codewiki/ in ${Date.now() - t0}ms\n`,
      )
      void result
    })

  program
    .command('watch')
    .description(
      'Watch the working tree and run /wiki-refresh on file changes. Ctrl-C to stop.',
    )
    .option('--config <path>', 'path to a config JSON file')
    .option('--debounce <ms>', 'debounce delay in ms', '500')
    .action(async (opts) => {
      const cwd = path.resolve(opts.parent?.cwd ?? process.cwd())
      const debounceMs = Number(opts.debounce ?? 500)
      process.stdout.write(`code-wiki watch: cwd=${cwd} (Ctrl-C to stop)\n`)
      const watcher = chokidar.watch(cwd, {
        ignored: (p) =>
          p.includes(`${path.sep}.codewiki${path.sep}`) ||
          p.includes(`${path.sep}node_modules${path.sep}`) ||
          p.includes(`${path.sep}.git${path.sep}`) ||
          p.includes(`${path.sep}dist${path.sep}`) ||
          p.endsWith('package-lock.json'),
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      })
      let pendingTimer: NodeJS.Timeout | null = null
      const pending = new Set<string>()
      const flush = async () => {
        const files = [...pending]
        pending.clear()
        for (const f of files) {
          const rel = path.relative(cwd, f).split(path.sep).join('/')
          try {
            await enqueueInvalidation(cwd, rel)
          } catch {
            // best-effort; refresh can rebuild regardless
          }
        }
        if (files.length > 0) {
          process.stdout.write(
            `code-wiki: ${files.length} change(s) detected, rebuilding...\n`,
          )
          try {
            const r = await buildWiki({ cwd })
            process.stdout.write(`  -> rebuilt ${r.fileCount} files in ${r.durationMs}ms\n`)
          } catch (err) {
            process.stderr.write(`  ! rebuild failed: ${(err as Error).message ?? err}\n`)
          }
        }
      }
      watcher.on('change', (path) => {
        if (pendingTimer) clearTimeout(pendingTimer)
        pending.add(path)
        pendingTimer = setTimeout(flush, debounceMs)
      })
      watcher.on('add', (path) => {
        if (pendingTimer) clearTimeout(pendingTimer)
        pending.add(path)
        pendingTimer = setTimeout(flush, debounceMs)
      })
      watcher.on('unlink', (path) => {
        if (pendingTimer) clearTimeout(pendingTimer)
        pending.add(path)
        pendingTimer = setTimeout(flush, debounceMs)
      })

      // Block forever; SIGINT/SIGTERM stop.
      await new Promise(() => {})
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
      await enqueueInvalidation(cwd, String(p))
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
  void writeJson
  void atomicWriteText
}

main().catch((err) => {
  process.stderr.write(`codewiki: ${err?.stack ?? err}\n`)
  process.exit(1)
})
