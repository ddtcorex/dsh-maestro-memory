import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { planArchive, DEFAULT_ARCHIVE_POLICY } from '../src/host/memory/maintenance.ts'
import { projectKeyArchivePath, projectKeyPath } from '../src/host/storage/layout.ts'

const cwd = '/tmp/maintenance-project'
let root: string
let store: MaestroMemoryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-maintenance-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('planArchive', () => {
  it('keeps the newest entries that fit the byte budget and archives the rest', () => {
    const entries = ['[2026-01-01] ' + 'a'.repeat(100), '[2026-02-01] ' + 'b'.repeat(100), '[2026-03-01] ' + 'c'.repeat(100)]
    const plan = planArchive(entries, { keepBytes: 260, maxAgeDays: 3650 }, new Date('2026-09-14'))
    // 3 × 113 B = 339 B > 260 B; two entries (226 B) fit. `keep` preserves file
    // order (oldest first), which is also the order an `applyArchive` rewrite keeps.
    expect(plan.keep).toEqual([entries[1], entries[2]])
    expect(plan.archive).toEqual([entries[0]])
    expect(plan.oldestKept).toBe(entries[1])
  })

  it('archives entries older than maxAgeDays regardless of size', () => {
    const old = '[2020-01-01] ancient entry'
    const fresh = '[2026-09-13] fresh entry'
    const plan = planArchive([old, fresh], { keepBytes: 1_000_000, maxAgeDays: 180 }, new Date('2026-09-14'))
    expect(plan.archive).toEqual([old])
    expect(plan.keep).toEqual([fresh])
  })

  it('never archives an undated entry on the age rule alone', () => {
    const undated = 'no date here'
    const plan = planArchive([undated], { keepBytes: 1_000_000, maxAgeDays: 1 }, new Date('2026-09-14'))
    expect(plan.keep).toEqual([undated])
    expect(plan.archive).toEqual([])
  })
})

describe('applyArchive', () => {
  it('moves entries to the archive file and leaves the live file canonical', async () => {
    store.add('key', 'old key entry ' + 'k'.repeat(200), cwd)
    store.add('key', 'new key entry', cwd)
    const live = projectKeyPath(root, cwd)
    const before = (await readFile(live, 'utf8')).split('\n§\n')

    const archived = before.slice(0, 1)
    const res = store.applyArchive('key', cwd, archived)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.archived).toBe(1)
    expect(res.backup).toBeTruthy()

    const after = await readFile(live, 'utf8')
    expect(after).not.toContain('old key entry')
    expect(after).toContain('new key entry')
    expect(await readFile(projectKeyArchivePath(root, cwd), 'utf8')).toContain('old key entry')
  })

  it('refuses an empty archive list', () => {
    const res = store.applyArchive('key', cwd, [])
    expect(res.ok).toBe(false)
  })
})

describe('DEFAULT_ARCHIVE_POLICY', () => {
  it('gives key a larger budget than memory', () => {
    expect(DEFAULT_ARCHIVE_POLICY.key.keepBytes).toBeGreaterThan(DEFAULT_ARCHIVE_POLICY.memory.keepBytes)
    expect(DEFAULT_ARCHIVE_POLICY.key.maxAgeDays).toBe(180)
  })
})
