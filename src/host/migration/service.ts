/**
 * migration/service.ts — inspect/dryRun/run/verify, backup manifest, journal, write-block on mismatch
 *
 * Implements M3-PR-B migration engine: in-place adoption, byte-preserving backup,
 * SHA-256 verified, parser inventory, malformed JSONL tolerant, missing optional files tolerant,
 * noncanonical/lock warnings, and write-block on verify mismatch.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  copyFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { join, relative, dirname } from 'node:path'
import {
  resolveMemoryRoot,
  maestroMetaDir,
  schemaPath,
  journalPath,
  backupsDir,
  backupManifestPath,
  backupFilesDirPath,
} from '../storage/layout.ts'
import { parseEntries, isCanonical } from '../storage/legacy-format.ts'
import { parseTodoEntry } from '../storage/legacy-format.ts'

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function readBytesAndHash(filePath: string): { bytes: number; sha256: string; raw: Buffer } {
  const raw = readFileSync(filePath)
  return { bytes: raw.length, sha256: sha256Hex(raw), raw }
}

function listDailyFiles(root: string): string[] {
  const dailyRoot = join(root, 'daily')
  try {
    const names = readdirSync(dailyRoot)
    return names.filter((n) => n.endsWith('.md') || n.endsWith('.todo.md')).map((n) => join(dailyRoot, n))
  } catch {
    return []
  }
}

function listProjectFiles(root: string): string[] {
  const projRoot = join(root, 'projects')
  try {
    const hashes = readdirSync(projRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    const out: string[] = []
    for (const h of hashes) {
      const dir = join(projRoot, h)
      for (const name of ['MEMORY.md', 'KEY.md', 'KEY-archive.md', 'TODOS.md']) {
        const p = join(dir, name)
        out.push(p) // push even if missing; caller will check exists
      }
    }
    return out
  } catch {
    return []
  }
}

function collectExpectedPaths(root: string): string[] {
  const expected: string[] = [
    join(root, 'MEMORY.md'),
    join(root, 'USER.md'),
    join(root, 'MEMORY-archive.md'),
    join(root, 'USER-archive.md'),
    join(root, 'SUGGESTIONS.jsonl'),
    join(root, 'TODOS-life.md'),
    join(root, 'TODOS-work.md'),
    join(root, 'TODO-archive.md'),
  ]
  expected.push(...listDailyFiles(root))
  expected.push(...listProjectFiles(root))
  // also include any daily files that may exist but we already added; ensure uniqueness
  // Also include any extra files under root for backup completeness: scan all files recursively excluding .maestro-memory
  // But for inspect we want to list expected + known daily/project; extra files will be discovered via full scan for backup
  return expected
}

function scanAllForBackup(root: string): string[] {
  const out: string[] = []
  function walk(dir: string): void {
    let entries: any[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (p.includes('.maestro-memory')) continue
      if (e.isDirectory()) {
        // skip .maestro-memory at any depth
        if (e.name === '.maestro-memory') continue
        walk(p)
      } else if (e.isFile()) {
        out.push(p)
      }
    }
  }
  walk(root)
  return out
}

function parseMemoryEntriesSafe(text: string): { entries: string[]; isCanonical: boolean } {
  const entries = parseEntries(text)
  const canon = text.trim() === '' || isCanonical(text)
  return { entries, isCanonical: canon }
}

function parseTodoFileSafe(filePath: string): { count: number; ids: string[]; valid: number; malformed: number } {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return { count: 0, ids: [], valid: 0, malformed: 0 }
  }
  // strip header comment
  const body = raw.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^\s*§\s*\n?/, '').trim()
  if (body === '') return { count: 0, ids: [], valid: 0, malformed: 0 }
  const parts = body.split('\n§\n').map((s) => s.trim()).filter(Boolean)
  const ids: string[] = []
  let valid = 0
  for (const p of parts) {
    const parsed = parseTodoEntry(p)
    if (parsed && parsed.id) {
      valid += 1
      ids.push(parsed.id)
    }
  }
  return { count: parts.length, ids, valid, malformed: parts.length - valid }
}

function parseQueueSafe(filePath: string): { valid: number; malformed: number; entries: any[] } {
  try {
    const text = readFileSync(filePath, 'utf8')
    const lines = text.split('\n')
    let valid = 0
    let malformed = 0
    const entries: any[] = []
    for (const line of lines) {
      if (line.trim() === '') continue
      try {
        const obj = JSON.parse(line)
        if (obj && typeof obj.target === 'string' && typeof obj.content === 'string') {
          valid += 1
          entries.push(obj)
        } else {
          malformed += 1
        }
      } catch {
        malformed += 1
      }
    }
    return { valid, malformed, entries }
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { valid: 0, malformed: 0, entries: [] }
    throw e
  }
}

export interface FileInfo {
  path: string
  relative: string
  exists: boolean
  bytes: number
  sha256: string | null
  kind: string
  entries?: number
  ids?: string[]
  malformedLines?: number
  valid?: number
  warning?: string | null
}

export interface InspectResult {
  ok: boolean
  root: string
  files: FileInfo[]
  inventory: {
    memoryEntries: number
    todoIds: string[]
    todoIdsCount: number
    todoCount: number
    queueValid: number
    queueMalformed: number
    dailyFiles: number
    projectDirs: number
  } & Record<string, any>
  warnings: string[]
  errors: string[]
}

function kindFor(filePath: string, root: string): string {
  const rel = relative(root, filePath)
  if (rel === 'MEMORY.md' || rel === 'USER.md') return 'memory'
  if (rel.endsWith('-archive.md')) return 'archive'
  if (rel.endsWith('SUGGESTIONS.jsonl')) return 'queue'
  if (rel.startsWith('daily/') && rel.endsWith('.todo.md')) return 'todo-daily'
  if (rel.startsWith('daily/')) return 'daily'
  if (rel.includes('projects/') && rel.endsWith('TODOS.md')) return 'todo-project'
  if (rel.includes('projects/') && rel.endsWith('KEY.md')) return 'key'
  if (rel.includes('projects/') && rel.endsWith('KEY-archive.md')) return 'archive'
  if (rel.includes('projects/') && rel.endsWith('MEMORY.md')) return 'project'
  if (rel.startsWith('TODOS-') || rel === 'TODOS-life.md' || rel === 'TODOS-work.md') return 'todo'
  if (rel === 'TODO-archive.md') return 'archive'
  return 'other'
}

export async function inspect(memoryDir: string | null | undefined = null): Promise<InspectResult> {
  const root = resolveMemoryRoot(memoryDir as any)
  const warnings: string[] = []
  const errors: string[] = []
  const files: FileInfo[] = []

  const expected = collectExpectedPaths(root)
  // Use set to deduplicate expected
  const seen = new Set<string>()
  const expectedUnique = expected.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })

  let totalMemoryEntries = 0
  let allTodoIds: string[] = []
  let totalTodoCount = 0
  let queueValid = 0
  let queueMalformed = 0
  let dailyFiles = 0
  let projectDirs = 0

  // Count project dirs
  try {
    const projRoot = join(root, 'projects')
    const hashes = readdirSync(projRoot, { withFileTypes: true }).filter((d) => d.isDirectory())
    projectDirs = hashes.length
  } catch {
    projectDirs = 0
  }
  try {
    dailyFiles = readdirSync(join(root, 'daily')).filter((n) => n.endsWith('.md')).length
  } catch {
    dailyFiles = 0
  }

  for (const abs of expectedUnique) {
    const rel = relative(root, abs)
    const exists = existsSync(abs)
    if (!exists) {
      files.push({
        path: abs,
        relative: rel,
        exists: false,
        bytes: 0,
        sha256: null,
        kind: kindFor(abs, root),
        warning: null,
      })
      continue
    }
    const { bytes, sha256, raw } = readBytesAndHash(abs)
    const kind = kindFor(abs, root)
    let entriesCount: number | undefined
    let warning: string | null = null
    let malformedLines: number | undefined
    let valid: number | undefined
    let ids: string[] | undefined

    if (kind === 'memory' || kind === 'project' || kind === 'key' || kind === 'daily' || kind === 'archive') {
      const text = raw.toString('utf8')
      const { entries, isCanonical: canon } = parseMemoryEntriesSafe(text)
      entriesCount = entries.length
      totalMemoryEntries += entriesCount
      if (!canon && text.trim() !== '') {
        warning = `non-canonical content in ${rel} (drift)`
        warnings.push(`non-canonical: ${rel}`)
      }
    } else if (kind === 'todo' || kind === 'todo-project' || kind === 'todo-daily') {
      const info = parseTodoFileSafe(abs)
      entriesCount = info.count
      ids = info.ids
      allTodoIds.push(...info.ids)
      totalTodoCount += info.count
      if (info.malformed > 0) {
        warning = `malformed todo entries in ${rel}: ${info.malformed}`
        warnings.push(`malformed todo: ${rel} (${info.malformed})`)
      }
    } else if (kind === 'queue') {
      const q = parseQueueSafe(abs)
      queueValid = q.valid
      queueMalformed = q.malformed
      entriesCount = q.valid + q.malformed
      malformedLines = q.malformed
      valid = q.valid
      if (q.malformed > 0) {
        warning = `malformed JSONL in ${rel}: ${q.malformed} lines`
        warnings.push(`malformed JSONL: ${rel} (${q.malformed} malformed, ${q.valid} valid)`)
      }
    }

    files.push({
      path: abs,
      relative: rel,
      exists: true,
      bytes,
      sha256,
      kind,
      entries: entriesCount,
      ids,
      malformedLines,
      valid,
      warning,
    })
  }

  // Also detect lock files
  const lockPaths: string[] = []
  function findLocks(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === '.maestro-memory') continue
          findLocks(p)
        } else if (e.name === '.maestro.lock') {
          lockPaths.push(p)
        }
      }
    } catch {}
  }
  try {
    findLocks(root)
  } catch {}
  for (const lp of lockPaths) {
    warnings.push(`lock file present: ${relative(root, lp)}`)
  }

  // For backup completeness, also scan all files not in expected (extra legacy files like advisor/)
  const allFiles = scanAllForBackup(root)
  const expectedSet = new Set(expectedUnique)
  for (const abs of allFiles) {
    if (expectedSet.has(abs)) continue
    const rel = relative(root, abs)
    // already handled daily/project extra? but scan will catch additional files like advisor/
    const { bytes, sha256 } = readBytesAndHash(abs)
    files.push({
      path: abs,
      relative: rel,
      exists: true,
      bytes,
      sha256,
      kind: 'other',
      warning: null,
    })
  }

  // ok: inspect never blocks on missing optional or malformed; only errors would be unreadable?
  const ok = errors.length === 0

  return {
    ok,
    root,
    files,
    inventory: {
      memoryEntries: totalMemoryEntries,
      todoIds: allTodoIds,
      todoIdsCount: allTodoIds.length,
      todoCount: totalTodoCount,
      queueValid,
      queueMalformed,
      dailyFiles,
      projectDirs,
    },
    warnings,
    errors,
  }
}

export async function dryRun(memoryDir: string | null | undefined = null): Promise<InspectResult> {
  // dryRun is same as inspect but explicitly read-only; ensure no side effects
  return inspect(memoryDir)
}

function utcRunId(): string {
  const now = new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const yyyy = now.getUTCFullYear()
  const mm = pad(now.getUTCMonth() + 1)
  const dd = pad(now.getUTCDate())
  const hh = pad(now.getUTCHours())
  const mi = pad(now.getUTCMinutes())
  const ss = pad(now.getUTCSeconds())
  const ms = pad(now.getUTCMilliseconds(), 3)
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}.${ms}Z`
}

export interface RunResult {
  ok: boolean
  runId: string
  manifestPath: string
  backupFilesDir: string
  warnings: string[]
  errors: string[]
  files: FileInfo[]
}

export async function run(memoryDir: string | null | undefined = null): Promise<RunResult> {
  const root = resolveMemoryRoot(memoryDir as any)
  const insp = await inspect(root)
  if (insp.errors.length > 0) {
    return {
      ok: false,
      runId: '',
      manifestPath: '',
      backupFilesDir: '',
      warnings: insp.warnings,
      errors: insp.errors,
      files: insp.files,
    }
  }
  const runId = utcRunId()
  const manifestPath = backupManifestPath(root, runId)
  const backupFilesDir = backupFilesDirPath(root, runId)
  mkdirSync(backupFilesDir, { recursive: true })
  mkdirSync(dirname(manifestPath), { recursive: true })

  // byte-preserving copy
  const manifestFiles: any[] = []
  for (const f of insp.files) {
    if (!f.exists) {
      manifestFiles.push({
        relative: f.relative,
        path: f.path,
        exists: false,
        bytes: 0,
        sha256: null,
        kind: f.kind,
        entries: f.entries ?? 0,
        malformedLines: f.malformedLines,
      })
      continue
    }
    const dest = join(backupFilesDir, f.relative)
    mkdirSync(dirname(dest), { recursive: true })
    // byte-preserving copy
    copyFileSync(f.path, dest)
    // verify backup matches
    const backupRaw = readFileSync(dest)
    const backupSha = sha256Hex(backupRaw)
    if (backupSha !== f.sha256) {
      throw new Error(`backup sha mismatch for ${f.relative}`)
    }
    manifestFiles.push({
      relative: f.relative,
      path: f.path,
      exists: true,
      bytes: f.bytes,
      sha256: f.sha256,
      kind: f.kind,
      entries: f.entries,
      ids: f.ids,
      malformedLines: f.malformedLines,
      valid: f.valid,
    })
  }

  const manifest = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    root,
    files: manifestFiles,
    inventory: insp.inventory,
    warnings: insp.warnings,
    errors: insp.errors,
    backupFilesDir,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  // write schema.json (only after all required data parses — we already did)
  const sPath = schemaPath(root)
  mkdirSync(dirname(sPath), { recursive: true })
  const schema = {
    version: 1,
    runId,
    migratedAt: new Date().toISOString(),
    root,
    inventory: insp.inventory,
    manifest: manifestPath,
  }
  writeFileSync(sPath, JSON.stringify(schema, null, 2), 'utf8')

  // journal
  const jPath = journalPath(root)
  mkdirSync(dirname(jPath), { recursive: true })
  const journalEntry = {
    runId,
    at: new Date().toISOString(),
    action: 'run',
    ok: true,
    warnings: insp.warnings,
    inventory: insp.inventory,
    manifest: manifestPath,
  }
  appendFileSync(jPath, JSON.stringify(journalEntry) + '\n', 'utf8')

  // clear any previous write-block on successful run
  const blockPath = join(maestroMetaDir(root), 'write-block.json')
  if (existsSync(blockPath)) {
    try {
      rmSync(blockPath, { force: true })
    } catch {}
  }

  return {
    ok: true,
    runId,
    manifestPath,
    backupFilesDir,
    warnings: insp.warnings,
    errors: [],
    files: insp.files,
  }
}

export interface VerifyResult {
  ok: boolean
  runId: string
  manifestPath: string
  mismatches: string[]
  warnings: string[]
}

function latestRunId(root: string): string | null {
  const dir = backupsDir(root)
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    if (entries.length === 0) return null
    return entries[entries.length - 1]
  } catch {
    return null
  }
}

export async function verify(memoryDir: string | null | undefined = null, runId?: string): Promise<VerifyResult> {
  const root = resolveMemoryRoot(memoryDir as any)
  let targetRunId = runId ?? null
  if (!targetRunId) {
    // try schema.json first
    try {
      const schema = JSON.parse(readFileSync(schemaPath(root), 'utf8'))
      targetRunId = schema.runId ?? null
    } catch {}
    if (!targetRunId) targetRunId = latestRunId(root)
  }
  if (!targetRunId) {
    return { ok: false, runId: '', manifestPath: '', mismatches: ['no manifest found'], warnings: [] }
  }
  const manifestPath = backupManifestPath(root, targetRunId)
  let manifest: any
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e: any) {
    return { ok: false, runId: targetRunId, manifestPath, mismatches: [`manifest not found: ${e?.message}`], warnings: [] }
  }

  const mismatches: string[] = []
  const warnings: string[] = []

  // check each file in manifest
  for (const f of manifest.files) {
    if (!f.exists) {
      // file was missing at backup time; should still be missing
      const curExists = existsSync(f.path)
      if (curExists) {
        mismatches.push(`unexpected file appeared: ${f.relative}`)
      }
      continue
    }
    const curExists = existsSync(f.path)
    if (!curExists) {
      mismatches.push(`missing file: ${f.relative} (expected sha ${f.sha256})`)
      continue
    }
    const cur = readFileSync(f.path)
    const curSha = sha256Hex(cur)
    if (curSha !== f.sha256) {
      mismatches.push(`digest mismatch: ${f.relative} (expected ${f.sha256?.slice(0, 8)}, got ${curSha.slice(0, 8)}, bytes ${f.bytes} -> ${cur.length})`)
    }
    if (cur.length !== f.bytes) {
      mismatches.push(`byte count mismatch: ${f.relative} (${f.bytes} -> ${cur.length})`)
    }
  }

  // also compare inventory via re-parse (entry counts + todo IDs)
  const currentInspect = await inspect(root)
  const manifestInv = manifest.inventory
  if (manifestInv) {
    if (currentInspect.inventory.memoryEntries !== manifestInv.memoryEntries) {
      mismatches.push(`inventory mismatch: memoryEntries ${manifestInv.memoryEntries} -> ${currentInspect.inventory.memoryEntries}`)
    }
    if (currentInspect.inventory.todoIdsCount !== manifestInv.todoIdsCount) {
      mismatches.push(`inventory mismatch: todoIds ${manifestInv.todoIdsCount} -> ${currentInspect.inventory.todoIdsCount}`)
    }
    if (currentInspect.inventory.queueValid !== manifestInv.queueValid) {
      mismatches.push(`inventory mismatch: queueValid ${manifestInv.queueValid} -> ${currentInspect.inventory.queueValid}`)
    }
    // check todo IDs set equality if counts match but ids differ
    if (manifestInv.todoIds && Array.isArray(manifestInv.todoIds)) {
      const curIdsSorted = [...currentInspect.inventory.todoIds].sort()
      const manIdsSorted = [...manifestInv.todoIds].sort()
      if (curIdsSorted.join(',') !== manIdsSorted.join(',')) {
        // only report if not already reported via count
        if (currentInspect.inventory.todoIdsCount === manifestInv.todoIdsCount) {
          mismatches.push(`todo ID set mismatch: ${manIdsSorted.join(',')} -> ${curIdsSorted.join(',')}`)
        }
      }
    }
  }

  const ok = mismatches.length === 0
  const blockPath = join(maestroMetaDir(root), 'write-block.json')
  if (!ok) {
    // write-block on mismatch
    mkdirSync(dirname(blockPath), { recursive: true })
    const block = {
      blocked: true,
      runId: targetRunId,
      at: new Date().toISOString(),
      mismatches,
      manifest: manifestPath,
    }
    writeFileSync(blockPath, JSON.stringify(block, null, 2), 'utf8')
    // also append to journal
    try {
      const jPath = journalPath(root)
      mkdirSync(dirname(jPath), { recursive: true })
      appendFileSync(jPath, JSON.stringify({ runId: targetRunId, at: new Date().toISOString(), action: 'verify', ok: false, mismatches }) + '\n', 'utf8')
    } catch {}
  } else {
    // on success, clear block if exists and log verify success
    if (existsSync(blockPath)) {
      try {
        rmSync(blockPath, { force: true })
      } catch {}
    }
    try {
      const jPath = journalPath(root)
      mkdirSync(dirname(jPath), { recursive: true })
      appendFileSync(jPath, JSON.stringify({ runId: targetRunId, at: new Date().toISOString(), action: 'verify', ok: true }) + '\n', 'utf8')
    } catch {}
  }

  return { ok, runId: targetRunId, manifestPath, mismatches, warnings }
}

export function isWriteBlocked(memoryDir: string | null | undefined = null): boolean {
  const root = resolveMemoryRoot(memoryDir as any)
  const blockPath = join(maestroMetaDir(root), 'write-block.json')
  if (!existsSync(blockPath)) return false
  try {
    const data = JSON.parse(readFileSync(blockPath, 'utf8'))
    return data.blocked === true
  } catch {
    return true
  }
}

export function clearWriteBlock(memoryDir: string | null | undefined = null): void {
  const root = resolveMemoryRoot(memoryDir as any)
  const blockPath = join(maestroMetaDir(root), 'write-block.json')
  if (existsSync(blockPath)) {
    try {
      rmSync(blockPath, { force: true })
    } catch {}
  }
}
