import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshotWithStats, SNAPSHOT_SECTION_MAX_ENTRIES } from '../src/host/prompt/snapshot.ts'
import { globalMemoryPath } from '../src/host/storage/layout.ts'

const cwd = '/tmp/caps-project'
let root: string
let store: MaestroMemoryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-caps-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('entry-count caps', () => {
  it('never renders more memory entries than the section allows', () => {
    for (let i = 0; i < 20; i++) store.add('memory', `small entry ${i}`, undefined)
    const { text, stats } = renderSnapshotWithStats(store, { cwd })
    const memory = stats.sections.find((s) => s.key === 'memory')!
    expect(memory.entries).toBe(SNAPSHOT_SECTION_MAX_ENTRIES.memory)
    expect(memory.dropped).toBe(20 - SNAPSHOT_SECTION_MAX_ENTRIES.memory)
    expect(text.match(/# Global Memory/g)).toHaveLength(1)
  })
})

describe('oversize ceiling', () => {
  it('truncates an untagged newest entry that exceeds twice the cap, and counts it', async () => {
    // Written straight to the file on purpose: `add()` auto-summarizes, so an
    // untagged oversize entry can only reach the store from a pre-summary file
    // (or a direct append) — which is exactly the case that used to own the
    // whole section silently.
    await writeFile(globalMemoryPath(root), `[2026-08-24] huge ${'x'.repeat(9000)}\n`, 'utf8')
    const { stats } = renderSnapshotWithStats(store, { cwd })
    const memory = stats.sections.find((s) => s.key === 'memory')!
    expect(memory.truncated).toBe(1)
    expect(memory.bytes).toBeLessThanOrEqual(memory.cap * 2)
  })

  it('keeps a tagged oversize entry whole by compacting it to head + summary', () => {
    store.add('memory', `tagged oversize ${'y'.repeat(9000)} [summary:tagged oversize body]`, undefined)
    const { text, stats } = renderSnapshotWithStats(store, { cwd })
    const memory = stats.sections.find((s) => s.key === 'memory')!
    expect(memory.truncated).toBe(0)
    expect(text).toContain('[summary:tagged oversize body]')
    expect(text).not.toContain('y'.repeat(200))
  })
})
