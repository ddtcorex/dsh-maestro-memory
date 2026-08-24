/**
 * Atomic file store for Maestro memory — per-directory lock, temp-write/rename,
 * reread validation, backups, duplicate detection.
 *
 * Each mutation:
 *  1. Acquires a same-directory lock file (.maestro.lock) with stale detection
 *     (mtime timeout + pid liveness via kill(pid,0)).
 *  2. Validates the on-disk content round-trips through parseEntries/serializeEntries.
 *     Non-canonical files are backed up to `<file>.bak.<timestamp>` before the
 *     operation is refused (drift guard).
 *  3. Checks for exact duplicates (ID-stripped) so re-adds are no-ops.
 *  4. Writes to a same-directory temp file (`.<uuid>.tmp`, mode 0o600, flag wx),
 *     fsyncs the temp, renames atomically over the target, fsyncs the parent
 *     directory on POSIX, then rereads and validates the result.
 *  5. Cleans up the temp file on any failure; the previous file is never
 *     clobbered on error.
 *
 * Uses only `node:fs` / `node:fs/promises` atomic primitives: open(wx),
 * writeFile, fsync, rename, unlink. No third-party dependencies.
 *
 * @module storage/atomic-store
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// Delimiter + parse/serialize (pure, no I/O)
// ---------------------------------------------------------------------------

/** Entry delimiter, byte-compatible with Hermes MEMORY.md / USER.md. */
export const ENTRY_DELIMITER = '\n§\n'

/**
 * Split raw file text into trimmed, non-empty entries.
 * @param text - raw file content
 * @returns entries
 */
export function parseEntries(text: string): string[] {
  return text
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
}

/**
 * Serialize entries into canonical file text.
 * @param entries - entries to serialize
 * @returns canonical file content (entries joined by delimiter + trailing newline)
 */
export function serializeEntries(entries: string[]): string {
  return entries.length === 0 ? '' : entries.join(ENTRY_DELIMITER) + '\n'
}

/**
 * Whether raw text is the canonical serialization of its own entries.
 * Blank / whitespace-only text counts as canonical (empty store).
 * @param text - raw file content
 * @returns true when round-tripping preserves the text
 */
export function isCanonical(text: string): boolean {
  return text.trim() === '' || serializeEntries(parseEntries(text)) === text
}

// ---------------------------------------------------------------------------
// Duplicate detection (ID-aware)
// ---------------------------------------------------------------------------

/** Regex for cross-device entry ID prefix (space after colon allowed, case-insensitive). */
const ENTRY_ID_RE = /^\[id:\s*[0-9a-f]{8}\]\s*/i

/**
 * Strip the `[id:xxxxxxxx]` prefix from an entry, if present.
 * @param entry - full entry text
 * @returns text without the ID prefix
 */
export function stripEntryId(entry: string): string {
  return String(entry).replace(ENTRY_ID_RE, '')
}

/**
 * Check whether `candidate` already exists in `entries`, comparing after
 * stripping IDs so a re-add with a new random ID is still detected as a
 * duplicate (IDs are random per write, direct includes would never hit).
 * @param entries - existing entries
 * @param candidate - new entry text
 * @returns true when a duplicate exists
 */
export function isDuplicate(entries: string[], candidate: string): boolean {
  const needle = stripEntryId(candidate)
  return entries.some((e) => stripEntryId(e) === needle)
}

/**
 * Find the exact index of `exact` in `entries`, ID-immune (strip-and-compare).
 * Returns -1 when not found or when multiple hits make the match ambiguous.
 * @param entries - existing entries
 * @param exact - full entry text to find
 * @returns index or -1
 */
