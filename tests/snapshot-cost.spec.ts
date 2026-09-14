import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshot, renderSnapshotWithStats } from '../src/host/prompt/snapshot.ts'
import { createCostTracker } from '../src/host/cost-tracker.ts'

const cwd = '/tmp/cost-project'
let root: string
let store: MaestroMemoryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-cost-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('renderSnapshotWithStats', () => {
  it('reports one stat row per rendered section and a byte total', () => {
    store.add('memory', 'global entry body', undefined)
    store.add('user', 'user entry body', undefined)
    store.add('key', 'key entry body', cwd)
    const { text, stats } = renderSnapshotWithStats(store, { cwd })

    expect(text).toContain('# Global Memory')
    expect(text).toContain('# Project Key Memory')
    const keys = stats.sections.map((s) => s.key)
    expect(keys).toContain('memory')
    expect(keys).toContain('user')
    expect(keys).toContain('key')
    for (const s of stats.sections) {
      expect(s.bytes).toBeGreaterThan(0)
      expect(s.entries).toBeGreaterThan(0)
      expect(s.cap).toBeGreaterThan(0)
    }
    expect(stats.totalBytes).toBe(Buffer.byteLength(text, 'utf8'))
  })

  it('counts entries dropped by a section cap', () => {
    for (let i = 0; i < 12; i++) store.add('memory', `global entry number ${i} ${'x'.repeat(400)}`, undefined)
    const { stats } = renderSnapshotWithStats(store, { cwd })
    const memory = stats.sections.find((s) => s.key === 'memory')!
    expect(memory.dropped).toBeGreaterThan(0)
  })

  it('renderSnapshot still returns the bare string', () => {
    store.add('memory', 'global entry body', undefined)
    const text = renderSnapshot(store, { cwd })
    expect(typeof text).toBe('string')
    expect(text.startsWith('# Global Memory')).toBe(true)
  })
})

describe('createCostTracker', () => {
  it('keeps a bounded window and reports medians', () => {
    const tracker = createCostTracker(3)
    for (const n of [10, 20, 30, 40]) {
      tracker.record({ totalBytes: n, sections: [{ key: 'memory', cap: 100, bytes: n, entries: 1, dropped: 0 }], renderedAt: n })
    }
    const summary = tracker.snapshot()
    expect(summary.samples).toBe(3)
    expect(summary.medianTotalBytes).toBe(30)
    expect(summary.maxTotalBytes).toBe(40)
    expect(summary.medianBySection.memory).toBe(30)
  })

  it('reports an empty summary before the first render', () => {
    const summary = createCostTracker().snapshot()
    expect(summary.samples).toBe(0)
    expect(summary.last).toBeNull()
  })
})
