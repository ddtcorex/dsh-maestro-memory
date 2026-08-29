import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { resolveMemoryRoot, dailyPath, projectMemoryPath, projectKeyPath, globalMemoryPath, userMemoryPath } from '../src/host/storage/layout.ts'
import { parseEntries } from '../src/host/storage/legacy-format.ts'
import { readEntriesSync } from '../src/host/storage/atomic-store.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/demo-project'
const otherCwd = '/tmp/other-project'

// Local calendar date — the memory store stamps daily entries with the local
// date (not UTC), so the test must read it the same way.
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-m2-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('M2 daily/project tracks', () => {
  it('creates daily and project files at correct layout paths', () => {
    store.add('daily', '[08:30] daily entry', undefined)
    store.add('project', '[2026-08-10 10:00] project entry', cwd)
    store.add('key', '[2026-08-10] key entry', cwd)
    store.add('memory', '[2026-08-10] global entry')
    store.add('user', '[2026-08-10] user entry')
    const today = todayStr()
    expect(existsSync(dailyPath(root, today))).toBe(true)
    expect(existsSync(projectMemoryPath(root, cwd))).toBe(true)
    expect(existsSync(projectKeyPath(root, cwd))).toBe(true)
    expect(existsSync(globalMemoryPath(root))).toBe(true)
    expect(existsSync(userMemoryPath(root))).toBe(true)
  })

  it('daily and project list isolated by cwd/date', () => {
    const r = store.add('project', 'proj A content', cwd)
    expect(r.ok).toBe(true)
    store.add('project', 'proj B content', otherCwd)
    expect(store.list('project', cwd)).toEqual(expect.arrayContaining([expect.stringContaining('proj A')]))
    expect(store.list('project', cwd)).not.toEqual(expect.arrayContaining([expect.stringContaining('proj B')]))
    expect(store.list('project', otherCwd)).toEqual(expect.arrayContaining([expect.stringContaining('proj B')]))
  })
})

describe('M2 date/content query', () => {
  it('filter substring case-insensitive', () => {
    store.add('memory', '[2026-08-10] Hello World')
    store.add('memory', '[2026-08-11] other content')
    const filtered = store.list('memory', undefined, { filter: 'hello' })
    expect(filtered.length).toBe(1)
    expect(filtered[0]).toContain('Hello World')
  })

  it('since/until date range filters', () => {
    store.add('memory', '[2026-08-10] first')
    store.add('memory', '[2026-08-12] second')
    store.add('memory', '[2026-08-15] third')
    const range = store.list('memory', undefined, { since: '2026-08-11', until: '2026-08-13' })
    expect(range.length).toBe(1)
    expect(range[0]).toContain('second')
    // since only
    expect(store.list('memory', undefined, { since: '2026-08-12' }).length).toBe(2)
    // until only
    expect(store.list('memory', undefined, { until: '2026-08-11' }).length).toBe(1)
  })

  it('undated entries survive date filters', () => {
    // legacy-format empty canonical, but our entry without date
    store.add('memory', 'no date entry')
    store.add('memory', '[2026-08-10] dated')
    const filtered = store.list('memory', undefined, { since: '2026-08-12' })
    // undated should remain, dated beyond range removed except undated survives
    expect(filtered).toEqual(expect.arrayContaining([expect.stringContaining('no date')]))
  })

  it('recent and limit', () => {
    store.add('memory', '[2026-08-10] a')
    store.add('memory', '[2026-08-11] b')
    store.add('memory', '[2026-08-12] c')
    const recent = store.list('memory', undefined, { recent: true })
    expect(recent[0]).toContain('c')
    expect(recent[2]).toContain('a')
    const limited = store.list('memory', undefined, { limit: 2 })
    expect(limited.length).toBe(2)
    const recentLimited = store.list('memory', undefined, { recent: true, limit: 2 })
    expect(recentLimited.length).toBe(2)
    expect(recentLimited[0]).toContain('c')
  })

  it('daily cross-file since/until spans multiple files', async () => {
    // Write daily files directly for two dates
    const today = new Date().toISOString().slice(0, 10)
    const oldDate = '2026-08-01'
    const middleDate = '2026-08-05'
    // use store.addDaily helper or direct write
    // We'll write via atomic store directly to control date
    mkdirSync(join(root, 'daily'), { recursive: true })
    writeFileSync(dailyPath(root, oldDate), '[08:00] old entry\n')
    writeFileSync(dailyPath(root, middleDate), '[08:00] middle entry\n')
    writeFileSync(dailyPath(root, today), '[08:00] today entry\n')
    const range = store.list('daily', undefined, { since: '2026-08-04', until: '2026-08-06' })
    expect(range.length).toBe(1)
    expect(range[0]).toContain('middle')
    const sinceOnly = store.list('daily', undefined, { since: '2026-08-04' })
    // should include middle and today (old excluded)
    expect(sinceOnly.length).toBe(2)
  })
})

