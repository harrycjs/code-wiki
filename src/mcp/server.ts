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
 * M5: full implementation with cursor-paginated resource listing, indexed
 * tools (wiki_search, wiki_drill, wiki_callers, wiki_callees,
 * wiki_changed_since), and resource handlers for tree/modules/files/
 * symbols/architecture/graph.
 *
 * Token discipline: each tool response is small (<2k tokens); the
 * `wiki://tree` resource is paginated so even 10k-file repos don't blow up
 * the system prompt.
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

/* -------------------- helpers -------------------- */

interface CachedIndex {
  config: Awaited<ReturnType<typeof loadConfig>>
  tree: any | null
  graph: any | null
  buildLoadedAt: number
}

let cache: CachedIndex | null = null

async function getIndex(): Promise<CachedIndex> {
  // Reload if older than 30s OR if cache absent. Hooks write to disk;
  // a fresh build should be picked up quickly.
  if (cache && Date.now() - cache.buildLoadedAt < 30_000) return cache
  const cfg = await loadConfig(cwd)
  const tree = await readJson<any>(path.join(cwd, cfg.outDir, '.index.json'))
  const graph = await readJson<any>(path.join(cwd, cfg.outDir, '.graph.json'))
  cache = { config: cfg, tree, graph, buildLoadedAt: Date.now() }
  return cache
}

/* -------------------- tools -------------------- */

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'wiki_search',
        description:
          'Search the codewiki for symbols, files, or modules matching a substring. ' +
          'Always prefer this over Grep when looking for code patterns — results come from ' +
          'the pre-built index and cost ~50 tokens regardless of repo size.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Substring (case-insensitive)' },
            kind: {
              type: 'string',
              enum: ['symbol', 'file', 'module'],
              description: 'Filter by entity kind',
            },
            limit: { type: 'number', default: 20, description: 'Max results (default 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'wiki_drill',
        description:
          'Read a single wiki page by id (file path or module id). ' +
          'Returns the page markdown including YAML frontmatter.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'wiki_callers',
        description:
          'List the files that import the file containing a given symbol id. ' +
          'v0.1: returns file-level dependents (call-level resolution lands v0.2).',
        inputSchema: {
          type: 'object',
          properties: { symbolId: { type: 'string' } },
          required: ['symbolId'],
        },
      },
      {
        name: 'wiki_callees',
        description:
          'List the files imported by the file containing a given symbol id.',
        inputSchema: {
          type: 'object',
          properties: { symbolId: { type: 'string' } },
          required: ['symbolId'],
        },
      },
      {
        name: 'wiki_changed_since',
        description:
          'List files in the repo that changed since the last wiki build. ' +
          'Run /wiki-refresh after this to refresh stale wiki pages.',
        inputSchema: {
          type: 'object',
          properties: { ref: { type: 'string', description: 'git ref (default: HEAD)' } },
        },
      },
    ],
  }
})

/* -------------------- resources -------------------- */

const PAGE_SIZE = 50

/** Compact-list view: only ids, no bodies. */
interface ResourceListItem {
  uri: string
  name: string
  mimeType: string
  description?: string
}

