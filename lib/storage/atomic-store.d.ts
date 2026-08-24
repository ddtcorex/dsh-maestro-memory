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
/** Entry delimiter, byte-compatible with Hermes MEMORY.md / USER.md. */
export declare const ENTRY_DELIMITER = "\n\u00A7\n";
/**
 * Split raw file text into trimmed, non-empty entries.
 * @param text - raw file content
 * @returns entries
 */
export declare function parseEntries(text: string): string[];
/**
 * Serialize entries into canonical file text.
 * @param entries - entries to serialize
 * @returns canonical file content (entries joined by delimiter + trailing newline)
 */
export declare function serializeEntries(entries: string[]): string;
/**
 * Whether raw text is the canonical serialization of its own entries.
 * Blank / whitespace-only text counts as canonical (empty store).
 * @param text - raw file content
 * @returns true when round-tripping preserves the text
 */
export declare function isCanonical(text: string): boolean;
/**
 * Strip the `[id:xxxxxxxx]` prefix from an entry, if present.
 * @param entry - full entry text
 * @returns text without the ID prefix
 */
export declare function stripEntryId(entry: string): string;
/**
 * Check whether `candidate` already exists in `entries`, comparing after
 * stripping IDs so a re-add with a new random ID is still detected as a
 * duplicate (IDs are random per write, direct includes would never hit).
 * @param entries - existing entries
 * @param candidate - new entry text
 * @returns true when a duplicate exists
 */
export declare function isDuplicate(entries: string[], candidate: string): boolean;
/**
 * Find the exact index of `exact` in `entries`, ID-immune (strip-and-compare).
 * Returns -1 when not found or when multiple hits make the match ambiguous.
 * @param entries - existing entries
 * @param exact - full entry text to find
 * @returns index or -1
 */
export declare function findExactIndex(entries: string[], exact: string): number;
/** A lock file older than this is considered abandoned (stale). */
export declare const STALE_LOCK_MS = 10000;
/** How long to keep waiting for the lock before failing. */
export declare const LOCK_TIMEOUT_MS = 5000;
/** Spin interval while waiting for the lock. */
export declare const LOCK_RETRY_MS = 25;
/** Lock file name inside each directory. */
export declare const LOCK_FILE = ".maestro.lock";
/**
 * Determine whether a lock is stale (exported for tests): mtime timeout or
 * the pid inside the lock file is no longer alive (killed / power loss ->
 * stale immediately without waiting for timeout).
 * @param lockPath - lock file path
 * @returns true when stale
 */
export declare function isStaleLock(lockPath: string): boolean;
/** Async variant of stale check for the async lock path. */
export declare function isStaleLockAsync(lockPath: string): Promise<boolean>;
/**
 * Acquire the directory lock synchronously, run `fn`, release.
 * Reentrant within this process (outer section remains exclusive vs others).
 * @param dir - directory whose lock to take
 * @param fn - critical section
 * @returns section result
 */
export declare function withLockSync<T>(dir: string, fn: () => T): T;
/**
 * Acquire the directory lock asynchronously, run `fn`, release.
 * Reentrant within this process.
 * @param dir - directory whose lock to take
 * @param fn - critical section (may be async)
 * @returns section result
 */
export declare function withLock<T>(dir: string, fn: () => T | Promise<T>): Promise<T>;
/**
 * Create a backup of `filePath` at `<file>.bak.<timestamp>`.
 * Returns the backup path, or null when the source does not exist.
 * @param filePath - file to back up
 * @returns backup path or null
 */
export declare function createBackupSync(filePath: string): string | null;
/**
 * Async backup.
 * @param filePath - file to back up
 * @returns backup path or null
 */
export declare function createBackup(filePath: string): Promise<string | null>;
/**
 * Durably replace `filePath` with `content` via same-directory temp file,
 * fsync, atomic rename, directory fsync, and reread validation.
 * @param filePath - absolute target file path
 * @param content - full new file content
 */
export declare function writeAtomic(filePath: string, content: string): Promise<void>;
/**
 * Synchronous atomic write (same guarantees, blocking).
 * @param filePath - absolute target file path
 * @param content - full new file content
 */
export declare function writeAtomicSync(filePath: string, content: string): void;
/**
 * Read entries from `filePath`. Missing file yields [].
 * @param filePath - file to read
 * @returns parsed entries
 */
export declare function readEntriesSync(filePath: string): string[];
/**
 * Async read entries.
 * @param filePath - file to read
 * @returns parsed entries
 */
export declare function readEntries(filePath: string): Promise<string[]>;
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
export declare function appendEntryAtomic(filePath: string, entry: string): Promise<{
    ok: true;
    duplicate?: boolean;
    entries: string[];
} | {
    ok: false;
    error: string;
    backup?: string;
}>;
/**
 * Synchronous variant of appendEntryAtomic.
 * @param filePath - target file
 * @param entry - entry to append
 * @returns result
 */
export declare function appendEntryAtomicSync(filePath: string, entry: string): {
    ok: true;
    duplicate?: boolean;
    entries: string[];
} | {
    ok: false;
    error: string;
    backup?: string;
};
/**
 * Replace or remove via atomic write with drift guard and backup.
 * Caller provides the next entries array; this validates, backs up on drift, and writes.
 * @param filePath - target file
 * @param nextEntries - complete new entries array
 * @returns result
 */
export declare function writeEntriesAtomic(filePath: string, nextEntries: string[]): Promise<{
    ok: true;
    entries: string[];
} | {
    ok: false;
    error: string;
    backup?: string;
}>;
/**
 * Synchronous variant.
 * @param filePath - target file
 * @param nextEntries - complete new entries array
 * @returns result
 */
export declare function writeEntriesAtomicSync(filePath: string, nextEntries: string[]): {
    ok: true;
    entries: string[];
} | {
    ok: false;
    error: string;
    backup?: string;
};
/**
 * Stable 12-hex project hash for a cwd.
 * @param cwd - working directory
 * @returns 12-char hash
 */
export declare function projectHash(cwd: string): string;
//# sourceMappingURL=atomic-store.d.ts.map