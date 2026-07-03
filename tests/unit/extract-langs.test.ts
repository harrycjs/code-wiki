import { describe, expect, it } from 'vitest'
import { extractSymbols } from '../../src/core/extract/index.js'

const PY_SNIPPET = `
def public_func(a: int) -> int:
    """Public function with docstring."""
    return a + 1


def _private_func():
    return None


class Greeter:
    """A simple class."""
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"hi {self.name}"
`

const GO_SNIPPET = `
package main

func PublicFunc() string { return "hi" }

func privateFunc() { _ = 1 }

type Greeter struct { name string }

type RunOptions struct{ Skip bool }

func (g Greeter) Greet() string { return g.name }

func New() Greeter { return Greeter{} }
`

const RUST_SNIPPET = `
pub fn public_fn() -> i32 { 1 }
fn private_fn() {}

pub struct Pub { x: i32 }

pub trait Greet { fn hello(&self); }

impl Greet for Pub {
    fn hello(&self) {}
}

pub enum E { A, B }
`

const JAVA_SNIPPET = `
public class App {
    public int counter() { return 1; }
    private int secret() { return 0; }
}

interface Greet {
    String hello();
 }
`

const C_SNIPPET = `
int public_fn(int x) { return x + 1; }

static int internal_fn(int x) { return x; }
`

const RUBY_SNIPPET = `
module Greeter
  class Person
    def greet
      "hi"
    end

    private

    def secret
      "shh"
    end
  end

  def self.helper
    "yep"
  end
end
`

describe('extract (M3 — multi-language)', () => {
  it('extracts Python functions, classes, methods, and respects underscore privacy', async () => {
    const syms = await extractSymbols({
      source: PY_SNIPPET,
      repoPath: 'sample.py',
      language: 'python',
    })
    const names = syms.map((s) => `${s.kind}.${s.name}`)
    expect(names).toContain('function.public_func')
    expect(names).toContain('class.Greeter')
    expect(names).toContain('method.__init__')
    expect(names).toContain('method.greet')
    expect(names).toContain('function._private_func')

    const pub = syms.find((s) => s.name === 'public_func')!
    expect(pub.visibility).toBe('public')
    expect(pub.docstring).toMatch(/Public function/)

    const priv = syms.find((s) => s.name === '_private_func')!
    expect(priv.visibility).toBe('internal')
  })

  it('extracts Go functions, methods, structs', async () => {
    const syms = await extractSymbols({
      source: GO_SNIPPET,
      repoPath: 'sample.go',
      language: 'go',
    })
    const names = syms.map((s) => `${s.kind}.${s.name}`)
    expect(names).toContain('function.PublicFunc')
    expect(names).toContain('class.Greeter')
    expect(names).toContain('class.RunOptions')
    expect(names.some((n) => n === 'method.Greet')).toBe(true)
    expect(names.some((n) => n === 'function.New')).toBe(true)
  })

  it('extracts Rust pub items and items without pub (privacy)', async () => {
    const syms = await extractSymbols({
      source: RUST_SNIPPET,
      repoPath: 'sample.rs',
      language: 'rust',
    })
    const pub = syms.find((s) => s.name === 'public_fn')!
    expect(pub.visibility).toBe('public')
    expect(pub.kind).toBe('function')

    const priv = syms.find((s) => s.name === 'private_fn')!
    expect(priv.visibility).toBe('internal')

    const inter = syms.find((s) => s.name === 'Greet')!
    expect(inter.kind).toBe('interface')
  })

  it('extracts Java methods, classes, interfaces', async () => {
    const syms = await extractSymbols({
      source: JAVA_SNIPPET,
      repoPath: 'App.java',
      language: 'java',
    })
    const names = syms.map((s) => `${s.kind}.${s.name}`)
    expect(names).toContain('class.App')
    expect(names).toContain('interface.Greet')
    const counter = syms.find((s) => s.name === 'counter')!
    expect(counter.kind).toBe('method')
    expect(counter.visibility).toBe('public')
    const secret = syms.find((s) => s.name === 'secret')!
    expect(secret.visibility).toBe('internal')
  })

  it('extracts C functions (and marks static as internal)', async () => {
    const syms = await extractSymbols({
      source: C_SNIPPET,
      repoPath: 'sample.c',
      language: 'c',
    })
    const names = syms.map((s) => s.name)
    expect(names).toContain('public_fn')
    expect(names).toContain('internal_fn')
    expect(syms.find((s) => s.name === 'public_fn')!.visibility).toBe('public')
    expect(syms.find((s) => s.name === 'internal_fn')!.visibility).toBe('internal')
  })

  it('extracts Ruby module, class, methods (with private marking)', async () => {
    const syms = await extractSymbols({
      source: RUBY_SNIPPET,
      repoPath: 'sample.rb',
      language: 'ruby',
    })
    const names = syms.map((s) => `${s.kind}.${s.name}`)
    expect(names).toContain('module.Greeter')
    expect(names).toContain('class.Person')
    expect(names).toContain('method.greet')
    expect(names).toContain('method.secret')
    const secret = syms.find((s) => s.name === 'secret')!
    expect(secret.visibility).toBe('internal')
  })
})
