import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshot } from '../src/host/prompt/snapshot.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/demo-project'

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'snap-')); store = new MaestroMemoryStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('renderSnapshot contract', () => {
  it('includes session header when sessionId/name provided', () => {
    store.add('memory', '[2026-08-10] global entry')
    const text = renderSnapshot(store, { cwd, sessionId: 'abc123', sessionName: 'my-session' })
    expect(text).toContain('abc123')
    expect(text).toContain('my-session')
  })

  it('includes end-of-turn discipline note (daily+project + dtodo)', () => {
    const text = renderSnapshot(store, { cwd: '/tmp/x', sessionId: 's1' })
    expect(text).toMatch(/End of every turn/i)
    expect(text).toMatch(/daily.*project/i)
    expect(text).toMatch(/dtodo list/i)
  })

  it('bounded: includes USER+MEMORY+KEY, excludes daily/project', () => {
    store.add('memory', '[2026-08-10] global')
    store.add('user', '[2026-08-10] user')
    store.add('key', '[2026-08-10] key entry', cwd)
    store.add('daily', '[08:30] daily log')
    store.add('project', '[2026-08-10 10:00] project log', cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('global')
    expect(text).toContain('user')
    expect(text).toContain('key entry')
    expect(text).not.toContain('daily log')
    expect(text).not.toContain('project log')
  })

  it('branch-filtered: only matching key entries appear', () => {
    store.add('key', '[2026-08-10] all branches', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    const mainSnap = renderSnapshot(store, { cwd, branch: 'main' })
    expect(mainSnap).toContain('main only')
    const devSnap = renderSnapshot(store, { cwd, branch: 'dev' })
    expect(devSnap).not.toContain('main only')
    expect(devSnap).toContain('all branches')
  })

  it('handles null cwd gracefully — no key section, no crash', () => {
    store.add('memory', '[2026-08-10] global')
    const text = renderSnapshot(store, { cwd: null })
    expect(text).toContain('global')
    expect(text).not.toContain('Project Key')
  })

  it('empty store still emits discipline note (never empty prompt)', () => {
    const text = renderSnapshot(store, { cwd: null })
    expect(text).toMatch(/End of every turn/i)
  })

  it('does not duplicate discipline note on repeated calls', () => {
    const a = renderSnapshot(store, { cwd })
    const b = renderSnapshot(store, { cwd })
    expect((a.match(/End of every turn/g) || []).length).toBe(1)
    expect((b.match(/End of every turn/g) || []).length).toBe(1)
  })

  it('branch undefined does not filter out any key entries', () => {
    store.add('key', '[2026-08-10] all', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    const text = renderSnapshot(store, { cwd }) // no branch
    expect(text).toContain('all')
    expect(text).toContain('main only') // no filter => all visible
  })

  it('integration: systemPrompt context text delegates to renderSnapshot', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
    expect(src).toContain('renderSnapshot')
    expect(src).toContain("name: 'memory:snapshot'")
    expect(src).toContain('order')
  })
})

describe('renderSnapshot per-track byte caps', () => {
  it('drops oldest memory entries first until under cap, always keeping the newest', () => {
    store.add('memory', '[2026-08-10] mem-oldest-AAA')
    store.add('memory', '[2026-08-10] mem-mid-BBB')
    store.add('memory', '[2026-08-10] mem-newest-CCC')
    const text = renderSnapshot(store, { cwd }, { caps: { memory: 40 } })
    expect(text).toContain('mem-newest-CCC')
    expect(text).not.toContain('mem-mid-BBB')
    expect(text).not.toContain('mem-oldest-AAA')
  })

  it('caps each section independently — other sections unaffected', () => {
    store.add('user', '[2026-08-10] usr-old-111')
    store.add('user', '[2026-08-10] usr-new-222')
    store.add('key', '[2026-08-10] key-old-333', cwd)
    store.add('key', '[2026-08-10] key-new-444', cwd)
    const text = renderSnapshot(store, { cwd }, { caps: { user: 40 } })
    expect(text).toContain('usr-new-222')
    expect(text).not.toContain('usr-old-111')
    expect(text).toContain('key-old-333') // default key cap leaves both
    expect(text).toContain('key-new-444')
  })

  it('always keeps the newest entry even when it alone exceeds the cap', () => {
    store.add('memory', '[2026-08-10] huge-single-DDD ' + 'x'.repeat(400))
    const text = renderSnapshot(store, { cwd }, { caps: { memory: 50 } })
    expect(text).toContain('huge-single-DDD')
  })

  it('oversize newest entry carrying [summary:] renders as its compact head only', () => {
    store.add('key', '[2026-08-10] [summary:key-short-summary] ' + 'z'.repeat(600), cwd)
    const text = renderSnapshot(store, { cwd }, { caps: { key: 80 } })
    expect(text).toContain('[summary:key-short-summary]')
    expect(text).not.toContain('zzzzzzzzzz')
  })

  it('caps override is partial — unspecified sections keep defaults', () => {
    store.add('user', '[2026-08-10] usr-default-555')
    store.add('user', '[2026-08-10] usr-default-666')
    store.add('memory', '[2026-08-10] mem-old-777')
    store.add('memory', '[2026-08-10] mem-new-888')
    const text = renderSnapshot(store, { cwd }, { caps: { memory: 40 } })
    expect(text).toContain('usr-default-555') // default user cap (4096) keeps both
    expect(text).toContain('usr-default-666')
    expect(text).not.toContain('mem-old-777')
    expect(text).toContain('mem-new-888')
  })
})
