import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host/index.ts'

let root: string
const cwd = '/tmp/demo-project'

/**
 * Cordis-shaped context that captures what `apply()` registers, so the tests
 * drive the REAL memory tool and the REAL snapshot context rather than calling
 * renderSnapshot directly.
 */
function fakeCtx() {
  const tools: any[] = []
  const handlers = new Map<string, any>()
  let snapshot: any = null
  const ctx: any = {
    tools: { register: (t: any) => { tools.push(t); return () => {} } },
    systemPrompt: { context: (def: any) => { snapshot = def; return () => {} } },
    connection: {
      rpc: {
        handle: (channel: string, handler: any) => {
          handlers.set(channel, handler)
          return () => {}
        },
        call: async (channel: string, endpoint: string, payload: any) => {
          const h = handlers.get(channel)
          if (!h) throw new Error(`no handler for ${channel}`)
          return (await h(endpoint, payload, new AbortController().signal)).value
        },
      },
    },
    on: (ev: string, fn: any) => {
      handlers.set(ev, fn)
      return () => handlers.delete(ev)
    },
    effect: (fn: any) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get: (name: string) => (name === 'connection' ? ctx.connection : undefined),
  }
  return {
    ctx,
    tools,
    _emit: (ev: string, ...args: any[]) => { const fn = handlers.get(ev); if (fn) fn(...args) },
    _snapshot: (agent: any) => snapshot.text({ agent }),
    _tool: (name: string) => tools.find((t) => t.name === name),
  }
}

/** A live agent whose event log grows as turns open, mirroring the real one. */
function makeAgent(id: string, opts: { origin?: 'subagent' } = {}) {
  const events: any[] = []
  let seq = 0
  let turn = 0
  return {
    id,
    events,
    session: { header: { cwd, origin: opts.origin }, ownEvents: () => events },
    /** Open a new turn sourced from a direct human prompt. */
    humanTurn() {
      turn += 1
      events.push({ type: 'turn/start', seq: seq += 1, time: 0, data: { turn } })
      events.push({ type: 'user/message', seq: seq += 1, time: 0, data: { source: { kind: 'user' } } })
      return turn
    },
    stop(h: any) {
      h._emit('agent/turn-stopping', { agent: this, turn, signal: new AbortController().signal })
    },
  }
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'wguard-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('write-guard wiring through apply()', () => {
  it('stays inert with the default config (watchdog off)', () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root })
    const agent = makeAgent('a')
    agent.humanTurn(); agent.stop(h)
    agent.humanTurn(); agent.stop(h)
    expect(h._snapshot(agent)).not.toMatch(/Memory Write Backlog/i)
  })

  it('escalates in the snapshot after threshold write-less human turns', () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 2 } })
    const agent = makeAgent('a')
    agent.humanTurn(); agent.stop(h)
    expect(h._snapshot(agent)).not.toMatch(/Memory Write Backlog/i)
    agent.humanTurn(); agent.stop(h)
    expect(h._snapshot(agent)).toMatch(/Memory Write Backlog/i)
  })

  it('clears the warning once a daily write succeeds', async () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 2 } })
    const agent = makeAgent('a')
    agent.humanTurn(); agent.stop(h)
    agent.humanTurn()
    const res = await h._tool('memory').execute(
      { action: 'add', target: 'daily', content: '[10:00] did the thing' },
      { agent, signal: new AbortController().signal },
    )
    expect(res.content[0].text).toMatch(/added to daily/)
    agent.stop(h)
    expect(h._snapshot(agent)).not.toMatch(/Memory Write Backlog/i)
  })

  it('clears the warning after a batch add that includes a guarded track', async () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 1 } })
    const agent = makeAgent('a')
    agent.humanTurn()
    // Batch form: entries[] carries the tracks, so no top-level target/content.
    await h._tool('memory').execute(
      { action: 'add', entries: [{ target: 'project', content: '[10:00] project progress' }] },
      { agent, signal: new AbortController().signal },
    )
    agent.stop(h)
    expect(h._snapshot(agent)).not.toMatch(/Memory Write Backlog/i)
  })

  it('does not clear the warning for an unguarded track (memory/user)', async () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 2 } })
    const agent = makeAgent('a')
    agent.humanTurn(); agent.stop(h)
    agent.humanTurn()
    await h._tool('memory').execute(
      { action: 'add', target: 'user', content: '[10:00] a durable preference' },
      { agent, signal: new AbortController().signal },
    )
    agent.stop(h)
    expect(h._snapshot(agent)).toMatch(/Memory Write Backlog/i)
  })

  it('does not clear the warning when the add was deduplicated', async () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 1 } })
    const agent = makeAgent('a')
    const entry = { action: 'add', target: 'daily', content: '[10:00] identical entry' }
    const exec = { agent, signal: new AbortController().signal }
    // Turn 1 records the entry for real and is discharged.
    agent.humanTurn()
    await h._tool('memory').execute(entry, exec)
    agent.stop(h)
    expect(h._snapshot(agent)).not.toMatch(/Memory Write Backlog/i)
    // Turn 2 repeats it: storage is unchanged, so the turn's duty is not paid.
    agent.humanTurn()
    const dup = await h._tool('memory').execute(entry, exec)
    expect(dup.content[0].text).toBe('duplicate')
    agent.stop(h)
    expect(h._snapshot(agent)).toMatch(/Memory Write Backlog/i)
  })

  it('does not count goal-continuation turns', () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 1 } })
    const agent = makeAgent('a')
    agent.events.push({ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } })
    agent.events.push({ type: 'user/message', seq: 2, time: 0, data: { source: { kind: 'goal' } } })
    agent.stop(h)
    expect(h._snapshot(agent)).not.toMatch(/Memory Write Backlog/i)
  })

  it('treats a sub-threshold config as 1 instead of misfiring', () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 0 } })
    const agent = makeAgent('a')
    agent.humanTurn(); agent.stop(h)
    expect(h._snapshot(agent)).toMatch(/Memory Write Backlog/i)
  })

  it('keeps the discipline note last even while the warning is showing', () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 1 } })
    const agent = makeAgent('a')
    agent.humanTurn(); agent.stop(h)
    const text = h._snapshot(agent)
    expect(text.search(/Memory Write Backlog/i)).toBeLessThan(text.search(/End of every turn/i))
    expect(text.trimEnd().endsWith('bounded, max 8).')).toBe(true)
  })

  it('gives a subagent the restrained cadence and never the backlog alert', () => {
    const h = fakeCtx()
    apply(h.ctx, { memoryDir: root, writeGuard: { enabled: true, threshold: 1 } })
    const sub = makeAgent('sub', { origin: 'subagent' })
    sub.humanTurn(); sub.stop(h)
    const text = h._snapshot(sub)
    expect(text).toMatch(/independent achievement/i)
    expect(text).not.toMatch(/Memory Write Backlog/i)
    expect(text).not.toMatch(/End of every turn/i)
  })
})
