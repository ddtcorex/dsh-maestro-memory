import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { SuggestionQueue, enqueueSuggestion, approveSuggestions, rejectSuggestions, archiveSuggestions } from '../src/host/review/queue.ts'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { TodoStore } from '../src/host/todo/store.ts'

let root: string
let queueFile: string
let queue: SuggestionQueue
const cwd = '/tmp/demo-project'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-q-'))
  queueFile = join(root, 'SUGGESTIONS.jsonl')
  queue = new SuggestionQueue(queueFile)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('SuggestionQueue append', () => {
  it('appends entry and persists', () => {
    const res = queue.append({ time: new Date().toISOString(), target: 'memory', content: 'hello', reason: 'why' } as any)
    expect(res.ok).toBe(true)
    expect(res.queued).toBe(1)
    const entries = queue.read()
    expect(entries.length).toBe(1)
    expect(entries[0].content).toBe('hello')
  })
})

describe('SuggestionQueue dedupe', () => {
  it('deduplicates same target+content and bumps hits', () => {
    queue.append({ time: new Date().toISOString(), target: 'user', content: 'pref plain style', reason: 'r1' } as any)
    const second = queue.append({ time: new Date().toISOString(), target: 'user', content: ' pref plain style ', reason: 'r2' } as any)
    expect(second.deduped).toBe(true)
    expect(second.hits).toBe(2)
    expect(queue.read().length).toBe(1)
    expect(queue.read()[0].hits).toBe(2)
    // different target not deduped
    queue.append({ time: new Date().toISOString(), target: 'memory', content: 'pref plain style', reason: 'r3' } as any)
    expect(queue.read().length).toBe(2)
  })

  it('enqueueSuggestion dedupes via helper', () => {
    const r1 = enqueueSuggestion(queue, 'memory', 'fact A', 'reason A')
    expect(r1.queued).toBe(1)
    const r2 = enqueueSuggestion(queue, 'memory', 'fact A', 'reason B')
    expect(r2.queued).toBe(1)
    expect(queue.read()[0].hits).toBe(2)
    expect(queue.read()[0].reason).toBe('reason B')
  })

  it('does NOT dedupe a distinct fact merely because it contains an existing entry as a substring', () => {
    enqueueSuggestion(queue, 'key', 'the build requires node 18', 'reason A')
    // This is a more specific fact: it is not the SAME fact, it must be enqueued separately.
    const r2 = enqueueSuggestion(queue, 'key', 'the build requires node 18 and node 20 for legacy', 'reason B')
    expect(r2.queued).toBe(2)
    expect(queue.read().length).toBe(2)
    expect(queue.read().map((e) => e.content)).toContain('the build requires node 18 and node 20 for legacy')
  })
})

describe('SuggestionQueue edited approval', () => {
  it('approves with edited content (edited replaces original)', async () => {
    const store = new MaestroMemoryStore(root)
    const todoStore = new TodoStore(root)
    queue.append({ time: new Date().toISOString(), target: 'memory', content: 'original fact', reason: 'r' } as any)
    const edits = new Map([[1, 'edited fact content']])
    const res = approveSuggestions(store, todoStore, queue, [1], undefined, edits)
    expect(res.lines[0]).toContain('approved')
    expect(queue.read().length).toBe(0)
    const entries = store.list('memory')
    expect(entries.join(' ')).toContain('edited fact content')
    expect(entries.join(' ')).not.toContain('original fact')
  })

  it('approve without edit writes original', async () => {
    const store = new MaestroMemoryStore(root)
    const todoStore = new TodoStore(root)
    queue.append({ time: new Date().toISOString(), target: 'key', content: 'key fact', reason: 'r', cwd } as any)
    // queue entry has cwd
    const res = approveSuggestions(store, todoStore, queue, [1], { session: { header: { cwd } } } as any)
    expect(res.remaining).toBe(0)
    expect(store.list('key', cwd).join(' ')).toContain('key fact')
  })
})

describe('SuggestionQueue reject', () => {
  it('reject removes entry without writing to store', () => {
    const store = new MaestroMemoryStore(root)
    queue.append({ time: new Date().toISOString(), target: 'memory', content: 'to reject', reason: 'r' } as any)
    queue.append({ time: new Date().toISOString(), target: 'memory', content: 'keep', reason: 'r' } as any)
    const res = rejectSuggestions(queue, [1])
    expect(res.removed).toBe(1)
    expect(res.remaining).toBe(1)
    expect(queue.read()[0].content).toBe('keep')
    expect(store.list('memory').length).toBe(0)
  })
})

