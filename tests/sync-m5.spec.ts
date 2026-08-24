import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SyncService } from '../src/host/sync/service.ts'
import { MockGitAdapter } from '../src/host/sync/git.ts'
import { projectHash } from '../src/host/storage/layout.ts'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { TodoStore } from '../src/host/todo/store.ts'

function writeLegacyMemory(file: string, entries: string[]) {
  const { serializeEntries } = require('../src/host/storage/atomic-store.ts')
  const content = entries.length === 0 ? '' : entries.join('\n§\n') + '\n'
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content, 'utf8')
}

describe('M5 sync: disabled means zero network', () => {
  let root: string
  let svc: SyncService
  let git: MockGitAdapter
  const cwd = '/tmp/proj-sync-disabled'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sync-disabled-'))
    git = new MockGitAdapter()
    svc = new SyncService(root, git)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('fetch/push/pull/status return disabled and spawn zero git calls', async () => {
    const st = svc.status(cwd)
    expect(st.enabled).toBe(false)
    expect(git.calls.length).toBe(0)

    const f = await svc.fetch(cwd)
    expect(f.ok).toBe(false)
    expect((f as any).error).toMatch(/disabled/)
    expect(git.calls.length).toBe(0)

    const p = await svc.push(cwd)
    expect(p.ok).toBe(false)
    expect(git.calls.length).toBe(0)

    const pu = await svc.pull(cwd)
    expect(pu.ok).toBe(false)
    expect(git.calls.length).toBe(0)
  })

  it('enable then disable clears config and again zero network', async () => {
    const e = svc.enable(cwd, 'file:///tmp/fake.git')
    expect(e.ok).toBe(true)
    expect(svc.status(cwd).enabled).toBe(true)
    git.calls = []
    svc.disable(cwd)
    expect(svc.status(cwd).enabled).toBe(false)
    const f = await svc.fetch(cwd)
    expect(f.ok).toBe(false)
    expect(git.calls.length).toBe(0)
  })
})

describe('M5 sync: divergence union merge', () => {
  let root: string
  let git: MockGitAdapter
  let svc: SyncService
  const cwd = '/tmp/proj-diverge'
  const remote = 'file:///tmp/remote-diverge.git'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sync-diverge-'))
    git = new MockGitAdapter()
    svc = new SyncService(root, git)
    svc.enable(cwd, remote)
    // local has one entry
    const hash = projectHash(cwd)
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[id: aaaaaaaa] local one'])
    // remote has different entry (simulate other machine)
    git.setRemoteFiles(remote, `maestro-memory/${hash}`, {
      'KEY.md': '[id: bbbbbbbb] remote one\n',
      'MEMORY.md': '',
      'KEY-archive.md': '',
      'TODOS.md': '<!--\nTodo entry format (auto-maintained by the program, do not edit the structure manually):\n- Entries are delimited by §; the comment block before the first § is the format note, not a todo\n- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):\n  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])\n  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool\n  [q1] important & urgent  [q2] important not urgent  [q3] urgent+not important  [q4] not important not urgent (default = unclassified)\n  [due: YYYY-MM-DD] due date (default = none)\n  [status: pending|doing|done|blocked|cancelled] status (default pending)\n  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)\n  [cat: category] optional (life/work/study...)\n- Todo content follows the first tag line and may span multiple lines\n-->\n',
    })
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('pull merges union without dropping either', async () => {
    const res = await svc.pull(cwd)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.conflicts.length).toBe(0)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('local one')
    expect(local).toContain('remote one')
  })

  it('fetch reports no conflict for disjoint ids', async () => {
    const res = await svc.fetch(cwd)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.conflicts.length).toBe(0)
  })
})

