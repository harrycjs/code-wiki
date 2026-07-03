import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Filesystem helpers. All paths are POSIX-style internally (forward slashes).
 * Convert at the FS boundary only. This keeps Windows + Unix consistent.
 */

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

export function fromPosix(p: string): string {
  // Best-effort: when running on Windows, replace forward slashes with backslashes.
  if (os.platform() === 'win32') {
    return p.replace(/\//g, '\\')
  }
  return p
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8')
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const text = await readText(filePath)
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function writeText(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2) + '\n'
  await writeText(filePath, text)
}

/** Atomically replace a file by writing to a sibling temp path then renaming. */
export async function atomicWriteText(target: string, content: string): Promise<void> {
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, target)
}

/** Recursively remove a directory. */
export async function rmrf(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true })
}

/** Normalize a relative path within a repo, always POSIX style with no leading `./`. */
export function repoRel(absolute: string, root: string): string {
  const rel = path.relative(root, absolute)
  return toPosix(rel).replace(/^\.\//, '')
}