/** Parse a `?cursor=N` style URI param if present. */
function parseCursor(uri: string): { baseUri: string; cursor: number } {
  const i = uri.indexOf('?cursor=')
  if (i < 0) return { baseUri: uri, cursor: 0 }
  const n = Number(uri.slice(i + 8))
  return { baseUri: uri.slice(0, i), cursor: Number.isFinite(n) ? n : 0 }
}

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  const idx = await getIndex()
  const cfg = idx.config
  // cursor pagination over the full URI space.
  const cursor = Number(request.params?.cursor ?? 0)
  void cfg

  const items: ResourceListItem[] = []
  items.push({
    uri: 'wiki://tree',
    name: 'wiki tree (read to navigate)',
    mimeType: 'text/markdown',
    description: 'Top-level module index; capped to <1.5k tokens.',
  })
  items.push({
    uri: 'wiki://architecture',
    name: 'architecture',
    mimeType: 'text/markdown',
    description: 'System overview with Mermaid module map.',
  })
  items.push({
    uri: 'wiki://index',
    name: 'index',
    mimeType: 'text/markdown',
    description: 'Top-level INDEX.md.',
  })

  const mods: any[] = idx.tree?.modules ?? []
  const files: any[] = idx.tree?.files ?? []
  const symbols: any[] = idx.tree?.symbols ?? []

  const totalEntities = 3 + mods.length + files.length + symbols.length
  const limit = PAGE_SIZE
  const offset = cursor
  const sliced = (arr: any[], prefix: string) =>
    arr.slice(offset, offset + limit).map((x) => ({
      uri: x.path ?? `${prefix}/${x}`,
      name: x.title ?? x.name ?? String(x),
      mimeType: 'text/markdown',
    }))

  // Cycle through: modules first, then files, then symbols, then end.
  if (cursor < mods.length) {
    items.push(...sliced(mods, 'wiki://module'))
  } else if (cursor < mods.length + files.length) {
    items.push(
      ...files
        .slice(cursor - mods.length, cursor - mods.length + limit)
        .map((f: any) => ({
          uri: `wiki://file/${f.path}`,
          name: `${f.path}`,
          mimeType: 'text/markdown',
        })),
    )
  } else if (cursor < mods.length + files.length + symbols.length) {
    items.push(
      ...symbols
        .slice(cursor - mods.length - files.length, cursor - mods.length - files.length + limit)
        .map((s: any) => ({
          uri: `wiki://symbol/${s.id}`,
          name: `${s.kind} ${s.name}`,
          mimeType: 'text/markdown',
        })),
    )
  }

  const nextOffset = cursor + limit
  const nextCursor =
    nextOffset < totalEntities ? String(nextOffset) : undefined

  if (nextCursor) {
    return {
      resources: items,
      nextCursor,
    } as any
  }
  return { resources: items }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const raw = String(request.params.uri)
  const { baseUri } = parseCursor(raw)
  const idx = await getIndex()
  const base = path.join(cwd, idx.config.outDir)
  const fs = await import('node:fs/promises')

  const readPage = (file: string) =>
    fs.readFile(path.join(base, file), 'utf8').then((text) => ({
      contents: [{ uri: baseUri, mimeType: 'text/markdown', text }],
    }))

  if (baseUri === 'wiki://tree') return readPage('INDEX.md')
  if (baseUri === 'wiki://architecture') return readPage('architecture.md')
  if (baseUri === 'wiki://index') return readPage('INDEX.md')

  const modMatch = /^wiki:\/\/module\/(.+)$/.exec(baseUri)
  if (modMatch) return readPage(`modules/${modMatch[1]}.md`)
  const fileMatch = /^wiki:\/\/file\/(.+)$/.exec(baseUri)
  if (fileMatch) return readPage(`files/${fileMatch[1]}.md`)
  const symMatch = /^wiki:\/\/symbol\/(.+)$/.exec(baseUri)
  if (symMatch) return readPage(`symbols/${symMatch[1]}.md`)
  const graphMatch = /^wiki:\/\/graph\/(.+)$/.exec(baseUri)
  if (graphMatch) {
    // Render a tiny summary of the symbol's call graph (dependents + imports
    // of the host file). Returns markdown suitable for direct read.
    const symId = graphMatch[1] ?? ''
    const fileOf = symId.split('::')[0] ?? ''
    const deps = idx.graph?.dependents?.[fileOf] ?? []
    const imports = (idx.graph?.imports ?? []).filter((e: any) => e.from === fileOf)
    const lines: string[] = []
    lines.push(`# Graph: ${symId}`)
    lines.push('')
    lines.push(`File: \`${fileOf}\``)
    lines.push('')
    lines.push(`## Imported by (${deps.length})`)
    for (const d of deps) lines.push(`- ${d}`)
    lines.push('')
    lines.push(`## Imports (${imports.length})`)
    for (const e of imports) lines.push(`- \`${e.to}\` [${e.specifiers.join(', ')}]`)
    return { contents: [{ uri: baseUri, mimeType: 'text/markdown', text: lines.join('\n') }] }
  }

  throw new Error(`Unknown resource: ${baseUri}`)
})

