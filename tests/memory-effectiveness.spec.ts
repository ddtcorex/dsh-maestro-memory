import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshot } from '../src/host/prompt/snapshot.ts'
import { resolveMemoryRoot, projectKeyPath, projectDir, projectReferencePath } from '../src/host/storage/layout.ts'
import { parseEntries } from '../src/host/storage/legacy-format.ts'
import { readEntriesSync } from '../src/host/storage/atomic-store.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/test-project-key'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-effectiveness-'))
  store = new MaestroMemoryStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('memory effectiveness: KEY delimiter', () => {
  it('add() writes KEY entry with canonical format (no § glued to content)', () => {
    const res = store.add('key', 'test invariant', cwd, { summary: 'test', branches: 'main' })
    expect(res.ok).toBe(true)

    const keyFile = projectKeyPath(root, cwd)
    const content = readFileSync(keyFile, 'utf8')
    // Single entry: ends with newline, no § delimiter needed
    // Multiple entries: joined by \n§\n
    expect(content).toMatch(/\n$/)
    expect(content).not.toMatch(/[^\n]§\n/) // no § glued to content
  })

  it('add() writes multiple KEY entries with \\n§\\n delimiter', () => {
    store.add('key', 'invariant one', cwd, { summary: 's1' })
    store.add('key', 'invariant two', cwd, { summary: 's2' })
    const keyFile = projectKeyPath(root, cwd)
    const content = readFileSync(keyFile, 'utf8')
    // Two entries: must have canonical delimiter between them
    expect(content).toMatch(/\n§\n/)
    expect(content).not.toMatch(/[^\n]§\n/)
  })

  it('parseEntries reads KEY correctly after canonical writes', () => {
    store.add('key', 'invariant one', cwd, { summary: 's1' })
    store.add('key', 'invariant two', cwd, { summary: 's2' })
    const entries = store.list('key', cwd)
    expect(entries.length).toBeGreaterThanOrEqual(2)
    expect(entries[0]).toContain('invariant one')
    expect(entries[1]).toContain('invariant two')
  })
})

describe('memory effectiveness: KEY repair', () => {
  it('repairKeyDelimiter reads malformed §\\n and re-serializes canonical', () => {
    const keyFile = projectKeyPath(root, cwd)
    // Create directory and write malformed KEY.md (like current real file)
    mkdirSync(projectDir(root, cwd), { recursive: true })
    const malformed = [
      '[2026-08-23] [summary:First entry]',
      '[2026-08-24] [summary:Second entry]',
      '[2026-08-25] [summary:Third entry]'
    ].join('§\n') // malformed: §\\n instead of \\n§\\n
    writeFileSync(keyFile, malformed, 'utf8')

    // Before repair: parseEntries splits on \\n§\\n -> returns 1 big entry
    const before = readEntriesSync(keyFile)
    expect(before.length).toBe(1) // broken

    // Repair
    const res = store.repairKeyDelimiter(cwd)
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(3)

    // After repair: file is canonical (ends with newline, delimiter between entries)
    const afterContent = readFileSync(keyFile, 'utf8')
    expect(afterContent).toMatch(/\n$/)
    expect(afterContent).toMatch(/\n§\n/) // has delimiter between entries
    expect(afterContent).not.toMatch(/[^\n]§\n/) // no § glued to content

    // parseEntries now reads correctly
    const after = readEntriesSync(keyFile)
    expect(after.length).toBe(3)
    expect(after[0]).toContain('First entry')
    expect(after[1]).toContain('Second entry')
    expect(after[2]).toContain('Third entry')
  })

  it('repairKeyDelimiter handles empty file and already-canonical file', () => {
    const keyFile = projectKeyPath(root, cwd)
    mkdirSync(projectDir(root, cwd), { recursive: true })

    // Empty file
    writeFileSync(keyFile, '', 'utf8')
    let res = store.repairKeyDelimiter(cwd)
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(0)

    // Already canonical - re-serializes (no-op) but returns entry count
    writeFileSync(keyFile, 'entry1\n§\nentry2\n', 'utf8')
    res = store.repairKeyDelimiter(cwd)
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(2) // re-serializes 2 entries
  })
})

describe('memory effectiveness: REFERENCE.md slice in snapshot', () => {
  const cwdRef = '/tmp/test-ref-project'

  it('renderSnapshot includes bounded # Project Knowledge from REFERENCE.md', () => {
    const refFile = projectReferencePath(root, cwdRef)
    mkdirSync(projectDir(root, cwdRef), { recursive: true })
    writeFileSync(refFile, '# Reference\n\n## Rule 1\nNever edit deepseek-harness.\n\n## Rule 2\nAlways use plugins.\n', 'utf8')

    const snap = renderSnapshot(store, { cwd: cwdRef, sessionId: 'test' })
    expect(snap).toContain('# Project Knowledge')
    expect(snap).toContain('Never edit deepseek-harness')
    // Bounded: total snapshot reasonable
    expect(Buffer.byteLength(snap, 'utf8')).toBeLessThan(15000)
  })

  it('renderSnapshot omits # Project Knowledge when REFERENCE.md absent', () => {
    const snap = renderSnapshot(store, { cwd: '/tmp/nonexistent-project-xyz', sessionId: 'test' })
    expect(snap).not.toContain('# Project Knowledge')
  })
})