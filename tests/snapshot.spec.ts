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

  it('bounded: includes USER+MEMORY+KEY, project via auto-recall (top-4), recent daily (512B) may include daily', () => {
    store.add('memory', '[2026-08-10] global')
    store.add('user', '[2026-08-10] user')
    store.add('key', '[2026-08-10] key entry', cwd)
    store.add('daily', '[08:30] daily log')
    store.add('project', '[2026-08-10 10:00] project log', cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('global')
    expect(text).toContain('user')
    expect(text).toContain('key entry')
    // project injected only via bounded auto-recall (top-4, 600 chars each under Project Context)
    expect(text).toContain('Project Context')
    expect(text).toContain('project log')
    // recent daily: if today's daily exists, it appears under Recent Daily
    expect(text).toContain('Recent Daily')
    expect(text).toContain('daily log')
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

  it('auto-recall: newest 4 project entries appear (oldest dropped)', () => {
    for (let i = 1; i <= 5; i++) store.add('project', `[2026-08-10] proj-${i} short`, cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('Project Context')
    expect(text).not.toContain('proj-1') // oldest dropped (top-4)
    expect(text).toContain('proj-2')
    expect(text).toContain('proj-5')
  })
  it('auto-recall: each entry truncated to 600 chars', () => {
    store.add('project', `[2026-08-10] long-entry ` + 'x'.repeat(700), cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('Project Context')
    expect(text).not.toContain('x'.repeat(601))
  })
})

describe('renderSnapshot prompt-template safety', () => {
  // DSH interpolates every prompt context before it reaches the model
  // (@deepseek-ai/dsh-system-prompt interpolate()) and fails the whole turn on a
  // {{name}} group whose name is malformed or unregistered. Memory entries are
  // free-form prose that may quote a template language, so the rendered snapshot
  // must never contain a literal {{ at all — that is the exact trigger.
  it('collapses double-brace runs across every injected section', () => {
    store.add('memory', '[2026-09-11] global {{global_var}}')
    store.add('user', '[2026-09-11] user {{user_var}}')
    store.add('key', '[2026-09-11] key {{...}} literal', cwd)
    store.add('project', '[2026-09-11] project {{cwd}}', cwd)
    store.add('daily', '[09:00] daily {{release_path}}')
    const text = renderSnapshot(store, { cwd })
    expect(text).not.toContain('{{')
    expect(text).toContain('{...}') // readable single-brace form survives
    expect(text).toContain('{global_var}')
  })

  it('collapses nested brace runs without leaving an adjacent pair', () => {
    store.add('key', '[2026-09-11] {{{triple}}} plus {{a}} {{b}}', cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).not.toContain('{{')
    expect(text).toContain('{triple}')
    expect(text).toContain('{a} {b}')
  })
})
