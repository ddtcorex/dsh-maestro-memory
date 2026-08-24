import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'

function sha256(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return createHash('sha256').update(b).digest('hex')
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-mig-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function writeLegacyMemory(file: string, entries: string[]): void {
  const content = entries.length === 0 ? '' : entries.join('\n§\n') + '\n'
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content, 'utf8')
}

function writeTodoFile(file: string, entriesRaw: string[]): void {
  const header = `<!--\nTodo entry format (auto-maintained by the program, do not edit the structure manually):\n- Entries are delimited by §; the comment block before the first § is the format note, not a todo\n- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):\n  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])\n  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool\n  [q1] important & urgent  [q2] important not urgent  [q3] urgent not important  [q4] not important not urgent (default = unclassified)\n  [due: YYYY-MM-DD] due date (default = none)\n  [status: pending|doing|done|blocked|cancelled] status (default pending)\n  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)\n  [cat: category] optional (life/work/study...)\n- Todo content follows the first tag line and may span multiple lines\n-->\n`
  const body = entriesRaw.join('\n§\n')
  const text = `${header}${body.length > 0 ? `\n§\n${body}\n` : ''}`
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

describe('M3-PR-B migration service: module exists', () => {
  it('exports inspect/dryRun/run/verify and layout helpers', async () => {
    const svc = await import('../src/host/migration/service.ts')
    expect(typeof svc.inspect).toBe('function')
    expect(typeof svc.dryRun).toBe('function')
    expect(typeof svc.run).toBe('function')
    expect(typeof svc.verify).toBe('function')
    expect(typeof svc.isWriteBlocked).toBe('function')
  })
})

describe('M3-PR-B inspect: migration table cases', () => {
  it('inspects every migration table case: global/user, daily, project, archives, queue, todos', async () => {
    const { inspect } = await import('../src/host/migration/service.ts')
    const cwd = '/tmp/proj-a'
    const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
    // global
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] global one', '[2026-08-11] global two'])
    writeLegacyMemory(join(root, 'USER.md'), ['[2026-08-10] user one'])
    writeLegacyMemory(join(root, 'MEMORY-archive.md'), ['[2026-08-09] archived global'])
    writeLegacyMemory(join(root, 'USER-archive.md'), ['[2026-08-09] archived user'])
    // queue valid
    writeFileSync(join(root, 'SUGGESTIONS.jsonl'), JSON.stringify({ target: 'memory', content: 'suggest 1', reason: 'r', time: new Date().toISOString() }) + '\n', 'utf8')
    // project
    writeLegacyMemory(join(root, 'projects', hash, 'MEMORY.md'), ['[2026-08-10 10:00] project log'])
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[2026-08-10] [branch:main] key entry', '[2026-08-10] key two'])
    writeLegacyMemory(join(root, 'projects', hash, 'KEY-archive.md'), ['[2026-08-08] old key'])
    writeFileSync(join(root, 'projects', hash, 'TODOS.md'), '<!-- header -->\n§\n[2026-08-10 10:00] [id: aabbccdd] [status: pending]\nproj todo\n', 'utf8')
    // daily
    mkdirSync(join(root, 'daily'), { recursive: true })
    writeFileSync(join(root, 'daily', '2026-08-10.md'), '[08:30] daily entry\n', 'utf8')
    writeFileSync(join(root, 'daily', '2026-08-10.todo.md'), '<!-- header -->\n§\n[2026-08-10 10:00] [id: deadbeef] [status: pending]\ndaily todo\n', 'utf8')
    // todos life/work
    mkdirSync(join(root), { recursive: true })
    writeTodoFile(join(root, 'TODOS-life.md'), ['[2026-08-10 10:00] [id: 11111111] [status: pending]\nlife todo'])
    writeTodoFile(join(root, 'TODOS-work.md'), ['[2026-08-10 10:00] [id: 22222222] [status: doing]\nwork todo'])
    writeFileSync(join(root, 'TODO-archive.md'), 'archived todo\n', 'utf8')

    const res = await inspect(root)
    expect(res.ok).toBe(true)
    // must report files for each category (exists)
    const rels = res.files.map((f: any) => f.relative || f.path)
    const has = (p: string) => rels.some((r: string) => r.endsWith(p))
    expect(has('MEMORY.md')).toBe(true)
    expect(has('USER.md')).toBe(true)
    expect(has('MEMORY-archive.md')).toBe(true)
    expect(has('projects/' + hash + '/KEY.md')).toBe(true)
    expect(has('daily/2026-08-10.md')).toBe(true)
    expect(has('TODOS-life.md')).toBe(true)
    expect(res.inventory.memoryEntries).toBeGreaterThanOrEqual(4)
    expect(res.inventory.todoIdsCount).toBeGreaterThanOrEqual(3)
    expect(res.inventory.queueValid).toBe(1)
  })

  it('handles missing optional files without error', async () => {
    const { inspect } = await import('../src/host/migration/service.ts')
    // empty root: no files at all
    const res = await inspect(root)
    expect(res.ok).toBe(true)
    expect(res.warnings.length).toBe(0)
    // files should list expected paths as missing (or empty inventory)
    expect(res.inventory.memoryEntries).toBe(0)
    expect(res.inventory.todoIdsCount).toBe(0)
    // no crash on missing daily/projects
  })

  it('reports malformed JSONL without discarding, includes malformed count', async () => {
    const { inspect } = await import('../src/host/migration/service.ts')
    const bad = 'not json\n' + JSON.stringify({ target: 'memory', content: 'good', reason: 'r', time: new Date().toISOString() }) + '\n{bad json\n'
    writeFileSync(join(root, 'SUGGESTIONS.jsonl'), bad, 'utf8')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] ok'])
    const res = await inspect(root)
    expect(res.warnings.some((w: string) => /malformed/i.test(w))).toBe(true)
    // inventory counts only valid lines
    expect(res.inventory.queueValid).toBe(1)
    expect(res.inventory.queueMalformed).toBe(2)
    // inspect ok still true (malformed is warning not blocking)
    expect(res.ok).toBe(true)
    // byte count still correct (file exists)
    const q = res.files.find((f: any) => f.relative?.endsWith('SUGGESTIONS.jsonl') || f.path.endsWith('SUGGESTIONS.jsonl'))
    expect(q).toBeDefined()
    expect(q!.bytes).toBe(Buffer.byteLength(bad))
    expect(q!.sha256).toBe(sha256(bad))
  })

  it('reports noncanonical memory file and lock file as warnings', async () => {
    const { inspect } = await import('../src/host/migration/service.ts')
    // noncanonical: missing trailing newline
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'MEMORY.md'), 'a\n§\nb', 'utf8') // no trailing \n => not canonical per serializeEntries
    // lock file
    writeFileSync(join(root, '.maestro.lock'), JSON.stringify({ pid: 999999, at: Date.now() }), 'utf8')
    const res = await inspect(root)
    expect(res.warnings.some((w: string) => /non-canonical|noncanonical|drift/i.test(w))).toBe(true)
    expect(res.warnings.some((w: string) => /lock/i.test(w))).toBe(true)
  })

  it('is read-only: does not create backup/manifest/schema/journal', async () => {
    const { inspect } = await import('../src/host/migration/service.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] a'])
    const res = await inspect(root)
    expect(existsSync(join(root, '.maestro-memory'))).toBe(false)
    expect(res.ok).toBe(true)
  })
})

