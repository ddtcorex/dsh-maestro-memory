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
})