describe('M2 unique replace/remove', () => {
  it('replace requires unique match (0 hits fails, >1 fails)', () => {
    store.add('memory', '[2026-08-10] unique entry one')
    store.add('memory', '[2026-08-10] other')
    // zero hits
    expect(store.replace('memory', 'nope', 'new').ok).toBe(false)
    // ambiguous
    store.add('memory', '[2026-08-10] duplicate foo')
    store.add('memory', '[2026-08-11] duplicate foo bar')
    const amb = store.replace('memory', 'duplicate foo', 'new content')
    expect(amb.ok).toBe(false)
    // unique success
    const ok = store.replace('memory', 'unique entry one', '[2026-08-10] replaced content')
    expect(ok.ok).toBe(true)
    const after = store.list('memory')
    expect(after.join(' ')).toContain('replaced')
  })

  it('remove requires unique match', () => {
    store.add('memory', '[2026-08-10] to-remove')
    const ok = store.remove('memory', 'to-remove')
    expect(ok.ok).toBe(true)
    expect(store.list('memory').join(' ')).not.toContain('to-remove')
    expect(store.remove('memory', 'nonexist').ok).toBe(false)
  })

  it('ambiguous remove fails', () => {
    store.add('memory', '[2026-08-10] same prefix one')
    store.add('memory', '[2026-08-11] same prefix two')
    const res = store.remove('memory', 'same prefix')
    expect(res.ok).toBe(false)
  })
})

describe('M2 archive-before-delete', () => {
  it('archive moves entry to archive file and removes from main', () => {
    store.add('memory', '[2026-08-10] to archive')
    const before = store.list('memory')
    expect(before.length).toBe(1)
    const arch = store.archive('memory', 'to archive')
    expect(arch.ok).toBe(true)
    expect(store.list('memory').length).toBe(0)
    const archived = store.listArchive('memory')
    expect(archived.length).toBe(1)
    expect(archived[0]).toContain('to archive')
  })

  it('archive only for memory/user/key', () => {
    expect(store.archive('daily' as any, 'x').ok).toBe(false)
    expect(store.archive('project' as any, 'x').ok).toBe(false)
  })

  it('archive fails when ambiguous or missing', () => {
    store.add('memory', '[2026-08-10] dup')
    store.add('memory', '[2026-08-11] dup second')
    expect(store.archive('memory', 'dup').ok).toBe(false)
    expect(store.archive('memory', 'missing').ok).toBe(false)
  })

  it('key archive requires cwd and is per-project', () => {
    store.add('key', '[2026-08-10] key to archive', cwd)
    const res = store.archive('key', 'key to archive', cwd)
    expect(res.ok).toBe(true)
    expect(store.list('key', cwd).length).toBe(0)
    expect(store.listArchive('key', cwd).length).toBe(1)
    // other project not affected
    expect(store.listArchive('key', otherCwd).length).toBe(0)
  })
})