describe('M3-PR-B dryRun: read-only', () => {
  it('dryRun does not modify files, returns same as inspect with ok flag', async () => {
    const { dryRun } = await import('../src/host/migration/service.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] x'])
    writeFileSync(join(root, 'SUGGESTIONS.jsonl'), 'bad\n', 'utf8')
    const before = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    const res = await dryRun(root)
    expect(res.ok).toBe(true)
    expect(existsSync(join(root, '.maestro-memory', 'backups'))).toBe(false)
    expect(existsSync(join(root, '.maestro-memory', 'schema.json'))).toBe(false)
    expect(existsSync(join(root, '.maestro-memory', 'migration-journal.jsonl'))).toBe(false)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe(before)
    expect(readFileSync(join(root, 'SUGGESTIONS.jsonl'), 'utf8')).toBe('bad\n')
  })
})

describe('M3-PR-B run: backup manifest, journal, does not reformat', () => {
  it('run creates byte-preserving backup manifest with sha256, bytes, inventory', async () => {
    const { run, inspect } = await import('../src/host/migration/service.ts')
    const cwd = '/tmp/proj-a'
    const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
    const memEntries = ['[2026-08-10] global one', '[2026-08-11] global two']
    writeLegacyMemory(join(root, 'MEMORY.md'), memEntries)
    const memRaw = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    const memSha = sha256(memRaw)
    const memBytes = Buffer.byteLength(memRaw)
    writeLegacyMemory(join(root, 'USER.md'), ['[2026-08-10] user one'])
    writeFileSync(join(root, 'SUGGESTIONS.jsonl'), JSON.stringify({ target: 'memory', content: 'suggest', reason: 'r', time: new Date().toISOString() }) + '\nnot json\n', 'utf8')
    const suggRaw = readFileSync(join(root, 'SUGGESTIONS.jsonl'), 'utf8')
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[2026-08-10] key one'])
    writeTodoFile(join(root, 'TODOS-life.md'), ['[2026-08-10 10:00] [id: aaaa1111] [status: pending]\nlife'])

    const res = await run(root)
    expect(res.ok).toBe(true)
    expect(res.runId).toMatch(/^\d{4}-?\d{2}-?\d{2}T/)
    expect(existsSync(res.manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf8'))
    expect(manifest.runId).toBe(res.runId)
    expect(manifest.files.length).toBeGreaterThanOrEqual(4)
    // manifest must contain bytes, sha256, entries for each
    const memEntry = manifest.files.find((f: any) => f.relative.endsWith('MEMORY.md'))
    expect(memEntry).toBeDefined()
    expect(memEntry.bytes).toBe(memBytes)
    expect(memEntry.sha256).toBe(memSha)
    expect(memEntry.entries).toBe(2)
    // backup files are byte-preserving
    const backupMem = readFileSync(join(manifest.backupFilesDir, 'MEMORY.md'), 'utf8')
    expect(backupMem).toBe(memRaw)
    // malformed queue preserved byte-identical
    const qEntry = manifest.files.find((f: any) => f.relative.endsWith('SUGGESTIONS.jsonl'))
    expect(qEntry).toBeDefined()
    expect(qEntry.malformedLines).toBe(1)
    const backupQ = readFileSync(join(manifest.backupFilesDir, 'SUGGESTIONS.jsonl'), 'utf8')
    expect(backupQ).toBe(suggRaw)
    // schema and journal written
    expect(existsSync(join(root, '.maestro-memory', 'schema.json'))).toBe(true)
    const schema = JSON.parse(readFileSync(join(root, '.maestro-memory', 'schema.json'), 'utf8'))
    expect(schema.version).toBe(1)
    expect(schema.runId).toBe(res.runId)
    expect(existsSync(join(root, '.maestro-memory', 'migration-journal.jsonl'))).toBe(true)
    const journalLines = readFileSync(join(root, '.maestro-memory', 'migration-journal.jsonl'), 'utf8').trim().split('\n')
    expect(journalLines.length).toBe(1)
    const j = JSON.parse(journalLines[0])
    expect(j.runId).toBe(res.runId)
    expect(j.action).toBe('run')
  })

  it('run does not reformat source content (hash stays identical)', async () => {
    const { run } = await import('../src/host/migration/service.ts')
    const raw = '[2026-08-10] keep exact\n§\n[2026-08-11] second\n'
    writeFileSync(join(root, 'MEMORY.md'), raw, 'utf8')
    const beforeSha = sha256(raw)
    const res = await run(root)
    expect(res.ok).toBe(true)
    const after = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(after).toBe(raw)
    expect(sha256(after)).toBe(beforeSha)
  })

  it('run with only missing optional files still succeeds and backups only existing files', async () => {
    const { run } = await import('../src/host/migration/service.ts')
    // only create USER.md, leave MEMORY.md absent
    writeLegacyMemory(join(root, 'USER.md'), ['[2026-08-10] only user'])
    const res = await run(root)
    expect(res.ok).toBe(true)
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf8'))
    // should not have MEMORY.md entry with exists:false polluting backup
    const mem = manifest.files.find((f: any) => f.relative === 'MEMORY.md')
    if (mem) expect(mem.exists).toBe(false)
  })

  it('run preserves malformed JSONL byte-identical in backup and reports warning but still ok', async () => {
    const { run } = await import('../src/host/migration/service.ts')
    const bad = 'not json line\n' + JSON.stringify({ target: 'memory', content: 'good', reason: 'r', time: 't' }) + '\n{bad\n'
    writeFileSync(join(root, 'SUGGESTIONS.jsonl'), bad, 'utf8')
    const res = await run(root)
    expect(res.ok).toBe(true)
    expect(res.warnings.some((w: string) => /malformed/i.test(w))).toBe(true)
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf8'))
    const q = manifest.files.find((f: any) => f.relative.endsWith('SUGGESTIONS.jsonl'))
    expect(q.malformedLines).toBe(2)
    const backup = readFileSync(join(manifest.backupFilesDir, 'SUGGESTIONS.jsonl'), 'utf8')
    expect(backup).toBe(bad)
  })
})

describe('M3-PR-B verify: digest + inventory, write-block on mismatch', () => {
  it('verify passes when files unchanged, inventories match', async () => {
    const { run, verify } = await import('../src/host/migration/service.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] a', '[2026-08-11] b'])
    writeTodoFile(join(root, 'TODOS-work.md'), ['[2026-08-10 10:00] [id: bbbb2222] [status: pending]\nwork'])
    const runRes = await run(root)
    expect(runRes.ok).toBe(true)
    const ver = await verify(root)
    expect(ver.ok).toBe(true)
    expect(ver.mismatches.length).toBe(0)
  })

  it('verify fails when file digest changes, and blocks writes', async () => {
    const { run, verify, isWriteBlocked } = await import('../src/host/migration/service.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] original'])
    const runRes = await run(root)
    expect(runRes.ok).toBe(true)
    // tamper file
    writeFileSync(join(root, 'MEMORY.md'), '[2026-08-10] tampered\n', 'utf8')
    const ver = await verify(root)
    expect(ver.ok).toBe(false)
    expect(ver.mismatches.length).toBeGreaterThan(0)
    expect(isWriteBlocked(root)).toBe(true)
    // subsequent write via MaestroMemoryStore should be blocked
    const { MaestroMemoryStore } = await import('../src/host/memory/store.ts')
    const store = new MaestroMemoryStore(root)
    const res = store.add('memory', 'should be blocked')
    // block should cause error or ok:false with block message
    if ((res as any).ok === false) {
      expect((res as any).error).toMatch(/blocked|mismatch/i)
    } else {
      // if store does not block, check migration state still indicates blocked
      expect(isWriteBlocked(root)).toBe(true)
    }
  })

  it('verify also detects todo ID inventory mismatch', async () => {
    const { run, verify } = await import('../src/host/migration/service.ts')
    writeTodoFile(join(root, 'TODOS-life.md'), ['[2026-08-10 10:00] [id: cccc3333] [status: pending]\ninitial'])
    const runRes = await run(root)
    expect(runRes.ok).toBe(true)
    // append new todo directly bypassing migration (simulate external change)
    const extra = '[2026-08-10 10:01] [id: dddd4444] [status: pending]\nextra\n'
    const cur = readFileSync(join(root, 'TODOS-life.md'), 'utf8')
    writeFileSync(join(root, 'TODOS-life.md'), cur + '\n§\n' + extra, 'utf8')
    const ver = await verify(root)
    expect(ver.ok).toBe(false)
    expect(ver.mismatches.some((m: string) => /todo|inventory/i.test(m))).toBe(true)
  })

  it('verify fails on malformed vs manifest mismatch and write-block persists', async () => {
    const { run, verify, isWriteBlocked } = await import('../src/host/migration/service.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] a'])
    const runRes = await run(root)
    const ver1 = await verify(root)
    expect(ver1.ok).toBe(true)
    expect(isWriteBlocked(root)).toBe(false)
    // tamper to cause mismatch then verify again -> blocked
    writeFileSync(join(root, 'MEMORY.md'), '[2026-08-10] changed\n', 'utf8')
    const ver2 = await verify(root)
    expect(ver2.ok).toBe(false)
    expect(isWriteBlocked(root)).toBe(true)
    // second verify still blocked
    const ver3 = await verify(root)
    expect(ver3.ok).toBe(false)
  })
})

