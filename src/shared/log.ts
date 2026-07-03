import pino from 'pino'

/**
 * Light structured logger. Default level = info. Override with `CODEWIKI_LOG=debug`.
 */

const level =
  (process.env.CODEWIKI_LOG as pino.LevelWithSilent | undefined) ??
  (process.env.NODE_ENV === 'test' ? 'silent' : 'info')

export const log = pino({
  level,
  base: { name: 'code-wiki' },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export type Logger = typeof log
export const child = (bindings: Record<string, unknown>): Logger => log.child(bindings)