describe('M2 branch filter', () => {
  it('key entries with branch tag filtered by branch param', () => {
    store.add('key', '[2026-08-10] all branches entry', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    store.add('key', '[2026-08-10] dev only', cwd, { branches: 'dev' })
    store.add('key', '[2026-08-10] both', cwd, { branches: 'main,dev' })

    const allForMain = store.list('key', cwd, { branch: 'main' })
    expect(allForMain.length).toBe(3) // all + main + both
    expect(allForMain.join(' ')).toContain('main only')
    expect(allForMain.join(' ')).not.toContain('dev only')
    expect(allForMain.join(' ')).toContain('both')

    const allForDev = store.list('key', cwd, { branch: 'dev' })
    expect(allForDev.length).toBe(3) // all + dev + both

    const allForOther = store.list('key', cwd, { branch: 'feature' })
    expect(allForOther.length).toBe(1) // only all

    const noFilter = store.list('key', cwd)
    expect(noFilter.length).toBe(4)
  })
})

describe('M2 summary/expand', () => {
  it('add with summary creates entry with summary tag and id', () => {
    const res = store.add('key', '[2026-08-10] long content line one\nsecond line', cwd, { summary: 'short sum' })
    expect(res.ok).toBe(true)
    const entries = store.list('key', cwd)
    expect(entries.length).toBe(1)
    expect(entries[0]).toContain('[summary:short sum]')
    expect(entries[0]).toMatch(/\[id:[0-9a-f]{8}\]/)
  })

  it('expand by id returns full entry', () => {
    const res = store.add('key', '[2026-08-10] expandable content', cwd, { summary: 'sum' })
    const entries = store.list('key', cwd)
    const m = entries[0].match(/\[id:([0-9a-f]{8})\]/i)
    expect(m).not.toBeNull()
    const id = m![1]
    const exp = store.expand('key', id, cwd)
    expect(exp.ok).toBe(true)
    if (exp.ok) expect(exp.entry).toContain('expandable content')
  })

  it('expand fails for wrong id or wrong target', () => {
    expect(store.expand('key', 'deadbeef', cwd).ok).toBe(false)
    expect(store.expand('memory' as any, 'deadbeef', cwd).ok).toBe(false)
    expect(store.expand('key', '', cwd).ok).toBe(false)
  })

  it('summaryFor returns explicit or auto', () => {
    const withSum = '[2026-08-10] [summary:explicit] body text here'
    expect(store.summaryFor(withSum)).toBe('explicit')
    const without = '[2026-08-10] first line\nsecond line'
    expect(store.summaryFor(without)).toBe('first line')
  })
})

describe('M2 daily date param + always-id key', () => {
  it('daily add honors an explicit date (not only today)', () => {
    store.add('daily', '[08:00] dated entry', undefined, { date: '2026-08-15' })
    expect(existsSync(dailyPath(root, '2026-08-15'))).toBe(true)
    // today's file must NOT contain the dated entry
    const todayEntries = store.list('daily', undefined, { date: todayStr() })
    expect(todayEntries).not.toEqual(expect.arrayContaining([expect.stringContaining('dated entry')]))
    const dated = store.list('daily', undefined, { date: '2026-08-15' })
    expect(dated).toEqual(expect.arrayContaining([expect.stringContaining('dated entry')]))
  })

  it('daily list with date filter returns only that day', () => {
    store.add('daily', '[08:00] entry a', undefined, { date: '2026-08-01' })
    store.add('daily', '[08:00] entry b', undefined, { date: '2026-08-02' })
    const onlyFirst = store.list('daily', undefined, { date: '2026-08-01' })
    expect(onlyFirst.length).toBe(1)
    expect(onlyFirst[0]).toContain('entry a')
  })

  it('daily add rejects a non-YYYY-MM-DD date (path-traversal guard)', () => {
    const res = store.add('daily', '[08:00] bad', undefined, { date: '../../etc/passwd' })
    expect(res.ok).toBe(false)
  })

  it('daily remove targets an explicit date (not only today)', () => {
    store.add('daily', '[08:00] remove-me', undefined, { date: '2026-08-10' })
    // Today's file must be untouched by the dated remove.
    store.add('daily', '[08:00] keep-today', undefined)
    const res = store.remove('daily', 'remove-me', undefined, { date: '2026-08-10' })
    expect(res.ok).toBe(true)
    const dated = store.list('daily', undefined, { date: '2026-08-10' })
    expect(dated).not.toEqual(expect.arrayContaining([expect.stringContaining('remove-me')]))
    // the same-day entry is unscathed
    const today = store.list('daily', undefined, { date: todayStr() })
    expect(today).toEqual(expect.arrayContaining([expect.stringContaining('keep-today')]))
  })

  it('daily replace targets an explicit date (not only today)', () => {
    store.add('daily', '[08:00] original text', undefined, { date: '2026-08-11' })
    const res = store.replace('daily', 'original text', '[08:00] replaced text', undefined, { date: '2026-08-11' })
    expect(res.ok).toBe(true)
    const dated = store.list('daily', undefined, { date: '2026-08-11' })
    expect(dated).toEqual(expect.arrayContaining([expect.stringContaining('replaced text')]))
    expect(dated).not.toEqual(expect.arrayContaining([expect.stringContaining('original text')]))
  })

  it('daily remove/replace reject a non-YYYY-MM-DD date', () => {
    store.add('daily', '[08:00] target', undefined, { date: '2026-08-12' })
    const rm = store.remove('daily', 'target', undefined, { date: '../../etc/passwd' })
    expect(rm.ok).toBe(false)
    const rep = store.replace('daily', 'target', 'new', undefined, { date: '../../etc/passwd' })
    expect(rep.ok).toBe(false)
  })

  it('key add always emits an id (even without summary) so expand-by-id works', () => {
    const res = store.add('key', '[2026-08-10] plain key entry', cwd)
    expect(res.ok).toBe(true)
    expect(res).toHaveProperty('id')
    const entries = store.list('key', cwd)
    expect(entries[0]).toMatch(/\[id:[0-9a-f]{8}\]/)
    const exp = store.expand('key', res.id!, cwd)
    expect(exp.ok).toBe(true)
    if (exp.ok) expect(exp.entry).toContain('plain key entry')
  })
})

describe('M2 extend action/target unions', () => {
  it('store supports all five targets', () => {
    const targets: any[] = ['memory', 'user', 'daily', 'project', 'key']
    for (const t of targets) {
      const cw = t === 'project' || t === 'key' ? cwd : undefined
      const r = store.add(t, `[2026-08-10] test ${t}`, cw)
      expect(r.ok).toBe(true)
    }
  })

  it('host tool has extended enums', async () => {
    const host = await import('../src/host/index.ts')
    // Check that the module exports extended types via runtime tool definition
    // We verify by inspecting source for enum arrays
    const src = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
    expect(src).toContain(`'daily'`)
    expect(src).toContain(`'project'`)
    expect(src).toContain(`'key'`)
    expect(src).toContain(`'archive'`)
    expect(src).toContain(`'expand'`)
  })
})

describe('M2 keep project/daily logs out of snapshot', () => {
  it('snapshot excludes daily and project logs', () => {
    store.add('memory', '[2026-08-10] global')
    store.add('user', '[2026-08-10] user')
    store.add('daily', '[08:30] daily log')
    store.add('project', '[2026-08-10 10:00] project log', cwd)
    store.add('key', '[2026-08-10] key log', cwd)
    const snap = store.snapshot(cwd)
    expect(snap).toContain('global')
    expect(snap).toContain('user')
    expect(snap).toContain('key log')
    expect(snap).not.toContain('daily log')
    expect(snap).not.toContain('project log')
  })

  it('snapshot branch-filtered for key', () => {
    store.add('key', '[2026-08-10] all', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    const snapMain = store.snapshot(cwd, { branch: 'main' })
    expect(snapMain).toContain('all')
    expect(snapMain).toContain('main only')

    const snapDev = store.snapshot(cwd, { branch: 'dev' })
    expect(snapDev).toContain('all')
    expect(snapDev).not.toContain('main only')
  })
})

describe('M1 auto-date/summary hardening', () => {
  it('add(project, raw without date) injects today date', () => {
    const r = store.add('project', 'raw content without date', cwd)
    expect(r.ok).toBe(true)
    const entries = store.list('project', cwd)
    expect(entries[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}/)
  })
  it('add(project, date but no summary) injects summary', () => {
    store.add('project', '[2026-08-29] content without summary', cwd)
    const e = store.list('project', cwd)[0]
    expect(e).toMatch(/\[summary:/)
  })
  it('add with existing summary does not duplicate', () => {
    store.add('project', '[2026-08-29] content [summary:exists]', cwd)
    const e = store.list('project', cwd)[0]
    expect((e.match(/\[summary:/g) || []).length).toBe(1)
  })
  it('daily add still stores entry (date injected)', () => {
    store.add('daily', 'raw daily without date', undefined)
    const today = todayStr()
    const dailyEntries = store.list('daily', undefined, { date: today })
    expect(dailyEntries.length).toBeGreaterThan(0)
    expect(dailyEntries[0]).toMatch(/raw daily/)
  })
  it('replace without summary injects it', () => {
    store.add('project', '[2026-08-29] old content here [summary:old]', cwd)
    store.replace('project', 'old content here', '[2026-08-29] new without summary', cwd)
    const e = store.list('project', cwd)[0]
    expect(e).toMatch(/\[summary:/)
  })
  it('isDuplicate ignores summary difference', () => {
    store.add('project', '[2026-08-29] same body [summary:a]', cwd)
    const dup = store.add('project', '[2026-08-29] same body [summary:b]', cwd)
    expect(dup).toEqual(expect.objectContaining({ ok: true, duplicate: true }))
  })
})
