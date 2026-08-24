/**
 * sync/service.ts — enable/disable/status/fetch/push/pull/resolve
 * Disabled => zero Git activity (no spawn).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resolveMemoryRoot, maestroMetaDir } from '../storage/layout.ts'
import { projectHash, projectKeyPath, projectMemoryPath, projectKeyArchivePath, projectTodoPath } from '../storage/layout.ts'
import { parseEntries, serializeEntries } from '../storage/atomic-store.ts'
import { parseTodoEntry, TODO_HEADER, ENTRY_DELIMITER } from '../storage/legacy-format.ts'
import { readEntriesSync, writeEntriesAtomicSync } from '../storage/atomic-store.ts'
import { syncBranchName, syncConflictsPath, syncDir } from './layout.ts'
import { readConfig, writeConfig, clearConfig, readMeta, writeMeta, baseIdsFromMeta, SyncConfig, SyncMeta } from './config.ts'
import { mergeMemoryEntries, mergeTodoEntries, snapshotIds, mapById } from './merge.ts'
import type { GitAdapter } from './git.ts'
import { MockGitAdapter, RealGitAdapter } from './git.ts'

const TRACK_FILES: Record<string, (root: string, cwd: string) => string> = {
  KEY: (root, cwd) => projectKeyPath(root, cwd),
  MEMORY: (root, cwd) => projectMemoryPath(root, cwd),
  'KEY-archive': (root, cwd) => projectKeyArchivePath(root, cwd),
  TODOS: (root, cwd) => projectTodoPath(root, cwd),
}

function ensureIdForMemoryEntries(entries: string[]): { entries: string[]; changed: boolean } {
  let changed = false
  const next = entries.map((e) => {
    if (/^\[id:\s*[0-9a-f]{8}\]\s*/i.test(e)) return e
    changed = true
    const id = randomBytes(4).toString('hex')
    return `[id:${id}] ${e}`
  })
  return { entries: next, changed }
}

function readMemoryTrack(root: string, cwd: string, track: string): string[] {
  const fn = TRACK_FILES[track]
  if (!fn) return []
  const p = fn(root, cwd)
  return readEntriesSync(p)
}

function writeMemoryTrack(root: string, cwd: string, track: string, entries: string[]): void {
  const fn = TRACK_FILES[track]
  if (!fn) throw new Error(`unknown track ${track}`)
  const p = fn(root, cwd)
  const res = writeEntriesAtomicSync(p, entries)
  if (!res.ok) throw new Error(res.error)
}

function readTodoTrackRaw(root: string, cwd: string): string[] {
  const p = projectTodoPath(root, cwd)
  let text = ''
  try { text = readFileSync(p, 'utf8') } catch (e: any) { if (e?.code === 'ENOENT') return []; throw e }
  const body = text.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^\s*§\s*\n?/, '').trim()
  if (body === '') return []
  return body.split(ENTRY_DELIMITER).map((s) => s.trim()).filter(Boolean)
}

function todoIds(entries: string[]): Set<string> {
  const s = new Set<string>()
  for (const e of entries) {
    const parsed = parseTodoEntry(e)
    if (parsed?.id) s.add(parsed.id.toLowerCase())
  }
  return s
}

function extractId(entry: string): string | null {
  const m = /^\[id:\s*([0-9a-f]{8})\]\s*/i.exec(entry)
  if (m) return m[1].toLowerCase()
  // for todos, id is inside first line
  const pm = parseTodoEntry(entry)
  if (pm?.id) return pm.id.toLowerCase()
  return null
}

function isWriteBlockedSync(root: string): boolean {
  try {
    const p = join(maestroMetaDir(root), 'write-block.json')
    if (!existsSync(p)) return false
    const data = JSON.parse(readFileSync(p, 'utf8'))
    return data.blocked === true
  } catch {
    return false
  }
}

export class SyncService {
  constructor(
    private readonly memoryDir: string | null = null,
    private readonly git: GitAdapter = new MockGitAdapter(),
  ) {}