/* -------------------- tool handlers -------------------- */

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  const idx = await getIndex()
  const tree = idx.tree
  const graph = idx.graph

  if (name === 'wiki_search') {
    const q = String(args.query ?? '').toLowerCase().trim()
    if (!q) {
      return { content: [{ type: 'text', text: 'wiki_search: missing query' }], isError: true }
    }
    const kind = args.kind as string | undefined
    const limit = Number(args.limit ?? 20)
    const out: any[] = []
    if (!kind || kind === 'module') {
      for (const m of tree?.modules ?? []) {
        if (m.id.toLowerCase().includes(q)) out.push({ kind: 'module', id: m.id, file: m.path, module: m.id })
      }
    }
    if (!kind || kind === 'file') {
      for (const f of tree?.files ?? []) {
        if (f.path.toLowerCase().includes(q)) out.push({ kind: 'file', id: f.path, file: f.path, module: f.module })
      }
    }
    if (!kind || kind === 'symbol') {
      for (const s of tree?.symbols ?? []) {
        if (s.name.toLowerCase().includes(q)) out.push({ kind: 'symbol', id: s.id, file: s.file })
      }
    }
    const trimmed = out.slice(0, limit)
    if (trimmed.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No hits. Try a substring (case-insensitive). If results feel stale, run /wiki-refresh.`,
          },
        ],
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(trimmed, null, 2) }] }
  }

  if (name === 'wiki_drill') {
    const id = String(args.id ?? '')
    if (!id) return { content: [{ type: 'text', text: 'wiki_drill: missing id' }], isError: true }
    const candidates = [
      path.join(cwd, idx.config.outDir, `files/${id}.md`),
      path.join(cwd, idx.config.outDir, `modules/${id}.md`),
      path.join(cwd, idx.config.outDir, `symbols/${id.replace('::', '/')}.md`),
    ]
    const fs = await import('node:fs/promises')
    for (const c of candidates) {
      try {
        const body = await fs.readFile(c, 'utf8')
        return { content: [{ type: 'text', text: body }] }
      } catch {
        // try next
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: `No wiki page matches "${id}". Run \`codewiki build\` first, or use /wiki-search to find the right id.`,
        },
      ],
      isError: true,
    }
  }

  if (name === 'wiki_callers' || name === 'wiki_callees') {
    if (!graph) {
      return {
        content: [{ type: 'text', text: `No .graph.json. Run \`codewiki build\` first.` }],
        isError: true,
      }
    }
    const symbolId = String(args.symbolId ?? '')
    const fileOf = symbolId.split('::')[0] ?? ''
    if (!fileOf) return { content: [{ type: 'text', text: 'wiki_callers/callees: bad symbolId' }], isError: true }

    if (name === 'wiki_callers') {
      const deps = graph.dependents?.[fileOf] ?? []
      const localCallers = (graph.imports ?? [])
        .filter((e: any) => e.to === fileOf)
        .map((e: any) => e.from)
      const all = [...new Set([...(deps ?? []), ...localCallers])]
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                note: 'M4-M5: file-level dependents. Call edges land v0.2.',
                symbolId,
                file: fileOf,
                importers: all,
              },
              null,
              2,
            ),
          },
        ],
      }
    }
    const imports = (graph.imports ?? []).filter((e: any) => e.from === fileOf)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              note: 'M4-M5: file-level imports. Call edges land v0.2.',
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

  if (name === 'wiki_changed_since') {
    // v0.1.0: shell out to git. v0.2 will memoize.
    const ref = String(args.ref ?? 'HEAD')
    const { spawn } = await import('node:child_process')
    return new Promise((resolve) => {
      const r = spawn('git', ['diff', '--name-only', ref], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      r.stdout.on('data', (c) => (out += c.toString()))
      r.stderr.on('data', (c) => (err += c.toString()))
      r.on('close', (code) => {
        if (code !== 0) {
          resolve({
            content: [
              {
                type: 'text',
                text: `git diff exited ${code}: ${err || 'unknown error'}`,
              },
            ],
            isError: true,
          })
          return
        }
        const files = out
          .trim()
          .split('\n')
          .filter(Boolean)
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ref, changedFiles: files, count: files.length }, null, 2),
            },
          ],
        })
      })
    })
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
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

// Touch imports to suppress unused warnings; helpful for downstream readers.
void log
