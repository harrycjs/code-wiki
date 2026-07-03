import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'
import { extractSymbols } from '../../src/core/extract/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(__dirname, '../../examples/fixture-ts')

describe('extract (tree-sitter)', () => {
  it('extracts functions, classes, methods, interfaces from fixture-ts', async () => {
    const dir = path.join(FIXTURE, 'src/auth')
    const login = await fs.readFile(path.join(dir, 'login.ts'), 'utf8')
    const syms = await extractSymbols({
      source: login,
      repoPath: 'src/auth/login.ts',
      language: 'typescript',
    })

    const names = syms.map((s) => s.name)
    expect(names).toContain('loginUser')
    expect(names).toContain('refreshToken')
    expect(names).toContain('Credentials') // interface
    expect(names).toContain('AuthService') // class

    const loginUser = syms.find((s) => s.name === 'loginUser')!
    expect(loginUser.kind).toBe('function')
    expect(loginUser.visibility).toBe('public')
    expect(loginUser.lineRange[0]).toBeGreaterThanOrEqual(15)
    expect(loginUser.lineRange[1]).toBeGreaterThan(loginUser.lineRange[0])

    const authService = syms.find((s) => s.name === 'AuthService')!
    expect(authService.kind).toBe('class')

    const loginMethod = syms.find((s) => s.name === 'login' && s.kind === 'method')
    expect(loginMethod).toBeTruthy()
    expect(loginMethod?.parentId).toBe('src/auth/login.ts::class.AuthService')
  })

  it('captures docstrings for symbols preceded by a JSDoc block', async () => {
    const session = await fs.readFile(path.join(FIXTURE, 'src/auth/session.ts'), 'utf8')
    const syms = await extractSymbols({
      source: session,
      repoPath: 'src/auth/session.ts',
      language: 'typescript',
    })
    const sessionIface = syms.find((s) => s.name === 'Session')!
    expect(sessionIface.docstring).toBeTruthy()
    expect(sessionIface.docstring).toMatch(/Session lifecycle/)
  })

  it('marks only exported declarations as public', async () => {
    const login = await fs.readFile(path.join(FIXTURE, 'src/auth/login.ts'), 'utf8')
    const syms = await extractSymbols({
      source: login,
      repoPath: 'src/auth/login.ts',
      language: 'typescript',
    })
    const fake = syms.find((s) => s.name === 'fakeLookup')!
    expect(fake.visibility).toBe('internal')
    const exported = syms.find((s) => s.name === 'loginUser')!
    expect(exported.visibility).toBe('public')
  })
})