export function findExactIndex(entries: string[], exact: string): number {
  const target = stripEntryId(exact)
  let found = -1
  for (let i = 0; i < entries.length; i++) {
    if (stripEntryId(entries[i]) === target) {
      if (found !== -1) return -1 // ambiguous
      found = i
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Lock (per-directory)
// ---------------------------------------------------------------------------

/** A lock file older than this is considered abandoned (stale). */
export const STALE_LOCK_MS = 10_000
/** How long to keep waiting for the lock before failing. */
export const LOCK_TIMEOUT_MS = 5_000
/** Spin interval while waiting for the lock. */
export const LOCK_RETRY_MS = 25

/** Lock file name inside each directory. */
export const LOCK_FILE = '.maestro.lock'

/** Directories whose lock this process currently holds (reentrancy guard). */
const heldLocks = new Set<string>()

/** Lock file content: pid + timestamp for stale detection. */
function lockJson(): string {
  return JSON.stringify({ pid: process.pid, at: Date.now() })
}

/**
 * Determine whether a lock is stale (exported for tests): mtime timeout or
 * the pid inside the lock file is no longer alive (killed / power loss ->
 * stale immediately without waiting for timeout).
 * @param lockPath - lock file path
 * @returns true when stale
 */
export function isStaleLock(lockPath: string): boolean {
  try {
    const info = statSync(lockPath)
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8'))
      if (typeof owner.pid === 'number') {
        try {
          process.kill(owner.pid, 0)
          return false // owner alive -> valid
        } catch {
          return true // owner dead
        }
      }
    } catch {
      // old-format / unparseable -> fall back to mtime
    }
    return Date.now() - info.mtimeMs > STALE_LOCK_MS
  } catch {
    return false
  }
}

/** Async variant of stale check for the async lock path. */
export async function isStaleLockAsync(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8'))
      if (typeof owner.pid === 'number') {
        try {
          process.kill(owner.pid, 0)
          return false
        } catch {
          return true
        }
      }
    } catch {
      // fall back to mtime
    }
    return Date.now() - info.mtimeMs > STALE_LOCK_MS
  } catch {
    return false
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Acquire the directory lock synchronously, run `fn`, release.
 * Reentrant within this process (outer section remains exclusive vs others).
 * @param dir - directory whose lock to take
 * @param fn - critical section
 * @returns section result
 */
export function withLockSync<T>(dir: string, fn: () => T): T {
  if (heldLocks.has(dir)) return fn()
  const lockPath = join(dir, LOCK_FILE)
  mkdirSync(dir, { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    let acquired = false
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(lockPath, lockJson())
      } finally {
        closeSync(fd)
      }
      acquired = true
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
    }
    if (acquired) break
    if (isStaleLock(lockPath)) rmSync(lockPath, { force: true })
    if (Date.now() >= deadline) throw new Error('atomic-store: timed out waiting for directory lock')
    sleepSync(LOCK_RETRY_MS)
  }
  heldLocks.add(dir)
  try {
    return fn()
  } finally {
    heldLocks.delete(dir)
    rmSync(lockPath, { force: true })
  }
}

/**
 * Acquire the directory lock asynchronously, run `fn`, release.
 * Reentrant within this process.
 * @param dir - directory whose lock to take
 * @param fn - critical section (may be async)
 * @returns section result
 */
export async function withLock<T>(dir: string, fn: () => T | Promise<T>): Promise<T> {
  if (heldLocks.has(dir)) return await fn()
  const lockPath = join(dir, LOCK_FILE)
  await mkdir(dir, { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    let acquired = false
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(lockJson(), 'utf8')
      } finally {
        await handle.close()
      }
      acquired = true
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
    }
    if (acquired) break
    if (await isStaleLockAsync(lockPath)) await rm(lockPath, { force: true })
    if (Date.now() >= deadline) throw new Error('atomic-store: timed out waiting for directory lock')
    await sleep(LOCK_RETRY_MS)
  }
  heldLocks.add(dir)
  try {
    return await fn()
  } finally {
    heldLocks.delete(dir)
    await rm(lockPath, { force: true })
  }
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/**
 * Create a backup of `filePath` at `<file>.bak.<timestamp>`.
 * Returns the backup path, or null when the source does not exist.
 * @param filePath - file to back up
 * @returns backup path or null
 */
export function createBackupSync(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const backupPath = `${filePath}.bak.${Date.now()}`
  const data = readFileSync(filePath)
  writeFileSync(backupPath, data)
  return backupPath
}

/**
 * Async backup.
 * @param filePath - file to back up
 * @returns backup path or null
 */
export async function createBackup(filePath: string): Promise<string | null> {
  try {
    const data = await readFile(filePath)
    const backupPath = `${filePath}.bak.${Date.now()}`
    // Create backup atomically; if it exists, bump timestamp
    await writeFile(backupPath, data, { flag: 'wx', mode: 0o600 })
    return backupPath
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

// ---------------------------------------------------------------------------
// Atomic write: temp-write / rename / reread validation
// ---------------------------------------------------------------------------

/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens */
async function fsyncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(dir, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function fsyncDirectorySync(dir: string): void {
  if (process.platform === 'win32') return
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
/* v8 ignore stop */

/**
 * Durably replace `filePath` with `content` via same-directory temp file,
 * fsync, atomic rename, directory fsync, and reread validation.
 * @param filePath - absolute target file path
 * @param content - full new file content
 */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, filePath)
    await fsyncDirectory(dir)
    // Reread validation: ensure the file now contains exactly what we wrote.
    const reread = await readFile(filePath, 'utf8')
    if (reread !== content) {
      throw new Error(`atomic-store: reread validation failed for ${filePath} (expected ${content.length} chars, got ${reread.length})`)
    }
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/**
 * Synchronous atomic write (same guarantees, blocking).
 * @param filePath - absolute target file path
 * @param content - full new file content
 */
export function writeAtomicSync(filePath: string, content: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    const fd = openSync(tmp, 'wx', 0o600)
    try {
      writeFileSync(tmp, content, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, filePath)
    fsyncDirectorySync(dir)
    // Reread validation
    const reread = readFileSync(filePath, 'utf8')
    if (reread !== content) {
      throw new Error(`atomic-store: reread validation failed for ${filePath}`)
    }
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

// ---------------------------------------------------------------------------
// High-level entry helpers (lock + backup + duplicate detection + atomic write)
// ---------------------------------------------------------------------------

/**
 * Read entries from `filePath`. Missing file yields [].
 * @param filePath - file to read
 * @returns parsed entries
 */
export function readEntriesSync(filePath: string): string[] {
  try {
    return parseEntries(readFileSync(filePath, 'utf8'))
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw error
  }
}

/**
 * Async read entries.
 * @param filePath - file to read
 * @returns parsed entries
 */
export async function readEntries(filePath: string): Promise<string[]> {
  try {
    return parseEntries(await readFile(filePath, 'utf8'))
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw error
  }
}

/**
 * Append `entry` to `filePath` atomically, with duplicate detection and
 * drift-guard backup.
 *
 * - Acquires per-directory lock.
 * - Validates existing content is canonical; if not, backs up and throws.
 * - Checks for duplicate (ID-stripped); returns `{duplicate:true}` without writing.
 * - Writes via temp+rename+reread.
 *
 * @param filePath - target file
 * @param entry - entry to append (already trimmed)
 * @returns result
 */
export async function appendEntryAtomic(
  filePath: string,
  entry: string,
): Promise<{ ok: true; duplicate?: boolean; entries: string[] } | { ok: false; error: string; backup?: string }> {
  const dir = dirname(filePath)
  return withLock(dir, async () => {
    // Drift guard: read raw and validate
    let raw = ''
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      raw = ''
    }
    if (raw !== '' && !isCanonical(raw)) {
      const backup = await createBackup(filePath)
      return { ok: false as const, error: `drift: non-canonical content backed up to ${backup}`, backup: backup ?? undefined }
    }
    const entries = parseEntries(raw)
    if (isDuplicate(entries, entry)) {
      return { ok: true as const, duplicate: true, entries }
    }
    const next = [...entries, entry]
    const content = serializeEntries(next)
    await writeAtomic(filePath, content)
    return { ok: true as const, entries: next }
  })
}

/**
 * Synchronous variant of appendEntryAtomic.
 * @param filePath - target file
 * @param entry - entry to append
 * @returns result
 */
export function appendEntryAtomicSync(
  filePath: string,
  entry: string,
): { ok: true; duplicate?: boolean; entries: string[] } | { ok: false; error: string; backup?: string } {
  const dir = dirname(filePath)
  return withLockSync(dir, () => {
    let raw = ''
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      raw = ''
    }
    if (raw !== '' && !isCanonical(raw)) {
      const backup = createBackupSync(filePath)
      return { ok: false, error: `drift: non-canonical content backed up to ${backup}`, backup: backup ?? undefined }
    }
    const entries = parseEntries(raw)
    if (isDuplicate(entries, entry)) {
      return { ok: true, duplicate: true, entries }
    }
    const next = [...entries, entry]
    const content = serializeEntries(next)
    writeAtomicSync(filePath, content)
    return { ok: true, entries: next }
  })
}

/**
 * Replace or remove via atomic write with drift guard and backup.
 * Caller provides the next entries array; this validates, backs up on drift, and writes.
 * @param filePath - target file
 * @param nextEntries - complete new entries array
 * @returns result
 */
export async function writeEntriesAtomic(
  filePath: string,
  nextEntries: string[],
): Promise<{ ok: true; entries: string[] } | { ok: false; error: string; backup?: string }> {
  const dir = dirname(filePath)
  return withLock(dir, async () => {
    let raw = ''
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      raw = ''
    }
    if (raw !== '' && !isCanonical(raw)) {
      const backup = await createBackup(filePath)
      return { ok: false, error: `drift: non-canonical content backed up to ${backup}`, backup: backup ?? undefined }
    }
    const content = serializeEntries(nextEntries)
    await writeAtomic(filePath, content)
    return { ok: true, entries: nextEntries }
  })
}

/**
 * Synchronous variant.
 * @param filePath - target file
 * @param nextEntries - complete new entries array
 * @returns result
 */
export function writeEntriesAtomicSync(
  filePath: string,
  nextEntries: string[],
): { ok: true; entries: string[] } | { ok: false; error: string; backup?: string } {
  const dir = dirname(filePath)
  return withLockSync(dir, () => {
    let raw = ''
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      raw = ''
    }
    if (raw !== '' && !isCanonical(raw)) {
      const backup = createBackupSync(filePath)
      return { ok: false, error: `drift: non-canonical content backed up to ${backup}`, backup: backup ?? undefined }
    }
    const content = serializeEntries(nextEntries)
    writeAtomicSync(filePath, content)
    return { ok: true, entries: nextEntries }
  })
}

// ---------------------------------------------------------------------------
// Utility: project hash (re-export for layout consumers)
// ---------------------------------------------------------------------------

/**
 * Stable 12-hex project hash for a cwd.
 * @param cwd - working directory
 * @returns 12-char hash
 */
export function projectHash(cwd: string): string {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}
