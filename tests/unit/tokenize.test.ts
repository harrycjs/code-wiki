import { describe, expect, it } from 'vitest'
import { countTokens, truncateToTokens } from '../../src/core/tokenize.js'

describe('tokenize', () => {
  it('counts tokens for a string', () => {
    expect(countTokens('')).toBe(0)
    expect(countTokens('hello world')).toBeGreaterThan(0)
    expect(countTokens('hello world hello world hello world')).toBeGreaterThan(
      countTokens('hello world'),
    )
  })

  it('truncates to fit a budget', () => {
    const text = 'lorem ipsum '.repeat(200)
    const out = truncateToTokens(text, 10)
    expect(countTokens(out)).toBeLessThanOrEqual(10)
    expect(out).toMatch(/…/)
  })

  it('returns input unchanged when under budget', () => {
    const text = 'small text'
    expect(truncateToTokens(text, 100)).toBe(text)
  })
})
