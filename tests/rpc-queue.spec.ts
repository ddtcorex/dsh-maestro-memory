import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host/index.ts'
import { SuggestionQueue } from '../src/host/review/queue.ts'
import { suggestionsPath } from '../src/host/storage/layout.ts'
import { resolveMemoryRoot } from '../src/host/storage/layout.ts'
import { readFileSync } from 'node:fs'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-rpc-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fakeCtx(memoryDir: string) {
  const tools: any[] = []
  const rpcHandlers = new Map<string, any>()
  const ctx: any = {
    tools: {
      register: (t: any) => {
        tools.push(t)
        return () => {}
      },
    },
    systemPrompt: {
      context: () => () => {},
    },
    connection: {
      rpc: {
        handle: (channel: string, handler: any) => {
          rpcHandlers.set(channel, handler)
          return () => {}
        },
        call: async (channel: string, endpoint: string, payload: any) => {
          const h = rpcHandlers.get(channel)
          if (!h) throw new Error('no handler')
          return h(endpoint, payload)
        },
      },
    },
    effect: (fn: any) => {
      const dispose = fn()
      return dispose
    },
    get: (name: string) => (name === 'connection' ? ctx.connection : undefined),
    state: { tools, rpcHandlers },
  }
  return ctx
}

describe('M2-PR-B gated memory_suggest and explicit RPC', () => {
  it('memory_suggest queues, does not write directly', async () => {
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const suggest = ctx.state.tools.find((t: any) => t.name === 'memory_suggest')
    expect(suggest).toBeDefined()
    const exec = { agent: { id: 'sess1', session: { header: { cwd: '/tmp/proj' } } } }
    const res = await suggest.execute({ target: 'memory', content: 'gated fact', reason: 'because' }, exec)
    expect(res.content[0].text).toContain('queued')
    const queue = new SuggestionQueue(suggestionsPath(root))
    expect(queue.read().length).toBe(1)
    expect(queue.read()[0].content).toBe('gated fact')
    // model cannot approve via tool: only tool is memory_suggest, no approve tool
    expect(ctx.state.tools.find((t: any) => t.name === 'memory_approve')).toBeUndefined()
  })

  it('RPC queue.decide approve with edited content writes edited version', async () => {
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const suggest = ctx.state.tools.find((t: any) => t.name === 'memory_suggest')
    const exec = { agent: { id: 'sess1', session: { header: { cwd: root } } } }
    await suggest.execute({ target: 'memory', content: 'original', reason: 'r' }, exec)
    const handler = ctx.state.rpcHandlers.get('/dsh-maestro-memory')
    expect(handler).toBeDefined()
    // approve with edit via RPC (explicit user click)
    const edited = { '1': 'edited content' }
    const res = await handler('queue.decide', { action: 'approve', indices: [1], edits: edited })
    expect(res.ok).toBe(true)
    expect(res.lines[0]).toContain('approved')
    const queue = new SuggestionQueue(suggestionsPath(root))
    expect(queue.read().length).toBe(0)
    // edited content should be in store, original not
    const { MaestroMemoryStore } = await import('../src/host/memory/store.ts')
    const store = new MaestroMemoryStore(root)
    const entries = store.list('memory')
    expect(entries.join(' ')).toContain('edited content')
    expect(entries.join(' ')).not.toContain('original')
  })

  it('RPC queue.decide reject and archive require explicit user action', async () => {
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const suggest = ctx.state.tools.find((t: any) => t.name === 'memory_suggest')
    const exec = { agent: { id: 'sess1', session: { header: { cwd: root } } } }
    await suggest.execute({ target: 'user', content: 'to reject', reason: 'r' }, exec)
    await suggest.execute({ target: 'memory', content: 'to archive', reason: 'r2' }, exec)
    const handler = ctx.state.rpcHandlers.get('/dsh-maestro-memory')
    // reject via RPC
    let res = await handler('queue.decide', { action: 'reject', indices: [1] })
    expect(res.ok).toBe(true)
    expect(res.removed).toBe(1)
    let queue = new SuggestionQueue(suggestionsPath(root))
    expect(queue.read().length).toBe(1)
    expect(queue.read()[0].content).toBe('to archive')
    // archive via RPC (explicit click)
    res = await handler('queue.decide', { action: 'archive', indices: [1] })
    expect(res.ok).toBe(true)
    queue = new SuggestionQueue(suggestionsPath(root))
    expect(queue.read().length).toBe(0)
  })

  it('queue.list RPC returns current queue', async () => {
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const handler = ctx.state.rpcHandlers.get('/dsh-maestro-memory')
    const q = new SuggestionQueue(suggestionsPath(root))
    q.append({ time: new Date().toISOString(), target: 'memory', content: 'a', reason: 'r' } as any)
    const res = await handler('queue.list', {})
    expect(res.ok).toBe(true)
    expect(res.entries.length).toBe(1)
  })

  it('malformed JSONL does not break RPC list', async () => {
    const { writeFileSync } = await import('node:fs')
    const file = suggestionsPath(root)
    writeFileSync(file, 'bad json\n{"target":"memory","content":"good","reason":"r","time":"t"}\n', 'utf8')
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const handler = ctx.state.rpcHandlers.get('/dsh-maestro-memory')
    const res = await handler('queue.list', {})
    expect(res.entries.length).toBe(1)
    expect(res.entries[0].content).toBe('good')
  })
})