  private root(): string { return resolveMemoryRoot(this.memoryDir) }

  private hashFor(cwd: string): string { return projectHash(cwd) }

  // -------------------------------------------------------------------------
  // enable
  // -------------------------------------------------------------------------
  enable(cwd: string, remoteUrl: string, branch?: string): { ok: true; hash: string } | { ok: false; error: string } {
    if (!cwd) return { ok: false, error: 'cwd required' }
    if (!remoteUrl || typeof remoteUrl !== 'string' || remoteUrl.trim() === '') return { ok: false, error: 'remoteUrl required' }
    const hash = this.hashFor(cwd)
    const root = this.root()
    const br = branch?.trim() || syncBranchName(hash)
    const cfg: SyncConfig = { enabled: true, remoteUrl: remoteUrl.trim(), branch: br }
    writeConfig(root, hash, cfg)

    // Adopt: ensure all synced entries have ids (KEY, MEMORY, KEY-archive). TODOS already have ids.
    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const entries = readMemoryTrack(root, cwd, track)
      const { entries: next, changed } = ensureIdForMemoryEntries(entries)
      if (changed) {
        writeMemoryTrack(root, cwd, track, next)
      }
    }
    // For TODOS, ensure any entry missing id gets one? Usually not needed. Skip.

    return { ok: true, hash }
  }

  disable(cwd: string): { ok: true } | { ok: false; error: string } {
    if (!cwd) return { ok: false, error: 'cwd required' }
    const hash = this.hashFor(cwd)
    clearConfig(this.root(), hash)
    return { ok: true }
  }

  isEnabled(cwd: string): boolean {
    const hash = this.hashFor(cwd)
    return readConfig(this.root(), hash) !== null
  }

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------
  status(cwd: string, reveal = false): { enabled: boolean; branch?: string; remoteUrl?: string; remoteRedacted?: string; lastSync?: SyncMeta | null; conflicts: any[] } {
    const hash = this.hashFor(cwd)
    const root = this.root()
    const cfg = readConfig(root, hash)
    if (!cfg) {
      return { enabled: false, conflicts: [] }
    }
    const meta = readMeta(root, hash)
    const conflicts = this.listConflicts(cwd)
    const remoteRedacted = '***'
    return {
      enabled: true,
      branch: cfg.branch,
      remoteUrl: reveal ? cfg.remoteUrl : undefined,
      remoteRedacted: reveal ? undefined : remoteRedacted,
      lastSync: meta,
      conflicts,
    }
  }

  listConflicts(cwd: string): any[] {
    const hash = this.hashFor(cwd)
    const p = syncConflictsPath(this.root(), hash)
    if (!existsSync(p)) return []
    try {
      const txt = readFileSync(p, 'utf8')
      return txt.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  }

  private writeConflicts(cwd: string, conflicts: any[]): void {
    const hash = this.hashFor(cwd)
    const p = syncConflictsPath(this.root(), hash)
    mkdirSync(dirname(p), { recursive: true })
    const lines = conflicts.map((c) => JSON.stringify(c)).join('\n')
    writeFileSync(p, lines ? lines + '\n' : '', 'utf8')
  }

  private appendConflict(cwd: string, rec: any): void {
    const hash = this.hashFor(cwd)
    const p = syncConflictsPath(this.root(), hash)
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify(rec) + '\n', 'utf8')
  }

  // -------------------------------------------------------------------------
  // internal helpers: collect local files as remote map
  // -------------------------------------------------------------------------
  private localFiles(cwd: string): Record<string, string> {
    const root = this.root()
    const out: Record<string, string> = {}
    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const entries = readMemoryTrack(root, cwd, track)
      out[track === 'KEY' ? 'KEY.md' : track === 'MEMORY' ? 'MEMORY.md' : 'KEY-archive.md'] = serializeEntries(entries)
    }
    // TODOS
    const todoEntries = readTodoTrackRaw(root, cwd)
    const todoText = todoEntries.length ? `${TODO_HEADER}\n§\n${todoEntries.join(ENTRY_DELIMITER)}\n` : `${TODO_HEADER}`
    out['TODOS.md'] = todoText
    return out
  }

  private writeLocalFiles(cwd: string, files: Record<string, string>): void {
    const root = this.root()
    if (files['KEY.md'] !== undefined) {
      const entries = parseEntries(files['KEY.md'])
      writeMemoryTrack(root, cwd, 'KEY', entries)
    }
    if (files['MEMORY.md'] !== undefined) {
      const entries = parseEntries(files['MEMORY.md'])
      writeMemoryTrack(root, cwd, 'MEMORY', entries)
    }
    if (files['KEY-archive.md'] !== undefined) {
      const entries = parseEntries(files['KEY-archive.md'])
      writeMemoryTrack(root, cwd, 'KEY-archive', entries)
    }
    if (files['TODOS.md'] !== undefined) {
      const text = files['TODOS.md']
      const body = text.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^\s*§\s*\n?/, '').trim()
      const entries = body ? body.split(ENTRY_DELIMITER).map((s) => s.trim()).filter(Boolean) : []
      const p = projectTodoPath(root, cwd)
      mkdirSync(dirname(p), { recursive: true })
      const out = `${TODO_HEADER}${entries.length ? `\n§\n${entries.join(ENTRY_DELIMITER)}\n` : ''}`
      writeFileSync(p, out, 'utf8')
    }
  }

  // -------------------------------------------------------------------------
  // fetch (no local mutation)
  // -------------------------------------------------------------------------
  async fetch(cwd: string): Promise<{ ok: true; conflicts: any[]; remoteFiles: Record<string, string>; status: string } | { ok: false; error: string }> {
    const hash = this.hashFor(cwd)
    const root = this.root()
    if (isWriteBlockedSync(root)) return { ok: false, error: `write blocked: migration verify mismatch (see ${join(maestroMetaDir(root), 'write-block.json')})` }
    const cfg = readConfig(root, hash)
    if (!cfg) return { ok: false, error: 'sync disabled for this project' }
    // No local mutation, but we need to check remote
    const fetchRes = await this.git.fetch(cfg.remoteUrl, cfg.branch)
    if (!fetchRes.ok) return { ok: false, error: fetchRes.error }
    const remoteRes = await this.git.getRemoteFiles(cfg.remoteUrl, cfg.branch)
    if (!remoteRes.ok) return { ok: false, error: remoteRes.error }

    const remoteFiles = remoteRes.files
    // compare local vs remote for conflict preview (do not write files)
    const meta = readMeta(root, hash)
    const conflicts: any[] = []

    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const fileKey = track === 'KEY' ? 'KEY.md' : track === 'MEMORY' ? 'MEMORY.md' : 'KEY-archive.md'
      const localEntries = readMemoryTrack(root, cwd, track)
      const remoteText = remoteFiles[fileKey] ?? ''
      const remoteEntries = parseEntries(remoteText)
      const baseIds = baseIdsFromMeta(meta, track)
      const res = mergeMemoryEntries({ track, local: localEntries, remote: remoteEntries, baseIds })
      for (const c of res.conflicts) {
        conflicts.push({ track, id: c.id, localEntry: c.localEntry, remoteEntry: c.remoteEntry, reason: c.reason })
      }
    }
    // TODOS
    {
      const localTodos = readTodoTrackRaw(root, cwd)
      const remoteTodoText = remoteFiles['TODOS.md'] ?? ''
      const remoteBody = remoteTodoText.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^\s*§\s*\n?/, '').trim()
      const remoteTodos = remoteBody ? remoteBody.split(ENTRY_DELIMITER).map((s) => s.trim()).filter(Boolean) : []
      const metaIds = baseIdsFromMeta(meta, 'TODOS')
      const res = mergeTodoEntries({ local: localTodos, remote: remoteTodos, baseIds: metaIds })
      for (const c of res.conflicts) conflicts.push({ track: 'TODOS', id: c.id, localEntry: c.localEntry, remoteEntry: c.remoteEntry, reason: c.reason })
    }

    const status = conflicts.length ? 'conflicts' : 'ok'
    return { ok: true, conflicts, remoteFiles, status }
  }

  // -------------------------------------------------------------------------
  // push (explicit)
  // -------------------------------------------------------------------------
  async push(cwd: string, message?: string): Promise<{ ok: true; pushed: boolean; conflicts: any[] } | { ok: false; error: string; conflicts?: any[] }> {
    const hash = this.hashFor(cwd)
    const root = this.root()
    if (isWriteBlockedSync(root)) return { ok: false, error: `write blocked: migration verify mismatch (see ${join(maestroMetaDir(root), 'write-block.json')})` }
    const cfg = readConfig(root, hash)
    if (!cfg) return { ok: false, error: 'sync disabled for this project' }

    // First fetch to check conflicts
    const fetchRes = await this.git.fetch(cfg.remoteUrl, cfg.branch)
    if (!fetchRes.ok) return { ok: false, error: fetchRes.error }
    const remoteRes = await this.git.getRemoteFiles(cfg.remoteUrl, cfg.branch)
    if (!remoteRes.ok) return { ok: false, error: remoteRes.error }

    const remoteFiles = remoteRes.files
    const meta = readMeta(root, hash)
    const allConflicts: any[] = []

    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const fileKey = track === 'KEY' ? 'KEY.md' : track === 'MEMORY' ? 'MEMORY.md' : 'KEY-archive.md'
      const localEntries = readMemoryTrack(root, cwd, track)
      const remoteEntries = parseEntries(remoteRes.files[fileKey] ?? '')
      const res = mergeMemoryEntries({ track, local: localEntries, remote: remoteEntries, baseIds: baseIdsFromMeta(meta, track) })
      allConflicts.push(...res.conflicts.map((c) => ({ track, id: c.id, localEntry: c.localEntry, remoteEntry: c.remoteEntry })))
    }
    {
      const localTodos = readTodoTrackRaw(root, cwd)
      const remoteTodos = (() => {
        const txt = remoteRes.files['TODOS.md'] ?? ''
        const body = txt.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^\s*§\s*\n?/, '').trim()
        return body ? body.split(ENTRY_DELIMITER).map((s) => s.trim()).filter(Boolean) : []
      })()
      const res = mergeTodoEntries({ local: localTodos, remote: remoteTodos, baseIds: baseIdsFromMeta(meta, 'TODOS') })
      allConflicts.push(...res.conflicts.map((c) => ({ track: 'TODOS', id: c.id, localEntry: c.localEntry, remoteEntry: c.remoteEntry })))
    }

    if (allConflicts.length > 0) {
      // persist conflicts for UI
      this.writeConflicts(cwd, allConflicts.map((c) => ({ ...c, at: new Date().toISOString(), resolved: false })))
      return { ok: false, error: 'conflicts exist, resolve first', conflicts: allConflicts }
    }

    // No conflicts -> push
    const files = this.localFiles(cwd)
    const msg = message ?? `maestro-memory sync: ${hash} — ${cwd.split('/').pop()} — ${new Date().toISOString()}`
    const pushRes = await this.git.push(cfg.remoteUrl, cfg.branch, files, msg)
    if (!pushRes.ok) return { ok: false, error: pushRes.error }

    // Update meta snapshot
    const entryIds: Record<string, string[]> = {}
    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const entries = readMemoryTrack(root, cwd, track)
      entryIds[track] = [...new Set(entries.map((e) => extractId(e)).filter(Boolean) as string[])].sort()
    }
    const todos = readTodoTrackRaw(root, cwd)
    entryIds['TODOS'] = [...new Set(todos.map((e) => extractId(e)).filter(Boolean) as string[])].sort()

    const newMeta: SyncMeta = {
      hash,
      cwd,
      branch: cfg.branch,
      remoteUrl: cfg.remoteUrl,
      pushedAt: new Date().toISOString(),
      entryIds,
      version: 1,
    }
    writeMeta(root, hash, newMeta)
    // clear conflicts after successful push
    this.writeConflicts(cwd, [])
    return { ok: true, pushed: true, conflicts: [] }
  }

  // -------------------------------------------------------------------------
  // pull (apply union merge)
  // -------------------------------------------------------------------------
  async pull(cwd: string): Promise<{ ok: true; merged: boolean; conflicts: any[] } | { ok: false; error: string; conflicts?: any[] }> {
    const hash = this.hashFor(cwd)
    const root = this.root()
    if (isWriteBlockedSync(root)) return { ok: false, error: `write blocked: migration verify mismatch (see ${join(maestroMetaDir(root), 'write-block.json')})` }
    const cfg = readConfig(root, hash)
    if (!cfg) return { ok: false, error: 'sync disabled for this project' }

    const fetchRes = await this.git.fetch(cfg.remoteUrl, cfg.branch)
    if (!fetchRes.ok) return { ok: false, error: fetchRes.error }
    const remoteRes = await this.git.getRemoteFiles(cfg.remoteUrl, cfg.branch)
    if (!remoteRes.ok) return { ok: false, error: remoteRes.error }

    const meta = readMeta(root, hash)
    const allConflicts: any[] = []
    let didMerge = false

    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const fileKey = track === 'KEY' ? 'KEY.md' : track === 'MEMORY' ? 'MEMORY.md' : 'KEY-archive.md'
      const localEntries = readMemoryTrack(root, cwd, track)
      const remoteEntries = parseEntries(remoteRes.files[fileKey] ?? '')
      const res = mergeMemoryEntries({ track, local: localEntries, remote: remoteEntries, baseIds: baseIdsFromMeta(meta, track) })
      if (res.conflicts.length) {
        allConflicts.push(...res.conflicts.map((c) => ({ track, id: c.id, localEntry: c.localEntry, remoteEntry: c.remoteEntry, reason: c.reason })))
      }
      // Write merged (local union plus non-conflicting remote)
      if (res.merged.length !== localEntries.length || res.addedRemote.length > 0) {
        writeMemoryTrack(root, cwd, track, res.merged)
        didMerge = true
      }
    }

    // TODOS
    {
      const localTodos = readTodoTrackRaw(root, cwd)
      const remoteTodos = (() => {
        const txt = remoteRes.files['TODOS.md'] ?? ''
        const body = txt.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^\s*§\s*\n?/, '').trim()
        return body ? body.split(ENTRY_DELIMITER).map((s) => s.trim()).filter(Boolean) : []
      })()
      const res = mergeTodoEntries({ local: localTodos, remote: remoteTodos, baseIds: baseIdsFromMeta(meta, 'TODOS') })
      if (res.conflicts.length) allConflicts.push(...res.conflicts.map((c) => ({ track: 'TODOS', id: c.id, localEntry: c.localEntry, remoteEntry: c.remoteEntry, reason: c.reason })))
      if (res.merged.length !== localTodos.length || res.addedRemote.length > 0) {
        // write todos
        const p = projectTodoPath(root, cwd)
        mkdirSync(dirname(p), { recursive: true })
        const out = `${TODO_HEADER}${res.merged.length ? `\n§\n${res.merged.join(ENTRY_DELIMITER)}\n` : ''}`
        writeFileSync(p, out, 'utf8')
        didMerge = true
      }
    }

    if (allConflicts.length > 0) {
      this.writeConflicts(cwd, allConflicts.map((c) => ({ ...c, at: new Date().toISOString(), resolved: false })))
      // Still considered merged with conflicts pending? Return ok with conflicts
      return { ok: true, merged: didMerge, conflicts: allConflicts }
    }

    // No conflicts -> update meta to current snapshot
    const entryIds: Record<string, string[]> = {}
    for (const track of ['KEY', 'MEMORY', 'KEY-archive']) {
      const entries = readMemoryTrack(root, cwd, track)
      entryIds[track] = [...new Set(entries.map((e) => extractId(e)).filter(Boolean) as string[])].sort()
    }
    const todos = readTodoTrackRaw(root, cwd)
    entryIds['TODOS'] = [...new Set(todos.map((e) => extractId(e)).filter(Boolean) as string[])].sort()
    writeMeta(root, hash, {
      hash,
      cwd,
      branch: cfg.branch,
      remoteUrl: cfg.remoteUrl,
      pushedAt: new Date().toISOString(),
      entryIds,
      version: 1,
    })
    this.writeConflicts(cwd, [])
    return { ok: true, merged: didMerge, conflicts: [] }
  }

  // -------------------------------------------------------------------------
  // resolve
  // -------------------------------------------------------------------------
  resolve(cwd: string, id: string, choice: 'local' | 'remote' | 'both'): { ok: true } | { ok: false; error: string } {
    if (!id) return { ok: false, error: 'id required' }
    if (!['local', 'remote', 'both'].includes(choice)) return { ok: false, error: 'invalid choice' }
    const hash = this.hashFor(cwd)
    const root = this.root()
    const cfg = readConfig(root, hash)
    if (!cfg) return { ok: false, error: 'sync disabled' }
    const conflicts = this.listConflicts(cwd)
    const idx = conflicts.findIndex((c) => c.id.toLowerCase() === id.toLowerCase())
    if (idx === -1) return { ok: false, error: `no conflict with id ${id}` }
    const rec = conflicts[idx]
    const track: string = rec.track

    if (track === 'TODOS') {
      const entries = readTodoTrackRaw(root, cwd)
      const idLC = id.toLowerCase()
      const localIdx = entries.findIndex((e) => (extractId(e) ?? '').toLowerCase() === idLC)
      if (choice === 'local') {
        // keep local, discard remote (do nothing)
      } else if (choice === 'remote') {
        if (localIdx !== -1) {
          // replace local entry with remoteEntry
          entries[localIdx] = rec.remoteEntry
          const p = projectTodoPath(root, cwd)
          writeFileSync(p, `${TODO_HEADER}${entries.length ? `\n§\n${entries.join(ENTRY_DELIMITER)}\n` : ''}`, 'utf8')
        } else {
          // local missing, add remote
          entries.push(rec.remoteEntry)
          const p = projectTodoPath(root, cwd)
          writeFileSync(p, `${TODO_HEADER}${entries.length ? `\n§\n${entries.join(ENTRY_DELIMITER)}\n` : ''}`, 'utf8')
        }
      } else if (choice === 'both') {
        // keep both: local stays, remote re-stamped with new id
        const newId = randomBytes(4).toString('hex')
        const remoteRestamped = String(rec.remoteEntry).replace(/\[id:\s*[0-9a-f]{8}\]/i, `[id: ${newId}]`)
        entries.push(remoteRestamped)
        const p = projectTodoPath(root, cwd)
        writeFileSync(p, `${TODO_HEADER}${entries.length ? `\n§\n${entries.join(ENTRY_DELIMITER)}\n` : ''}`, 'utf8')
      }
    } else {
      const entries = readMemoryTrack(root, cwd, track)
      const idLC = id.toLowerCase()
      const localIdx = entries.findIndex((e) => (extractId(e) ?? '').toLowerCase() === idLC)
      if (choice === 'local') {
        // keep local unchanged
      } else if (choice === 'remote') {
        if (localIdx !== -1) entries[localIdx] = rec.remoteEntry
        else entries.push(rec.remoteEntry)
        writeMemoryTrack(root, cwd, track, entries)
      } else if (choice === 'both') {
        const newId = randomBytes(4).toString('hex')
        const remoteRestamped = String(rec.remoteEntry).replace(/\[id:\s*[0-9a-f]{8}\]/i, `[id: ${newId}]`)
        // keep local, add restamped remote
        entries.push(remoteRestamped)
        writeMemoryTrack(root, cwd, track, entries)
      }
    }

    // remove resolved conflict
    conflicts.splice(idx, 1)
    this.writeConflicts(cwd, conflicts)
    return { ok: true }
  }
}
