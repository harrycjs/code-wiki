#!/usr/bin/env node
import process from 'node:process'
import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { log } from '../shared/log.js'
import { loadConfig } from '../core/config.js'
import { readJson } from '../shared/fs.js'

/**
 * MCP server for code-wiki.
 *
 * M1: scaffolding only — `tools/list`, `resources/list`, and minimal stubs.
 * M5: full implementation of `wiki_search`, `wiki_drill`, `wiki_callers`,
 *     `wiki_callees`, `wiki_changed_since` plus paginated resources.
 */

const server = new Server(
  {
    name: 'code-wiki',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
)

const cwd = process.env.CODEWIKI_CWD || process.cwd()

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'wiki_search',
        description:
          'Search the codewiki for symbols, files, or modules matching a query. ' +
          'Returns results as JSON with id/kind/file/module. Prefer this over Grep.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search string (substring, case-insensitive)' },
            kind: { type: 'string', enum: ['symbol', 'file', 'module'] },
            limit: { type: 'number', default: 20 },
          },
          required: ['query'],
        },
      },
      {
        name: 'wiki_drill',
        description: 'Read a single wiki page by its id (e.g. a file path or module id).',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'wiki_callers',
        description: 'List symbols that call the given symbol id.',
        inputSchema: {
          type: 'object',
          properties: { symbolId: { type: 'string' } },
          required: ['symbolId'],
        },
      },
      {
        name: 'wiki_callees',
        description: 'List symbols that the given symbol id calls.',
        inputSchema: {
          type: 'object',
          properties: { symbolId: { type: 'string' } },
          required: ['symbolId'],
        },
      },
      {
        name: 'wiki_changed_since',
        description: 'List files changed since a git ref (default: last indexed HEAD).',
        inputSchema: {
          type: 'object',
          properties: { ref: { type: 'string' } },
        },
      },
    ],
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // M1 stub: return the wiki tree. M5 will paginate by cursor.
  const cfg = await loadConfig(cwd)
  const indexPath = path.join(cwd, cfg.outDir, '.index.json')
  const tree = await readJson<{ modules: Array<{ id: string; path: string }> }>(indexPath)
  const resources = [
    {
      uri: 'wiki://tree',
      name: 'wiki tree',
      mimeType: 'text/markdown',
      description: 'Top-level module index. Reading this resource returns the module list (~1.5k tokens).',
    },
    {
      uri: 'wiki://architecture',
      name: 'architecture',
      mimeType: 'text/markdown',
      description: 'System architecture overview with module map.',
    },
    {
      uri: 'wiki://index',
      name: 'index',
      mimeType: 'text/markdown',
      description: 'Top-level INDEX.md',
    },
  ]
  for (const m of tree?.modules ?? []) {
    resources.push({
      uri: `wiki://module/${m.id}`,
      name: `module: ${m.id}`,
      mimeType: 'text/markdown',
      description: `Module page ${m.id}`,
    })
  }
  return { resources }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = String(request.params.uri)
  const cfg = await loadConfig(cwd)
  const base = path.join(cwd, cfg.outDir)
  const fs = await import('node:fs/promises')

  const match = (file: string) =>
    fs.readFile(path.join(base, file), 'utf8').then((body) => ({
      contents: [{ uri, mimeType: 'text/markdown', text: body }],
    }))

  if (uri === 'wiki://tree') return match('INDEX.md')
  if (uri === 'wiki://architecture') return match('architecture.md')
  if (uri === 'wiki://index') return match('INDEX.md')
  const modMatch = /^wiki:\/\/module\/(.+)$/.exec(uri)
  if (modMatch) return match(`modules/${modMatch[1]}.md`)
  const fileMatch = /^wiki:\/\/file\/(.+)$/.exec(uri)
  if (fileMatch) return match(`files/${fileMatch[1]}.md`)
  const symMatch = /^wiki:\/\/symbol\/(.+)$/.exec(uri)
  if (symMatch) return match(`symbols/${symMatch[1]}.md`)
  throw new Error(`Unknown resource: ${uri}`)
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  const cfg = await loadConfig(cwd)
  const indexPath = path.join(cwd, cfg.outDir, '.index.json')
  const tree = await readJson<any>(indexPath)

  if (name === 'wiki_search') {
    const q = String(args.query ?? '').toLowerCase()
    const limit = Number(args.limit ?? 20)
    const out: any[] = []
    for (const m of tree?.modules ?? []) {
      if (m.id.toLowerCase().includes(q)) out.push({ kind: 'module', id: m.id, file: m.path })
    }
    for (const f of tree?.files ?? []) {
      if (f.path.toLowerCase().includes(q)) out.push({ kind: 'file', id: f.path, file: f.path, module: f.module })
    }
    for (const s of tree?.symbols ?? []) {
      if (s.name.toLowerCase().includes(q)) out.push({ kind: 'symbol', id: s.id, file: s.file })
    }
    return { content: [{ type: 'text', text: JSON.stringify(out.slice(0, limit), null, 2) }] }
  }

  if (name === 'wiki_drill') {
    const id = String(args.id ?? '')
    const candidates = [
      path.join(cwd, cfg.outDir, `files/${id}.md`),
      path.join(cwd, cfg.outDir, `modules/${id}.md`),
      path.join(cwd, cfg.outDir, `symbols/${id.replace('::', '/')}.md`),
    ]
    for (const c of candidates) {
      try {
        const body = await (await import('node:fs/promises')).readFile(c, 'utf8')
        return { content: [{ type: 'text', text: body }] }
      } catch {
        // try next
      }
    }
    return { content: [{ type: 'text', text: `No wiki page matches ${id}` }], isError: true }
  }

  if (name === 'wiki_callers' || name === 'wiki_callees') {
    const symbolId = String(args.symbolId ?? '')
    const graphPath = path.join(cwd, cfg.outDir, '.graph.json')
    const graph = await readJson<{
      imports: Array<{ from: string; to: string; specifiers: string[] }>
      calls: Array<{ from: string; to: string; line: number }>
      dependents: Record<string, string[]>
    }>(graphPath)
    if (!graph) {
      return {
        content: [{ type: 'text', text: `No .graph.json found. Run \`codewiki build\` first.` }],
        isError: true,
      }
    }
    const fileOf = symbolId.split('::')[0] ?? ''
    if (name === 'wiki_callers') {
      const deps = graph.dependents[fileOf] ?? []
      // Also surface direct import callers (filter out bare specifiers).
      const localCallers = graph.imports
        .filter((e) => e.to === fileOf)
        .map((e) => e.from)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                note: 'M4: callers from import graph. Call edges land in v0.2.',
                symbolId,
                file: fileOf,
                importers: [...new Set([...deps, ...localCallers])],
              },
              null,
              2,
            ),
          },
        ],
      }
    }
    const imports = graph.imports.filter((e) => e.from === fileOf)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              note: 'M4: callees from import graph. Call edges land in v0.2.',
              symbolId,
              file: fileOf,
              imports,
            },
            null,
            2,
          ),
        },
      ],
    }
  }

  return {
    content: [{ type: 'text', text: `Tool "${name}" is a stub in M1; implementation lands in M5.` }],
    isError: false,
  }
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log.info('code-wiki MCP server connected on stdio')
}

main().catch((err) => {
  process.stderr.write(`code-wiki MCP server: ${err?.stack ?? err}\n`)
  process.exit(1)
})