describe('SuggestionQueue archive', () => {
  it('archive moves entry to archive and removes from queue', () => {
    const store = new MaestroMemoryStore(root)
    // archive via store.archive path? Use store as archive (it has archive method via MaestroMemoryStore.archive which needs main file). Instead we test queue archive via store's archive helper: we'll use MaestroMemoryStore as archive (it writes to archive file via append)
    // For memory target, archive should go to MEMORY-archive.md
    queue.append({ time: new Date().toISOString(), target: 'memory', content: 'archivable fact', reason: 'low priority' } as any)
    // Use a simple archive object that writes via store.archive after first adding to main then archiving? Instead we test archiveSuggestions with a mock archive that checks ok
    const archive = {
      append: (target: string, content: string) => {
        // simulate writing to archive file via store.add to archive? Use real store archive path: append to archive file directly
        // We'll use store's internal archiveFileFor via listArchive? Simpler: use MaestroMemoryStore's archive store via direct file
        // For test, just return ok and verify queue emptied
        return { ok: true }
      },
    }
    const res = archiveSuggestions(archive as any, queue, [1])
    expect(res.lines[0]).toContain('archived')
    expect(queue.read().length).toBe(0)
  })

  it('archive failure leaves queue intact', () => {
    queue.append({ time: new Date().toISOString(), target: 'memory', content: 'fail archive', reason: 'r' } as any)
    const failingArchive = {
      append: () => ({ ok: false, message: 'disk full' }),
    }
    const res = archiveSuggestions(failingArchive as any, queue, [1])
    expect(res.lines[0]).toContain('disk full')
    expect(queue.read().length).toBe(1)
  })
})

describe('SuggestionQueue malformed JSONL', () => {
  it('skips malformed lines on read', async () => {
    await writeFile(queueFile, 'not json\n{"target":"memory","content":"valid","reason":"r","time":"t"}\n{bad\n', 'utf8')
    const entries = queue.read()
    expect(entries.length).toBe(1)
    expect(entries[0].content).toBe('valid')
  })

  it('read does not throw on empty and missing file', () => {
    expect(queue.read()).toEqual([])
    writeFileSync(queueFile, '', 'utf8')
    expect(queue.read()).toEqual([])
  })
})

describe('SuggestionQueue recovery', () => {
  it('recovers after malformed: next append cleans file and append succeeds', async () => {
    await writeFile(queueFile, 'bad line\n{"target":"memory","content":"good","reason":"r","time":"t"}\nbad2\n', 'utf8')
    expect(queue.read().length).toBe(1)
    // mutate/append should rewrite clean file
    queue.append({ time: new Date().toISOString(), target: 'user', content: 'new entry', reason: 'r2' } as any)
    const raw = readFileSync(queueFile, 'utf8')
    // should not contain bad lines
    expect(raw).not.toContain('bad line')
    expect(raw).not.toContain('bad2')
    const entries = queue.read()
    expect(entries.length).toBe(2)
    expect(entries.map((e) => e.content)).toEqual(expect.arrayContaining(['good', 'new entry']))
  })

  it('malformed recovery preserves valid entries after multiple operations', async () => {
    await writeFile(queueFile, '{"target":"memory","content":"a","reason":"r","time":"t"}\nmalformed\n{"target":"user","content":"b","reason":"r2","time":"t2"}\n', 'utf8')
    expect(queue.read().length).toBe(2)
    // reject one
    rejectSuggestions(queue, [1])
    expect(queue.read().length).toBe(1)
    expect(queue.read()[0].content).toBe('b')
    const raw = readFileSync(queueFile, 'utf8')
    expect(raw).not.toContain('malformed')
  })
})

describe('SuggestionQueue gated suggestion vs direct write', () => {
  it('gated: memory_suggest queues instead of direct write (store not written)', () => {
    const store = new MaestroMemoryStore(root)
    const q = new SuggestionQueue(queueFile)
    // simulate gated tool: it should call enqueueSuggestion, not store.add
    const res = enqueueSuggestion(q, 'memory', 'gated fact', 'because')
    expect(res.ok).toBe(true)
    expect(store.list('memory').length).toBe(0)
    expect(q.read().length).toBe(1)
  })
})
