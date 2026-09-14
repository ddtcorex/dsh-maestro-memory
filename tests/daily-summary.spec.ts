import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshotWithStats } from '../src/host/prompt/snapshot.ts'

let root: string
let store: MaestroMemoryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-daily-summary-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('daily auto-summary', () => {
  it('appends a summary tag to a new daily entry', () => {
    const body = 'implemented the repair planner and wired it at boot'
    const res = store.add('daily', body, undefined)
    expect(res.ok).toBe(true)
    const entries = store.list('daily')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toContain(body)
    expect(entries[0]).toMatch(/\[summary:.+\]/)
  })

  it('does not double-tag an entry that already has a summary', () => {
    store.add('daily', 'first body [summary:kept]', undefined)
    const entry = store.list('daily')[0]
    expect(entry.match(/\[summary:/g)).toHaveLength(1)
    expect(entry).toContain('[summary:kept]')
  })

  it('lets the Recent Daily section compact an oversize entry', () => {
    store.add('daily', `long daily entry ${'z'.repeat(3000)}`, undefined)
    const { stats } = renderSnapshotWithStats(store, { cwd: null })
    const daily = stats.sections.find((s) => s.key === 'recentDaily')
    expect(daily).toBeDefined()
    expect(daily!.bytes).toBeLessThanOrEqual(512 * 2)
    expect(daily!.truncated).toBe(0)
  })
})
