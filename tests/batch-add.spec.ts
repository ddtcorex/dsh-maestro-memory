import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { applyBatch } from '../src/host/memory/batch.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/demo-project'

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'batch-')); store = new MaestroMemoryStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('applyBatch', () => {
  it('adds all entries sequentially across tracks and returns ids in order', () => {
    const res = applyBatch(store, [
      { target: 'daily', content: '[08:30] morning log' },
      { target: 'project', content: '[2026-08-26] did the thing', cwd },
      { target: 'memory', content: '[2026-08-26] global note' },
    ])
    expect(res).toMatchObject({ ok: true })
    if (res.ok) {
      expect(res.ids).toHaveLength(3)
      // key issues ids; other tracks are stored verbatim without [id:] tokens
      expect(res.ids.every((id) => id === undefined || /^[0-9a-f]{8}$/.test(id))).toBe(true)
    }
    expect(store.list('daily')).toEqual([expect.stringContaining('morning log')])
    expect(store.list('project', cwd)).toEqual([expect.stringContaining('did the thing')])
    expect(store.list('memory')).toEqual([expect.stringContaining('global note')])
  })

  it('fails atomically on empty content — earlier adds are rolled back', () => {
    const res = applyBatch(store, [
      { target: 'daily', content: '[08:30] first ok' },
      { target: 'project', content: '   ', cwd }, // whitespace-only fails store.add
    ])
    expect(res).toMatchObject({ ok: false, index: 1 })
    if (!res.ok) expect(res.error).toContain('empty')
    expect(store.list('daily')).toEqual([]) // rolled back
  })

  it('rejects unknown targets before touching storage', () => {
    const res = applyBatch(store, [
      { target: 'bogus-track', content: '[x] nope' },
    ])
    expect(res).toMatchObject({ ok: false, index: 0 })
    if (!res.ok) expect(res.error).toContain('unknown target')
  })

  it('rolls back multiple prior adds when a later entry fails', () => {
    const res = applyBatch(store, [
      { target: 'daily', content: '[08:30] a' },
      { target: 'memory', content: '[2026-08-26] b' },
      { target: 'user', content: '' }, // fails
    ])
    expect(res).toMatchObject({ ok: false, index: 2 })
    expect(store.list('daily')).toEqual([])
    expect(store.list('memory')).toEqual([])
  })

  it('duplicate detection still succeeds without inventing rollback ids', () => {
    store.add('memory', '[2026-08-26] dup me')
    const res = applyBatch(store, [{ target: 'memory', content: '[2026-08-26] dup me' }])
    expect(res).toMatchObject({ ok: true })
    if (res.ok) expect(res.ids[0]).toBeUndefined()
    // exactly one copy remains
    expect(store.list('memory')).toHaveLength(1)
  })

  it('empty batch succeeds trivially', () => {
    expect(applyBatch(store, [])).toEqual({ ok: true, ids: [] })
  })

  it('per-entry options (cwd/date/branches/summary) are honored', () => {
    const res = applyBatch(store, [
      { target: 'daily', content: '[09:00] dated', date: '2026-01-02' },
      { target: 'key', content: '[2026-08-26] keyed', cwd, branches: 'main,dev', summary: 'one-liner' },
    ])
    expect(res).toMatchObject({ ok: true })
    expect(store.list('daily', undefined, { date: '2026-01-02' })).toEqual([expect.stringContaining('dated')])
    expect(store.list('key', cwd)).toEqual([expect.stringContaining('keyed')])
    expect(store.list('key', cwd)[0]).toContain('[summary:one-liner]')
    expect(store.list('key', cwd)[0]).toContain('[branch:')
  })
})
