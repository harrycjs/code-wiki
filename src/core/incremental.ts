import { promises as fs } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { WikiState } from './types.js'
import { atomicWriteText, exists, readJson, writeJson } from '../shared/fs.js'

/**
 * Incremental-refresh state.
 *
 * M6 ships:
 *   - `.codewiki/.state.json` persists per-file `{hash, mtimeMs, size}` indexed
 *     by repo-relative path. Loaded by `loadState`.
 *   - `changedFilesSince(cwd, lastHead)` shells out to `git diff --name-only`
 *     to find what changed since the last index.
 *   - `enqueueInvalidation` records a file as `publicSignatureChanged: true`
 *     so subsequent refreshes know which files had a structural edit.
 *
 * v0.2: chokidar-based watcher + cascade invalidation of importers.
 */

export interface StateFileEntry {
  hash: string
  mtimeMs: number
  size: number
  lastIndexedAt: string
  symbols: number
  publicSignatureChanged: boolean
}

export function emptyState(lastHead = 'uncommitted'): WikiState {
  return { files: {}, lastHead, nudged: {} }
}

export async function loadState(cwd: string): Promise<WikiState> {
  const p = path.join(cwd, '.codewiki', '.state.json')
  const s = await readJson<WikiState>(p)
  return s ?? emptyState()
}

export async function saveState(cwd: string, state: WikiState): Promise<void> {
  const p = path.join(cwd, '.codewiki', '.state.json')
  await writeJson(p, state)
}

/**
 * Run `git diff --name-only <ref>` to find files changed since last index.
 *
 * Returns an empty array if no git repo, no <ref>, or git fails — callers
 * should fall back to mtime walk.
 */
export async function changedFilesSince(
  cwd: string,
  lastHead: string,
): Promise<string[]> {
  if (lastHead === 'uncommitted' || !lastHead) return []
  let hasRef = false
  try {
    const git = simpleGit({ baseDir: cwd })
    hasRef = await git.raw(['rev-parse', '--verify', lastHead]).then(
      () => true,
      () => false,
    )
    if (!hasRef) return []
    const out = await git.raw(['diff', '--name-only', lastHead])
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/'))
  } catch {
    return []
  }
}

export async function currentHead(cwd: string): Promise<string> {
  try {
    const out = await simpleGit({ baseDir: cwd }).raw(['rev-parse', 'HEAD'])
    return out.trim().slice(0, 12) || 'uncommitted'
  } catch {
    return 'uncommitted'
  }
}

/**
 * Append a file path to the pending-invalidation list. M6 only persists
 * `publicSignatureChanged = true` in the state entry; full-graph cascade is v0.2.
 */
export async function enqueueInvalidation(cwd: string, repoPath: string): Promise<void> {
  const p = path.join(cwd, '.codewiki', '.state.json')
  const state = await loadState(cwd)
  const cur = state.files[repoPath]
  state.files[repoPath] = {
    hash: cur?.hash ?? '',
    mtimeMs: cur?.mtimeMs ?? 0,
    size: cur?.size ?? 0,
    lastIndexedAt: cur?.lastIndexedAt ?? new Date().toISOString(),
    symbols: cur?.symbols ?? 0,
    publicSignatureChanged: true,
  }
  await atomicWriteText(p, JSON.stringify(state, null, 2))
}
