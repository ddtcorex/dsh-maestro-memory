import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { TodoStore } from '../src/host/todo/store.ts'
import { dailyTodoPath } from '../src/host/storage/layout.ts'
import { stampTodoLine, TODO_HEADER } from '../src/host/storage/legacy-format.ts'
import { apply } from '../src/host/index.ts'

let root: string
const cwd = '/tmp/demo-project'
const otherCwd = '/tmp/other-project'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fakeCtx(memoryDir: string) {
  const tools: any[] = []
  const rpcHandlers = new Map<string, any>()
  const ctx: any = {
    tools: { register: (t: any) => { tools.push(t); return () => {} } },
    systemPrompt: { context: () => () => {} },
    connection: {
      rpc: {
        handle: (channel: string, handler: any) => { rpcHandlers.set(channel, handler); return () => {} },
        call: async (channel: string, endpoint: string, payload: any) => {
          const h = rpcHandlers.get(channel)
          if (!h) throw new Error('no handler')
          return h(endpoint, payload)
        },
      },
    },
    effect: (fn: any) => { const d = fn(); return d },
    get: (name: string) => (name === 'connection' ? ctx.connection : undefined),
    state: { tools, rpcHandlers },
  }
  return ctx
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-m3-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('M3-PR-A todo four tracks + IDs', () => {
  it('creates four tracks isolated by cwd/date', () => {
    const s = new TodoStore(root)
    s.addTodo('life', 'life task', {}, undefined)
    s.addTodo('work', 'work task', {}, undefined)
    s.addTodo('project', 'proj A', {}, cwd)
    s.addTodo('project', 'proj B', {}, otherCwd)
    s.addTodo('daily', 'daily task', {}, undefined)
    expect(s.itemsOf('life').length).toBe(1)
    expect(s.itemsOf('work').length).toBe(1)
    expect(s.itemsOf('project', cwd).length).toBe(1)
    expect(s.itemsOf('project', cwd)[0].text).toBe('proj A')
    expect(s.itemsOf('project', otherCwd)[0].text).toBe('proj B')
    expect(s.itemsOf('daily').length).toBe(1)
  })

  it('IDs are 8-hex and unique', () => {
    const s = new TodoStore(root)
    const r1 = s.addTodo('work', 'a', {}, undefined)
    const r2 = s.addTodo('work', 'b', {}, undefined)
    expect(r1.ok && r1.id).toMatch(/^[0-9a-f]{8}$/)
    expect(r2.ok && r2.id).toMatch(/^[0-9a-f]{8}$/)
    expect(r1.id).not.toBe(r2.id)
  })

  it('status/due/quadrant updates and done timestamp', () => {
    const s = new TodoStore(root)
    const r = s.addTodo('life', 'task', { quadrant: 'q1' }, undefined)
    const id = (r as any).id as string
    expect(s.itemsOf('life')[0].quadrant).toBe('q1')
    expect(s.itemsOf('life')[0].status).toBe('pending')
    expect(s.itemsOf('life')[0].doneAt).toBe(null)
    const upd = s.updateTodo('life', id, { quadrant: 'q2', due: '2026-08-10', cat: 'personal', status: 'doing' })
    expect(upd.ok).toBe(true)
    const item = s.itemsOf('life')[0]
    expect(item.quadrant).toBe('q2')
    expect(item.due).toBe('2026-08-10')
    expect(item.cat).toBe('personal')
    expect(item.status).toBe('doing')
    const done = s.doneTodo('life', id)
    expect(done.ok).toBe(true)
    expect(s.itemsOf('life')[0].status).toBe('done')
    expect(s.itemsOf('life')[0].doneAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    // leaving done clears doneAt
    const undone = s.updateTodo('life', id, { status: 'pending' })
    expect(undone.ok).toBe(true)
    expect(s.itemsOf('life')[0].doneAt).toBe(null)
  })

  it('quadrant via important/urgent maps to q1-q4', async () => {
    const s = new TodoStore(root)
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const dtodo = ctx.state.tools.find((t: any) => t.name === 'dtodo')
    expect(dtodo).toBeDefined()
    const exec = { agent: { session: { header: { cwd } } } }
    // important+urgent => q1
    await dtodo.execute({ action: 'add', target: 'work', content: 'q1 task', important: true, urgent: true }, exec)
    expect(s.itemsOf('work').find((i) => i.text === 'q1 task')?.quadrant).toBe('q1')
    await dtodo.execute({ action: 'add', target: 'work', content: 'q2 task', important: true }, exec)
    expect(s.itemsOf('work').find((i) => i.text === 'q2 task')?.quadrant).toBe('q2')
    await dtodo.execute({ action: 'add', target: 'work', content: 'q3 task', urgent: true }, exec)
    expect(s.itemsOf('work').find((i) => i.text === 'q3 task')?.quadrant).toBe('q3')
  })

  it('overdue/today/current-project smart view with limit 8', () => {
    const s = new TodoStore(root)
    const today = todayStr()
    const yesterday = new Date(Date.now() - 86400000)
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`
    const tomorrow = new Date(Date.now() + 86400000)
    const tStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`
    // overdue
    s.addTodo('work', 'overdue', { due: yStr }, undefined)
    // due today
    s.addTodo('work', 'today', { due: today }, undefined)
    // future (should not appear in smart view unless q1/q2 or project)
    s.addTodo('work', 'future', { due: tStr }, undefined)
    // q1/q2 global should appear
    s.addTodo('work', 'q1 global', { quadrant: 'q1' }, undefined)
    s.addTodo('work', 'q3 global future', { quadrant: 'q3', due: tStr }, undefined)
    // project unfinished should appear even if no due/q
    s.addTodo('project', 'proj unfinished', {}, cwd)
    // daily unfinished today should appear
    s.addTodo('daily', 'daily today', {}, undefined)
    // done should be hidden
    const doneId = (s.addTodo('work', 'done task', { due: today }, undefined) as any).id
    s.doneTodo('work', doneId)
    // smart view (default, no all)
    const smart = s.listTodos(['life', 'work', 'project', 'daily'], {}, cwd)
    expect(smart.defaultView).toBe(true)
    expect(smart.items.some((i) => i.text === 'overdue')).toBe(true)
    expect(smart.items.some((i) => i.text === 'today')).toBe(true)
    expect(smart.items.some((i) => i.text === 'q1 global')).toBe(true)
    expect(smart.items.some((i) => i.text === 'proj unfinished')).toBe(true)
    expect(smart.items.some((i) => i.text === 'daily today')).toBe(true)
    expect(smart.items.some((i) => i.text === 'future')).toBe(false)
    expect(smart.items.some((i) => i.text === 'q3 global future')).toBe(false)
    expect(smart.items.some((i) => i.text === 'done task')).toBe(false)
    // overdue comes first
    expect(smart.items[0].text).toBe('overdue')
  })

  it('smart view retains small limit 8', () => {
    const s = new TodoStore(root)
    for (let i = 0; i < 15; i++) s.addTodo('work', `q1 ${i}`, { quadrant: 'q1' }, undefined)
    const smart = s.listTodos(['work'], {}, cwd)
    expect(smart.total).toBe(15)
    expect(smart.items.length).toBe(8)
    expect(smart.truncated).toBe(true)
    const all = s.listTodos(['work'], { all: true }, cwd)
    expect(all.items.length).toBe(15)
    expect(all.truncated).toBe(false)
  })

  it('historical daily lookup past/expired', () => {
    const s = new TodoStore(root)
    const today = todayStr()
    s.addTodo('daily', 'today task', {}, undefined)
    // create yesterday file with unfinished pending (expired)
    const yesterday = new Date(Date.now() - 86400000)
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`
    const yPath = dailyTodoPath(root, yStr)
    mkdirSync(join(root, 'daily'), { recursive: true })
    const rawPending = stampTodoLine({ time: `${yStr} 10:00`, id: 'aaaa0001', quadrant: null, due: null, status: 'pending', cat: null, doneAt: null }, 'yesterday pending')
    const rawDone = stampTodoLine({ time: `${yStr} 11:00`, id: 'aaaa0002', quadrant: null, due: null, status: 'done', cat: null, doneAt: `${yStr} 12:00` }, 'yesterday done')
    const text = `${TODO_HEADER}\n§\n${rawPending}\n§\n${rawDone}\n`
    writeFileSync(yPath, text)
    // past without expired => today + yesterday done (pending filtered)
    const past = s.listTodos(['daily'], { past: true }, undefined)
    expect(past.items.some((i) => i.text === 'yesterday pending')).toBe(false)
    expect(past.items.some((i) => i.text === 'yesterday done')).toBe(true)
    expect(past.items.some((i) => i.text === 'today task')).toBe(true)
    // past with expired => includes yesterday pending
    const pastExpired = s.listTodos(['daily'], { past: true, expired: true }, undefined)
    expect(pastExpired.items.some((i) => i.text === 'yesterday pending')).toBe(true)
  })

  it('dtodo compatibility tool registers and handles all actions', async () => {
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const dtodo = ctx.state.tools.find((t: any) => t.name === 'dtodo')
    expect(dtodo).toBeDefined()
    expect(dtodo.parameters.properties.action.enum).toEqual(['add', 'list', 'done', 'update', 'remove'])
    const exec = { agent: { session: { header: { cwd } } } }
    const add = await dtodo.execute({ action: 'add', target: 'life', content: 'hello', quadrant: 'q1', due: todayStr() }, exec)
    expect(add.content[0].text).toContain('added')
    const list = await dtodo.execute({ action: 'list', all: true }, exec)
    expect(list.content[0].text).toContain('hello')
    // extract id via store
    const store = new TodoStore(root)
    const id = store.itemsOf('life')[0].id!
    const upd = await dtodo.execute({ action: 'update', target: 'life', id, status: 'doing', due: todayStr() }, exec)
    expect(upd.content[0].text).toContain('updated')
    const done = await dtodo.execute({ action: 'done', target: 'life', id }, exec)
    expect(done.content[0].text).toContain('updated')
    const rem = await dtodo.execute({ action: 'remove', target: 'life', id }, exec)
    expect(rem.content[0].text).toContain('deleted')
    expect(store.itemsOf('life').length).toBe(0)
  })

  it('RPC todo.list and todo.mutate', async () => {
    const ctx = fakeCtx(root)
    apply(ctx, { memoryDir: root })
    const handler = ctx.state.rpcHandlers.get('/dsh-maestro-memory')
    expect(handler).toBeDefined()
    let res: any = await handler('todo.mutate', { action: 'add', target: 'work', content: 'rpc task' })
    expect(res.ok).toBe(true)
    const id = res.id as string
    res = await handler('todo.list', { targets: ['work'], opts: { all: true } })
    expect(res.ok).toBe(true)
    expect(res.items.some((i: any) => i.text === 'rpc task')).toBe(true)
    res = await handler('todo.mutate', { action: 'update', target: 'work', id, status: 'done' })
    expect(res.ok).toBe(true)
    res = await handler('todo.mutate', { action: 'remove', target: 'work', id })
    expect(res.ok).toBe(true)
  })
})