describe('M5 sync: same-entry conflict never drops', () => {
  let root: string
  let git: MockGitAdapter
  let svc: SyncService
  const cwd = '/tmp/proj-conflict'
  const remote = 'file:///tmp/remote-conflict.git'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sync-conflict-'))
    git = new MockGitAdapter()
    svc = new SyncService(root, git)
    svc.enable(cwd, remote)
    const hash = projectHash(cwd)
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[id: deadbeef] local version'])
    git.setRemoteFiles(remote, `maestro-memory/${hash}`, {
      'KEY.md': '[id: deadbeef] remote version\n',
      'MEMORY.md': '',
      'KEY-archive.md': '',
      'TODOS.md': '<!--\nTodo entry format (auto-maintained by the program, do not edit the structure manually):\n- Entries are delimited by §; the comment block before the first § is the format note, not a todo\n- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):\n  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])\n  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool\n  [q1] important & urgent  [q2] important not urgent  [q3] urgent+not important  [q4] not important not urgent (default = unclassified)\n  [due: YYYY-MM-DD] due date (default = none)\n  [status: pending|doing|done|blocked|cancelled] status (default pending)\n  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)\n  [cat: category] optional (life/work/study...)\n- Todo content follows the first tag line and may span multiple lines\n-->\n',
    })
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('fetch reports conflict', async () => {
    const res = await svc.fetch(cwd)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.conflicts.length).toBe(1)
  })

  it('push is blocked when conflict exists', async () => {
    const res = await svc.push(cwd)
    expect(res.ok).toBe(false)
    expect((res as any).error).toMatch(/conflict/)
    // local file retains local version (never drops)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('local version')
    expect(local).not.toContain('remote version')
  })

  it('pull keeps local and records conflict (never drops either)', async () => {
    const res = await svc.pull(cwd)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.conflicts.length).toBe(1)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('local version')
    // remote not auto-applied
    expect(local).not.toContain('remote version')
    const conflicts = svc.listConflicts(cwd)
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].id).toBe('deadbeef')
  })

  it('resolve local keeps local', async () => {
    await svc.pull(cwd)
    let conflicts = svc.listConflicts(cwd)
    expect(conflicts.length).toBe(1)
    const r = svc.resolve(cwd, 'deadbeef', 'local')
    expect(r.ok).toBe(true)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('local version')
    expect(svc.listConflicts(cwd).length).toBe(0)
  })

  it('resolve remote replaces with remote', async () => {
    await svc.pull(cwd)
    const r = svc.resolve(cwd, 'deadbeef', 'remote')
    expect(r.ok).toBe(true)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('remote version')
  })

  it('resolve both keeps both with new id', async () => {
    await svc.pull(cwd)
    const r = svc.resolve(cwd, 'deadbeef', 'both')
    expect(r.ok).toBe(true)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('local version')
    expect(local).toContain('remote version')
    // remote version should have new id, not deadbeef
    expect((local.match(/\[id:/g) || []).length).toBe(2)
  })
})

describe('M5 sync: failed fetch/push and recovery', () => {
  let root: string
  let git: MockGitAdapter
  let svc: SyncService
  const cwd = '/tmp/proj-fail'
  const remote = 'file:///tmp/remote-fail.git'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sync-fail-'))
    git = new MockGitAdapter()
    svc = new SyncService(root, git)
    svc.enable(cwd, remote)
    const hash = projectHash(cwd)
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[id: 12345678] hello'])
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('failed fetch returns error and leaves local untouched', async () => {
    git.failNextFetch = 'network offline'
    const res = await svc.fetch(cwd)
    expect(res.ok).toBe(false)
    expect((res as any).error).toMatch(/offline/)
    const hash = projectHash(cwd)
    const local = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(local).toContain('hello')
  })

  it('failed push returns error and does not update meta', async () => {
    git.failNextPush = 'auth failed'
    // Need to ensure fetch succeeds before push fails at push step; fetch will succeed unless we fail it
    // So push will fail at push stage
    const res = await svc.push(cwd)
    expect(res.ok).toBe(false)
    expect((res as any).error).toMatch(/auth/)
    // recovery: retry succeeds
    const res2 = await svc.push(cwd)
    expect(res2.ok).toBe(true)
  })

  it('recovery after failed fetch succeeds on retry', async () => {
    git.failNextFetch = 'timeout'
    const first = await svc.fetch(cwd)
    expect(first.ok).toBe(false)
    const second = await svc.fetch(cwd)
    expect(second.ok).toBe(true)
  })

  it('recovery after conflict resolve then push succeeds', async () => {
    const hash = projectHash(cwd)
    // setup conflict
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[id: abcdef12] local'])
    git.setRemoteFiles(remote, `maestro-memory/${hash}`, {
      'KEY.md': '[id: abcdef12] remote\n',
      'MEMORY.md': '',
      'KEY-archive.md': '',
      'TODOS.md': '<!-- header -->\n',
    })
    const pushBlocked = await svc.push(cwd)
    expect(pushBlocked.ok).toBe(false)
    // pull to create conflict record
    await svc.pull(cwd)
    const resResolve = svc.resolve(cwd, 'abcdef12', 'remote')
    expect(resResolve.ok).toBe(true)
    // now push should succeed
    const push2 = await svc.push(cwd)
    expect(push2.ok).toBe(true)
  })
})

