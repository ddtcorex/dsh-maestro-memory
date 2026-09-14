import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { isDuplicate, parseEntries, serializeEntries, isCanonical } from '../src/host/storage/atomic-store.ts'
import { planRepair } from '../src/host/storage/repair.ts'
import { mergeMemoryEntries } from '../src/host/sync/merge.ts'

const cwd = '/tmp/invariants-project'
let root: string
let store: MaestroMemoryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-invariants-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('isDuplicate — one notion of equality', () => {
  it('ignores the id prefix', () => {
    expect(isDuplicate(['[id:deadbeef] same body'], 'same body')).toBe(true)
  })

  it('ignores a differing summary tag', () => {
    expect(isDuplicate(['same body [summary:short]'], 'same body [summary:a much longer summary]')).toBe(true)
  })

  it('does not merge different bodies', () => {
    expect(isDuplicate(['same body'], 'other body')).toBe(false)
  })
})

describe.each([
  ['memory', undefined],
  ['user', undefined],
  ['daily', undefined],
  ['project', cwd],
  ['key', cwd],
] as const)('add() dedupe on the %s track', (target, targetCwd) => {
  it('rejects a re-add of the same body and keeps one entry on disk', () => {
    const body = `invariant probe ${target}`
    const first = store.add(target as any, body, targetCwd as any)
    expect(first.ok).toBe(true)
    const second = store.add(target as any, body, targetCwd as any)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.duplicate).toBe(true)
    const list = store.list(target as any, targetCwd as any)
    expect(list.filter((e) => e.includes(body))).toHaveLength(1)
  })
})

describe('round-trip invariant', () => {
  it('a repaired file is canonical and reparses to the same entries', () => {
    const glued = '[2026-08-24] alpha\n[2026-09-01] beta\n§\n[2026-08-24] alpha\n'
    const plan = planRepair(glued)
    expect(isCanonical(plan.text)).toBe(true)
    expect(parseEntries(plan.text)).toEqual([...plan.entries])
    expect(serializeEntries(parseEntries(plan.text))).toBe(plan.text)
  })

  it('planRepair is idempotent', () => {
    const once = planRepair('[2026-08-24] alpha\n[2026-09-01] beta\n')
    expect(planRepair(once.text).changed).toBe(false)
    expect(planRepair(once.text).entries).toEqual(once.entries)
  })
})

describe('mergeMemoryEntries — summary-variant duplicates (F9)', () => {
  it('keeps one entry when only the [summary:…] tag differs', () => {
    const body = '[2026-09-14 06:30] incident lesson about the meta CI range'
    const res = mergeMemoryEntries({
      track: 'memory',
      local: [body],
      remote: [`${body} [summary:incident lesson about the meta CI range]`],
    })
    expect(res.merged).toHaveLength(1)
  })

  it('still keeps two entries when the bodies genuinely differ', () => {
    const res = mergeMemoryEntries({
      track: 'memory',
      local: ['[2026-09-14 06:30] first lesson'],
      remote: ['[2026-09-14 06:31] second lesson'],
    })
    expect(res.merged).toHaveLength(2)
  })
})
