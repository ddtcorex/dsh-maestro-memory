import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { repairAllTracks } from '../src/host/memory/repair-runner.ts'

const A = '[2026-08-24] alpha entry body'
const B = '[2026-09-01] beta entry body'
const C = '[2026-09-02] gamma entry body'

let root: string
let store: MaestroMemoryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-repair-runner-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('MaestroMemoryStore.repairFile', () => {
  it('backs up, rewrites a glued file and reports the plan', async () => {
    const file = join(root, 'MEMORY.md')
    await writeFile(file, `${A}\n${B}\n§\n${A}\n`, 'utf8')

    const res = store.repairFile(file)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.before).toBe(2)
    expect(res.after).toBe(2)
    expect(res.split).toBe(1)
    expect(res.deduped).toBe(1)
    expect(res.backup).toBeTruthy()
    expect(await readFile(file, 'utf8')).toBe(`${A}\n§\n${B}\n`)
  })

  it('is a no-op on a clean file and writes no backup', async () => {
    const file = join(root, 'USER.md')
    await writeFile(file, `${A}\n§\n${B}\n`, 'utf8')
    const res = store.repairFile(file)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changed).toBe(false)
    expect(res.backup).toBeNull()
  })

  it('treats a missing file as a no-op', () => {
    const res = store.repairFile(join(root, 'does-not-exist.md'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changed).toBe(false)
  })
})

describe('repairAllTracks', () => {
  it('repairs global, user, daily, project and key files in one pass', async () => {
    await writeFile(join(root, 'MEMORY.md'), `${A}\n${B}\n`, 'utf8')
    await writeFile(join(root, 'USER.md'), `${A}\n${A}\n`, 'utf8')
    await mkdir(join(root, 'daily'), { recursive: true })
    await writeFile(join(root, 'daily', '2026-09-14.md'), `${B}\n${C}\n`, 'utf8')
    await mkdir(join(root, 'projects', 'abc123abc123'), { recursive: true })
    await writeFile(join(root, 'projects', 'abc123abc123', 'KEY.md'), `${A}\n${C}\n`, 'utf8')
    await writeFile(join(root, 'projects', 'abc123abc123', 'MEMORY.md'), `${B}\n${B}\n`, 'utf8')

    const report = repairAllTracks(root, { dryRun: false })
    expect(report.files).toBe(5)
    expect(report.changed).toBe(5)
    expect(report.split).toBe(5)
    expect(report.deduped).toBe(2)
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe(`${A}\n§\n${B}\n`)
  })

  it('changes nothing on disk when dryRun is set', async () => {
    const raw = `${A}\n${B}\n`
    await writeFile(join(root, 'MEMORY.md'), raw, 'utf8')
    const report = repairAllTracks(root, { dryRun: true })
    expect(report.changed).toBe(1)
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toBe(raw)
  })

  it('is idempotent: a second pass reports zero changes', async () => {
    await writeFile(join(root, 'MEMORY.md'), `${A}\n${B}\n`, 'utf8')
    repairAllTracks(root, { dryRun: false })
    expect(repairAllTracks(root, { dryRun: false }).changed).toBe(0)
  })
})
