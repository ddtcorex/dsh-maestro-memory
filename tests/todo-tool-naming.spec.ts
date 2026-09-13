import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply } from '../src/host/index.ts'

// `dtodo` collided with the harness's own in-session task list (`todo_write`):
// both descriptions called themselves "Todos" and neither said what it was NOT,
// so the model had to guess which system the human meant. The durable store is
// now `maestro_todo`, its description leads with what it is and names the tool
// it must not be confused with, and a routing line names both systems in every
// session's prompt.

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-todo-name-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fakeCtx() {
  const tools: any[] = []
  const contexts: any[] = []
  const ctx: any = {
    tools: { register: (t: any) => { tools.push(t); return () => {} } },
    systemPrompt: { context: (c: any) => { contexts.push(c); return () => {} } },
    connection: {
      rpc: {
        handle: () => () => {},
        call: async () => ({ ok: true, value: {} }),
      },
    },
    effect: (fn: any) => fn(),
    on: () => () => {},
    get: () => undefined,
    state: { tools, contexts },
  }
  return ctx
}

function boot() {
  const ctx = fakeCtx()
  apply(ctx, { memoryDir: root })
  return ctx
}

/** Every prompt-context text this plugin publishes, for one plain session. */
function contextTexts(ctx: any): string[] {
  return ctx.state.contexts.map((c: any) => {
    try {
      return String(c.text({}) ?? '')
    } catch {
      return ''
    }
  })
}

describe('the durable todo tool is named apart from the harness task list', () => {
  it('registers `maestro_todo` and no longer registers `dtodo`', () => {
    const ctx = boot()
    expect(ctx.state.tools.map((t: any) => t.name)).toEqual(['memory', 'memory_suggest', 'maestro_todo'])
  })

  it('opens its description by saying what it is, and names `todo_write` as the other one', () => {
    const tool = boot().state.tools.find((t: any) => t.name === 'maestro_todo')
    expect(tool).toBeDefined()
    expect(tool.description).toMatch(/durable|cross-session/i)
    expect(tool.description).toMatch(/todo_write/)
    expect(tool.description).not.toMatch(/\bdtodo\b/i)
  })

  it('publishes one routing line that separates the two task systems', () => {
    const texts = contextTexts(boot())
    const routing = texts.find((t) => t.includes('todo_write') && t.includes('maestro_todo'))
    expect(routing, 'no prompt context names both systems').toBeDefined()
  })

  it('never mentions the retired name in any prompt context', () => {
    for (const text of contextTexts(boot())) {
      expect(text).not.toMatch(/\bdtodo\b/i)
    }
  })

  it('labels the Memory view tab as the durable store, not plain "Todos"', () => {
    const client = readFileSync(
      fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
      'utf8',
    )
    expect(client).not.toMatch(/\{id:'todos',\s*label:'Todos'/)
    expect(client).toMatch(/id:'todos',\s*label:'[^']*store[^']*'/)
  })
})