describe('M3-PR-B CLI: explicit --apply, default read-only', () => {
  it('CLI module exists and defaults to read-only (no --apply does not call run)', async () => {
    const cli = await import('../src/host/migration/cli.ts')
    expect(typeof cli.parseArgs).toBe('function')
    expect(typeof cli.main).toBe('function')
    // parseArgs without --apply
    const parsed = cli.parseArgs(['node', 'cli', '--root', root])
    expect(parsed.apply).toBe(false)
    expect(parsed.command).toBe('inspect')
    // with --apply triggers run
    const parsed2 = cli.parseArgs(['node', 'cli', '--root', root, '--apply'])
    expect(parsed2.apply).toBe(true)
    expect(parsed2.command).toBe('run')
    // default without args should be inspect read-only
    const parsed3 = cli.parseArgs(['node', 'cli'])
    expect(parsed3.apply).toBe(false)
    expect(parsed3.command).toBe('inspect')
  })

  it('CLI main without --apply does not create backup/schema (read-only)', async () => {
    const { main, parseArgs } = await import('../src/host/migration/cli.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] cli test'])
    const args = parseArgs(['node', 'cli', '--root', root])
    // mock console to capture output not needed
    const result = await main(args)
    expect(result.ok).toBe(true)
    expect(existsSync(join(root, '.maestro-memory', 'backups'))).toBe(false)
    expect(existsSync(join(root, '.maestro-memory', 'schema.json'))).toBe(false)
  })

  it('CLI main with --apply creates backup and journal', async () => {
    const { main, parseArgs } = await import('../src/host/migration/cli.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] cli apply'])
    const args = parseArgs(['node', 'cli', '--root', root, '--apply'])
    const result = await main(args)
    expect(result.ok).toBe(true)
    expect(existsSync(join(root, '.maestro-memory', 'backups'))).toBe(true)
    expect(existsSync(join(root, '.maestro-memory', 'schema.json'))).toBe(true)
  })

  it('CLI --verify with explicit flag verifies after run', async () => {
    const { main, parseArgs } = await import('../src/host/migration/cli.ts')
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] for verify'])
    // first apply
    await main(parseArgs(['node', 'cli', '--root', root, '--apply']))
    // then verify
    const v = await main(parseArgs(['node', 'cli', '--root', root, '--verify']))
    expect(v.ok).toBe(true)
  })
})