describe('M5 sync: explicit push only', () => {
  let root: string
  let git: MockGitAdapter
  let svc: SyncService
  const cwd = '/tmp/proj-explicit'
  const remote = 'file:///tmp/remote-explicit.git'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sync-explicit-'))
    git = new MockGitAdapter()
    svc = new SyncService(root, git)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('no push on enable, only on explicit push', async () => {
    svc.enable(cwd, remote)
    expect(git.calls.filter(c => c.method === 'push').length).toBe(0)
    const hash = projectHash(cwd)
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[id: 11111111] x'])
    // still no push
    expect(git.calls.filter(c => c.method === 'push').length).toBe(0)
    const res = await svc.push(cwd)
    expect(res.ok).toBe(true)
    expect(git.calls.filter(c => c.method === 'push').length).toBe(1)
  })

  it('enable assigns missing ids atomically', async () => {
    const hash = projectHash(cwd)
    writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['no id entry one', 'no id entry two'])
    svc.enable(cwd, remote)
    const content = readFileSync(join(root, 'projects', hash, 'KEY.md'), 'utf8')
    expect(content.match(/\[id:/g)?.length).toBe(2)
  })

  it('project todos sync too (divergence)', async () => {
    svc.enable(cwd, remote)
    const hash = projectHash(cwd)
    const todoFile = join(root, 'projects', hash, 'TODOS.md')
    const header = '<!--\nTodo entry format (auto-maintained by the program, do not edit the structure manually):\n- Entries are delimited by §; the comment block before the first § is the format note, not a todo\n- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):\n  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])\n  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool\n  [q1] important & urgent  [q2] important not urgent  [q3] urgent+not important  [q4] not important not urgent (default = unclassified)\n  [due: YYYY-MM-DD] due date (default = none)\n  [status: pending|doing|done|blocked|cancelled] status (default pending)\n  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)\n  [cat: category] optional (life/work/study...)\n- Todo content follows the first tag line and may span multiple lines\n-->\n'
    mkdirSync(join(todoFile, '..'), { recursive: true })
    writeFileSync(todoFile, `${header}\n§\n[2026-08-10 10:00] [id: aabbccdd] [status: pending]\nlocal todo\n`, 'utf8')
    git.setRemoteFiles(remote, `maestro-memory/${hash}`, {
      'KEY.md': '',
      'MEMORY.md': '',
      'KEY-archive.md': '',
      'TODOS.md': `${header}\n§\n[2026-08-10 10:00] [id: ee112233] [status: pending]\nremote todo\n`,
    })
    const res = await svc.pull(cwd)
    expect(res.ok).toBe(true)
    const txt = readFileSync(todoFile, 'utf8')
    expect(txt).toContain('local todo')
    expect(txt).toContain('remote todo')
  })
})

describe('M5 sync: archive sync', () => {
  let root: string
  let git: MockGitAdapter
  let svc: SyncService
  const cwd = '/tmp/proj-archive'
  const remote = 'file:///tmp/remote-archive.git'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sync-archive-'))
    git = new MockGitAdapter()
    svc = new SyncService(root, git)
    svc.enable(cwd, remote)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('archives union similarly', async () => {
    const hash = projectHash(cwd)
    writeLegacyMemory(join(root, 'projects', hash, 'KEY-archive.md'), ['[id: aaaaaabb] local arch'])
    git.setRemoteFiles(remote, `maestro-memory/${hash}`, {
      'KEY.md': '',
      'MEMORY.md': '',
      'KEY-archive.md': '[id: bbbbbbbb] remote arch\n',
      'TODOS.md': '<!-- header -->\n',
    })
    const res = await svc.pull(cwd)
    expect(res.ok).toBe(true)
    const txt = readFileSync(join(root, 'projects', hash, 'KEY-archive.md'), 'utf8')
    expect(txt).toContain('local arch')
    expect(txt).toContain('remote arch')
  })
})
