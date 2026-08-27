import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { parseEntries, serializeEntries, isCanonical } from '../src/host/storage/legacy-format.ts'
import {
  projectHash,
  legacyProjectHash,
  resolveMemoryRoot,
  globalMemoryPath,
  userMemoryPath,
  dailyPath,
  dailyDir,
  projectDir,
  projectMemoryPath,
  projectKeyPath,
  lifeTodoPath,
  workTodoPath,
  projectTodoPath,
  dailyTodoPath,
  globalArchivePath,
  userArchivePath,
  projectKeyArchivePath,
  todoArchivePath,
  maestroMetaDir,
  schemaPath,
  journalPath,
  backupsDir,
  backupManifestPath,
  backupFilesDirPath,
  allMemoryPaths,
  allTodoPaths,
  allArchivePaths,
  allMetadataPaths,
} from '../src/host/storage/layout.ts'
import { isDuplicate, stripEntryId } from '../src/host/storage/atomic-store.ts'

describe('legacy-format', () => {
  it('parses § entries', () => {
    const raw = 'a\n§\nb\n§\nc\n'
    expect(parseEntries(raw)).toEqual(['a', 'b', 'c'])
  })
  it('serializes canonically', () => {
    const entries = ['a', 'b']
    const raw = serializeEntries(entries)
    expect(isCanonical(raw)).toBe(true)
    expect(parseEntries(raw)).toEqual(entries)
  })
  it('empty is canonical', () => {
    expect(isCanonical('')).toBe(true)
    expect(isCanonical('   ')).toBe(true)
  })
})

describe('layout', () => {
  it('hashes cwd deterministically (sha1 slice)', () => {
    const cwd = '/tmp/foo'
    const expected = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
    const h = projectHash(cwd)
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(h).toBe(expected)
    expect(projectHash(cwd)).toBe(h)
    expect(legacyProjectHash(cwd)).toBe(h)
  })
  it('throws on empty cwd', () => {
    expect(() => projectHash('')).toThrow()
    expect(() => legacyProjectHash('')).toThrow()
    expect(() => projectDir('/root', '')).toThrow()
  })
  it('resolves root default', () => {
    expect(resolveMemoryRoot(null as any)).toMatch(/\.dsh\/memories/)
    expect(resolveMemoryRoot('/custom')).toBe('/custom')
  })
  it('resolves five memory files', () => {
    const root = '/mem'
    const cwd = '/home/user/proj'
    const date = '2026-08-24'
    const hash = projectHash(cwd)
    expect(globalMemoryPath(root)).toBe(join(root, 'MEMORY.md'))
    expect(userMemoryPath(root)).toBe(join(root, 'USER.md'))
    expect(dailyPath(root, date)).toBe(join(root, 'daily', `${date}.md`))
    expect(projectMemoryPath(root, cwd)).toBe(join(root, 'projects', hash, 'MEMORY.md'))
    expect(projectKeyPath(root, cwd)).toBe(join(root, 'projects', hash, 'KEY.md'))
    // aggregated
    const all = allMemoryPaths(root, cwd, date)
    expect(all).toEqual({
      memory: globalMemoryPath(root),
      user: userMemoryPath(root),
      daily: dailyPath(root, date),
      project: projectMemoryPath(root, cwd),
      key: projectKeyPath(root, cwd),
    })
  })
  it('resolves four todo files', () => {
    const root = '/mem'
    const cwd = '/home/user/proj'
    const date = '2026-08-24'
    const hash = projectHash(cwd)
    expect(lifeTodoPath(root)).toBe(join(root, 'TODOS-life.md'))
    expect(workTodoPath(root)).toBe(join(root, 'TODOS-work.md'))
    expect(projectTodoPath(root, cwd)).toBe(join(root, 'projects', hash, 'TODOS.md'))
    expect(dailyTodoPath(root, date)).toBe(join(root, 'daily', `${date}.todo.md`))
    const all = allTodoPaths(root, cwd, date)
    expect(all).toEqual({
      life: lifeTodoPath(root),
      work: workTodoPath(root),
      project: projectTodoPath(root, cwd),
      daily: dailyTodoPath(root, date),
    })
  })
  it('resolves archives', () => {
    const root = '/mem'
    const cwd = '/home/user/proj'
    const hash = projectHash(cwd)
    expect(globalArchivePath(root)).toBe(join(root, 'MEMORY-archive.md'))
    expect(userArchivePath(root)).toBe(join(root, 'USER-archive.md'))
    expect(projectKeyArchivePath(root, cwd)).toBe(join(root, 'projects', hash, 'KEY-archive.md'))
    expect(todoArchivePath(root)).toBe(join(root, 'TODO-archive.md'))
    const all = allArchivePaths(root, cwd)
    expect(all).toEqual({
      memory: globalArchivePath(root),
      user: userArchivePath(root),
      key: projectKeyArchivePath(root, cwd),
      todo: todoArchivePath(root),
    })
  })
  it('resolves metadata', () => {
    const root = '/mem'
    expect(maestroMetaDir(root)).toBe(join(root, '.maestro-memory'))
    expect(schemaPath(root)).toBe(join(root, '.maestro-memory', 'schema.json'))
    expect(journalPath(root)).toBe(join(root, '.maestro-memory', 'migration-journal.jsonl'))
    expect(backupsDir(root)).toBe(join(root, '.maestro-memory', 'backups'))
    const runId = '20260824T120000Z'
    expect(backupManifestPath(root, runId)).toBe(join(root, '.maestro-memory', 'backups', runId, 'manifest.json'))
    expect(backupFilesDirPath(root, runId)).toBe(join(root, '.maestro-memory', 'backups', runId, 'files'))
    const meta = allMetadataPaths(root, runId)
    expect(meta.schema).toBe(schemaPath(root))
    expect(meta.journal).toBe(journalPath(root))
    expect(meta.backupManifest).toBe(backupManifestPath(root, runId))
  })
  it('daily dir', () => {
    expect(dailyDir('/mem')).toBe(join('/mem', 'daily'))
  })
  it('pure: same inputs same outputs, no side effects', () => {
    const root = '/a'
    const cwd = '/b/c'
    const date = '2026-01-02'
    const first = allMemoryPaths(root, cwd, date)
    const second = allMemoryPaths(root, cwd, date)
    expect(first).toEqual(second)
    expect(first).not.toBe(second) // new object each call, pure
  })
  it('throws on missing cwd for project paths', () => {
    expect(() => projectMemoryPath('/mem', '' as any)).toThrow()
    expect(() => projectKeyPath('/mem', '' as any)).toThrow()
    expect(() => projectTodoPath('/mem', '' as any)).toThrow()
    expect(() => projectKeyArchivePath('/mem', '' as any)).toThrow()
  })
})

describe('atomic-store duplicates', () => {
  it('detects duplicate after stripping id', () => {
    const entries = ['[id: abcdef12] hello', 'world']
    expect(isDuplicate(entries, '[id: 12345678] hello')).toBe(true)
    expect(isDuplicate(entries, 'hello')).toBe(true)
    expect(isDuplicate(entries, 'other')).toBe(false)
  })
  it('strip id', () => {
    expect(stripEntryId('[id: abcdef12] hi')).toBe('hi')
  })
})