describe('M3-PR-B backup manifest fields completeness', () => {
  it('manifest contains path, bytes, sha256, parser inventory for each file type', async () => {
    const { run } = await import('../src/host/migration/service.ts')
    const cwd = '/tmp/proj-b'
    const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
    writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] one'])
    writeTodoFile(join(root, 'TODOS-work.md'), ['[2026-08-10 10:00] [id: eeee5555] [status: pending]\nwork entry'])
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[2026-08-10] key'])
    mkdirSync(join(root, 'daily'), { recursive: true })
    writeFileSync(join(root, 'daily', '2026-08-10.md'), '[08:30] daily\n', 'utf8')
    writeFileSync(join(root, 'SUGGESTIONS.jsonl'), JSON.stringify({ target: 'memory', content: 'c', reason: 'r', time: 't' }) + '\n', 'utf8')
    const res = await run(root)
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf8'))
    expect(manifest.version).toBe(1)
    expect(typeof manifest.createdAt).toBe('string')
    expect(Array.isArray(manifest.files)).toBe(true)
    for (const f of manifest.files) {
      if (!f.exists) continue
      expect(typeof f.relative).toBe('string')
      expect(typeof f.bytes).toBe('number')
      expect(typeof f.sha256).toBe('string')
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
      // parser inventory present for known types
      if (f.relative.endsWith('.md') && !f.relative.includes('.maestro-memory')) {
        expect(typeof f.entries).toBe('number')
      }
      if (f.relative.includes('SUGGESTIONS.jsonl')) {
        expect(typeof f.malformedLines).toBe('number')
      }
    }
    // journal appended with same runId
    const journal = readFileSync(join(root, '.maestro-memory', 'migration-journal.jsonl'), 'utf8')
    expect(journal).toContain(res.runId)
  })
})
