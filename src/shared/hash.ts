import { createHash } from 'node:crypto'

/** SHA-256 hex digest of a string. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Short hash for cache keys, log lines, etc. */
export function shortHash(input: string | Uint8Array, len = 12): string {
  return sha256Hex(input).slice(0, len)
}
