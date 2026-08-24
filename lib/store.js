/**
 * maestro-memory — memory storage layer (legacy: dsh-memory-evolve).
 *
 * Hermes-compatible persistent curated memory: plain-text files with `\n§\n`
 * entry delimiters, per-target character limits, a cross-process lock file,
 * atomic writes, and a drift guard that refuses full-file rewrites when the
 * on-disk content would not round-trip through the parser (manual edits,
 * shell appends, or sister-process writes).
 *
 * Write semantics mirror the Hermes memory tool:
 *   - add: append-only, skips the drift guard (never clobbers parsed entries),
 *     but refuses a file that exists and reads as empty (would wipe history);
 *   - replace / remove: match by a short unique substring, enforce the drift
 *     guard (full-file rewrite would discard un-roundtrippable content), back
 *     up drifted files to `<file>.bak.<timestamp>` before refusing.
 *
 * All operations are synchronous (files are tiny) and serialized through one
 * lock file per directory so multiple DSH processes or external editors
 * cannot interleave writes.
 *
 * Zero runtime dependencies (node:fs only).
 *
 * @module maestro-memory/store (legacy: dsh-memory-evolve/store)
 */

import { createHash } from 'node:crypto'
import { getLocale, translate, STORE_DICT, STORE_TAIL_DICT } from './i18n.js'

/** Translate through STORE_DICT in the active host locale. */
const st = (key, params) => translate(STORE_DICT, key, params, getLocale())
/** Translate through STORE_TAIL_DICT in the active host locale. */
const stt = (key, params) => translate(STORE_TAIL_DICT, key, params, getLocale())
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { extractEntryId, genEntryId, legacyIdFor, stripEntryId } from './sync/entryid.js'

/** Entry delimiter, byte-compatible with Hermes MEMORY.md / USER.md. */
export const ENTRY_DELIMITER = '\n§\n'

/** A lock file older than this is considered abandoned (stale). */
const STALE_LOCK_MS = 10_000
/** How long to keep waiting for the lock before failing loud. */
const LOCK_TIMEOUT_MS = 5_000
/** Spin interval while waiting for the lock. */
const LOCK_RETRY_MS = 25

/**
 * Split raw file text into trimmed, non-empty entries.
 * @param {string} text - raw file content.
 * @returns {string[]} the entries.
 */
export function parseEntries(text) {
  return text
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Serialize entries into canonical file text (entries joined by the
 * delimiter plus a trailing newline).
 * @param {string[]} entries - the entries.
 * @returns {string} canonical file content.
 */
/** Extract the `YYYY-MM-DD` date from an entry's stamp prefix; null when absent. */
export function extractEntryDate(entry) {
  // Entry ID [id:...] is always at the very front (cross-device merge anchor):
  // strip it before matching the date, otherwise entries with an ID are all
  // classified as "undated" (audit P1: since/until/earliest/latest broken)
  const match = /^\[(\d{4}-\d{2}-\d{2})/.exec(stripEntryId(entry))
  return match ? match[1] : null
}

/**
 * Branch-scope tag inside a KEY entry: `[2026-08-06] [branch:main,dev] content`.
 * Absent = visible in EVERY branch ("all"). Multiple branches are a
 * comma-separated list; the tag always follows the date stamp.
 */
export const BRANCH_TAG_RE = /(?:^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*)?\[branch:([^\]]*)\]\s*/

/**
 * Parse the branch scope of one KEY entry.
 * @param {string} entry - the full entry text.
 * @returns {string[] | null} the branch names, or null when the entry has no
 *   branch tag (meaning "all branches").
 */
export function parseEntryBranches(entry) {
  const match = BRANCH_TAG_RE.exec(entry)
  if (match === null) return null
  const branches = match[1].split(',').map((b) => b.trim()).filter(Boolean)
  return branches.length > 0 ? branches : null
}

/**
 * "DSH-only" tag: `[2026-08-06] [dsh-only] content`. A program-metadata tag
 * (positioned after the timestamp and [branch:...], before the body).
 *
 * Semantics: the entry applies only to DSH itself (DSH discipline / rules /
 * architecture facts — external executors are not DSH and need not follow
 * DSH rules). Therefore:
 *   - Snapshot injection for DSH itself: injected normally (it is intended for DSH);
 *   - Injection into external executors (COI task injectTracks memory injection):
 *     skipped entirely (handled by the excludeDshOnly option of buildMemoryContext).
 * Maintained by the Memory Tab entry action button (MemoryStore.setEntryDshOnly);
 * preserved verbatim via splitEntryHead when editing the body, same as [branch:...].
 */
export const DSH_ONLY_TAG = '[dsh-only]'

/** Regex for the [dsh-only] marker inside an entry (any position counts as marked, compatible with hand-written files). */
export const DSH_ONLY_RE = /\[dsh-only\]\s*/

/**
 * Check whether a memory entry carries the "DSH-only" marker.
 * @param {string} entry - full entry text.
 * @returns {boolean} true = the entry applies only to DSH and is skipped when injecting into external executors.
 */
export function parseEntryDshOnly(entry) {
  return DSH_ONLY_RE.test(String(entry ?? ''))
}

/**
 * "Summary" tag: `[2026-08-15] [summary:one-line summary] content`. A program-metadata tag
 * (positioned after the timestamp and [branch:...] / [dsh-only], before the body).
 *
 * Semantics: summary of the entry, injected into the system prompt during progressive
 * disclosure (reduces tokens).
 * Written by the memory tool add action's summary parameter; preserved verbatim via
 * splitEntryHead when editing, same as [branch:...] and [dsh-only].
 */
export const SUMMARY_TAG_RE = /\[summary:([^\]]*)\]/

/**
 * Regex for the entry header (program-metadata prefix): [id:...] -> timestamp (date /
 * date-time / time) -> [git ...] x N -> [branch:...] -> [dsh-only], matched in the
 * known token order of splitEntryHead. Summary parsing and stripping are both anchored
 * to this header — [summary:...] text appearing in the body (e.g. "[foo] [summary:bar]")
 * is not in the head sequence and will not be mistaken for an explicit summary
 * (audit fix: SUMMARY_TAG_RE was previously unanchored and body text with the same
 * token was mis-parsed).
 */
const ENTRY_HEAD_RE = /^(?:\[id:[0-9a-f]{8}\]\s*)?(?:\[\d{4}-\d{2}-\d{2}(?: \d{1,2}:\d{2}(?::\d{2})?)?\]\s*|\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?(?:\[git [^\]]+\]\s*)*(?:\[branch:[^\]]*\]\s*)?(?:\[dsh-only\]\s*)?/

/**
 * Parse the summary tag of a memory entry (only recognizes [summary:...] at the header position).
 * @param {string} entry - full entry text.
 * @returns {string | null} summary text, or null when no explicit summary exists.
 */
export function parseEntrySummary(entry) {
  const text = String(entry ?? '')
  const head = ENTRY_HEAD_RE.exec(text)
  if (head === null) return null
  const match = /^\[summary:([^\]]*)\]\s*/.exec(text.slice(head[0].length))
  return match ? match[1] : null
}

/**
 * Auto-generate a summary from the entry body (fallback when no explicit [summary:...] exists).
 * Strips all header markers then takes the first line of the body, truncated to maxLen characters.
 * @param {string} entry - full entry text.
 * @param {number} [maxLen=80] - maximum length.
 * @returns {string} auto-generated summary.
 */
export function autoSummary(entry, maxLen = 80) {
  // Strip header markers: reuse ENTRY_HEAD_RE (same head sequence as splitEntryHead /
  // stripEntrySummary: [id] -> timestamp (date / date-time / time) -> [git ...] x N ->
  // [branch:...] -> [dsh-only] -> [summary:...]). Audit fix: the previous per-token ^-anchored
  // replace missed [git ...] and [HH:MM], so entries with those markers were stripped
  // incorrectly and metadata (e.g. [git main]) leaked into the auto-summary injection.
  let rest = String(entry ?? '').trim()
  const head = ENTRY_HEAD_RE.exec(rest)
  if (head !== null) rest = rest.slice(head[0].length)
  rest = rest.replace(/^\[summary:[^\]]*\]\s*/, '')

  // Take the first line of the body
  const firstLine = rest.split('\n')[0].trim()
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen - 1) + '…'
}

/**
 * Strip the "summary" marker for display: when injecting/reading the full text, the body
 * is already complete and [summary:...] is program metadata only for summary-mode
 * injection — it should not be shown (avoids duplication with the body and wastes tokens).
 * Only strips the summary tag at the header position (after timestamp / [id] / [branch] /
 * [dsh-only], before the body); identical text appearing in the body is left untouched.
 * @param {string} entry - full entry text.
 * @returns {string} entry text without the summary marker.
 */
export function stripEntrySummary(entry) {
  // Match only in the known head token order (ENTRY_HEAD_RE, same as splitEntryHead):
  // [id] -> timestamp (date / date-time / time) -> [git ...] x N -> [branch:...] ->
  // [dsh-only] -> [summary:...]. [summary:...] text appearing in the body (e.g.
  // "[foo] [summary:bar]") is not in the head sequence and will not be stripped by mistake.
  const match = ENTRY_HEAD_RE.exec(String(entry ?? ''))
  const prefix = match === null ? '' : match[0]
  const rest = String(entry ?? '').slice(prefix.length)
  return prefix + rest.replace(/^\[summary:[^\]]*\]\s*/, '')
}

export function serializeEntries(entries) {
  return entries.join(ENTRY_DELIMITER) + '\n'
}

/**
 * Strip all prefix markers from an entry: timestamp + `[git ...]` program branch marker +
 * `[branch:...]` scope + daily project tag, returning the prefix head and the body. Keeps
 * the same parsing rules as the Memory Tab pretty view — when editing, rewrite with
 * head + new body so the timestamp and all tags are preserved verbatim (program-maintained
 * metadata must not be altered by edits).
 * @param {string} entry - full original entry text.
 * @param {string} target - 'memory' | 'user' | 'daily' | 'project' | 'key'.
 * @returns {{head: string, body: string}}
 */
export function splitEntryHead(entry, target) {
  let rest = String(entry ?? '').trim()
  const timeRe = target === 'project' ? /^\[(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(?::\d{2})?)\]\s*/
    : target === 'daily' ? /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/
      : /^\[(\d{4}-\d{2}-\d{2})\]\s*/
  const tokens = []
  // [id:xxxxxxxx] entry ID (cross-device merge anchor, design §4.1): strip first,
  // before the timestamp — it is "program-maintained metadata" and is preserved verbatim
  // when editing (inside head).
  const idMatch = /^\[id:([0-9a-f]{8})\]\s*/.exec(rest)
  if (idMatch !== null) {
    tokens.push(idMatch[0])
    rest = rest.slice(idMatch[0].length)
  }
  const timeMatch = timeRe.exec(rest)
  if (timeMatch !== null) {
    tokens.push(timeMatch[0])
    rest = rest.slice(timeMatch[0].length)
  }
  // Program branch marker [git ...] (daily / project stamped by session cwd)
  for (;;) {
    const gitMatch = /^\[git ([^\]]+)\]\s*/.exec(rest)
    if (gitMatch === null) break
    tokens.push(gitMatch[0])
    rest = rest.slice(gitMatch[0].length)
  }
  // key branch scope [branch:...]
  const branchMatch = /^\[branch:[^\]]*\]\s*/.exec(rest)
  if (branchMatch !== null) {
    tokens.push(branchMatch[0])
    rest = rest.slice(branchMatch[0].length)
  }
  // "DSH-only" marker [dsh-only] (after branch, before body; program metadata, preserved on edit)
  const dshOnlyMatch = /^\[dsh-only\]\s*/.exec(rest)
  if (dshOnlyMatch !== null) {
    tokens.push(dshOnlyMatch[0])
    rest = rest.slice(dshOnlyMatch[0].length)
  }
  // "Summary" marker [summary:...] (after dsh-only, before body; program metadata, preserved on edit)
  const summaryMatch = /^\[summary:[^\]]*\]\s*/.exec(rest)
  if (summaryMatch !== null) {
    tokens.push(summaryMatch[0])
    rest = rest.slice(summaryMatch[0].length)
  }
  // daily project tag (first arbitrary [...] after the timestamp)
  if (target === 'daily') {
    const tagMatch = /^\[([^\]]+)\]\s*/.exec(rest)
    if (tagMatch !== null) {
      tokens.push(tagMatch[0])
      rest = rest.slice(tagMatch[0].length)
    }
  }
  return { head: tokens.join(''), body: rest }
}

/**
 * Read project PROVENANCE (memory-sync identity record, one line of JSON). Tolerant:
 * returns null when missing or corrupted. Lives in store.js rather than the sync
 * layer — avoids circular dependency (repo.js imports store.js), and MemoryStore needs
 * it to determine syncedTrack.
 * @param {string} dir - project memory directory.
 * @returns {object | null} { projectId, displayName, enabled, tracks, ... }.
 */
export function readProvenance(dir) {
  const p = join(dir, 'PROVENANCE')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8').trim())
  } catch {
    return null
  }
}

/**
 * Determine whether project sync is enabled (2026-08-11 decision: three-level switch):
 * a project is considered synced only when it has been initialized (PROVENANCE exists)
 * **and** enabled !== false. When the project switch is off, new entries no longer
 * generate an ID (keeps the "disabled" local state).
 * @param {string} dir - project memory directory.
 * @returns {boolean}
 */
export function isProjectSyncEnabled(dir) {
  // Three-level switch, level 2 semantics (2026-08-11 decision + Codex final P1-5 fix):
  // **missing PROVENANCE = not initialized = not opted-in = disabled** — only projects
  // that have been explicitly initialized (setup writes PROVENANCE) and have
  // enabled !== false participate in sync.
  // Previously "missing = default enabled" caused the global module switch to generate
  // IDs for KEY/logs of non-opted-in projects, violating the decision that
  // "projects not opened stay purely local without IDs".
  const meta = readProvenance(dir)
  return meta !== null && meta.enabled !== false
}

/**
 * Exact-match index (immune to entry IDs): strip-and-compare — text that the display
 * layer stripped of [id:...] can still match the on-disk original (audit P0: Tab/API
 * exact operations broke after enabling sync).
 * Returns the unique hit index; 0 or multiple hits return -1 (caller treats as
 * "not found" — multiple is a data anomaly, rejected conservatively).
 */
function findExactIndex(entries, exact) {
  const target = stripEntryId(exact)
  let found = -1
  for (let i = 0; i < entries.length; i++) {
    if (stripEntryId(entries[i]) === target) {
      if (found !== -1) return -1 // multiple hits -> ambiguous, reject
      found = i
    }
  }
  return found
}

/**
 * Whether raw text is the canonical serialization of its own entries.
 * Blank text counts as canonical (an empty store).
 * @param {string} text - raw file content.
 * @returns {boolean} true when the file would round-trip through the parser.
 */
export function isCanonical(text) {
  return text.trim() === '' || serializeEntries(parseEntries(text)) === text
}

/** Blocking sleep used by the lock retry loop (synchronous). */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Directories whose lock this process currently holds (reentrancy guard). */
const heldLocks = new Set()

/**
 * Acquire the directory lock exclusively (cross-process), run `fn`, release.
 * Reentrant within this process: a nested withLock on the same directory
 * proceeds directly (all mutations are synchronous, so the outer section is
 * still exclusive against other processes).
 * @param {string} dir - the directory whose lock to take.
 * @param {() => T} fn - the critical section.
 * @returns {T} the section's return value.
 * @template T
 */
/** Lock file content (pid/token): a stale lock left after power loss/interrupt can be identified immediately via pid liveness check. */
const LOCK_JSON = () => JSON.stringify({ pid: process.pid, at: Date.now() })

/**
 * Determine whether a lock is stale (exported for worker async-lock reuse): mtime
 * timeout, or the pid inside the lock file is no longer alive (process was killed /
 * power loss — stale lock is cleared immediately without waiting for the timeout).
 * @param {string} lockPath - lock file path.
 * @returns {boolean}
 */
export function isStaleLock(lockPath) {
  try {
    const info = statSync(lockPath)
    // **Check pid liveness first (Codex final P1-7 fix)**: when a valid pid exists,
    // a living process means the lock is valid (even if held longer than the mtime
    // threshold — lock operations are millisecond-level, but long tasks should not be
    // preempted); only dead pids or old-format locks without a pid fall back to mtime.
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8'))
      if (typeof owner.pid === 'number') {
        try {
          process.kill(owner.pid, 0) // signal 0 = probe liveness only
          return false // owner still alive -> lock valid
        } catch {
          return true // owner dead (power loss / interrupt leftover) -> stale
        }
      }
    } catch {
      // Old-format lock file (no pid / unparseable) -> judge by mtime
    }
    return Date.now() - info.mtimeMs > STALE_LOCK_MS
  } catch {
    return false // lock file missing / unreadable -> not stale (retry next round)
  }
}

/**
 * Acquire the directory lock exclusively (cross-process), run `fn`, release.
 * Reentrant within this process: a nested withLock on the same directory
 * proceeds directly (all mutations are synchronous, so the outer section is
 * still exclusive against other processes).
 * @param {string} dir - the directory whose lock to take.
 * @param {() => T} fn - the critical section.
 * @returns {T} the section's return value.
 * @template T
 */
export function withLock(dir, fn) {
  if (heldLocks.has(dir)) return fn()
  const lockPath = join(dir, '.memory.lock')
  mkdirSync(dir, { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    let acquired = false
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(lockPath, LOCK_JSON())
      } finally {
        closeSync(fd)
      }
      acquired = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if (acquired) break
    if (isStaleLock(lockPath)) rmSync(lockPath, { force: true })
    if (Date.now() >= deadline) {
      throw new Error('maestro-memory: timed out waiting for the memory lock')
    }
    sleep(LOCK_RETRY_MS)
  }
  heldLocks.add(dir)
  try {
    return fn()
  } finally {
    heldLocks.delete(dir)
    rmSync(lockPath, { force: true })
  }
}

/** Minimal prompt-injection scan applied to tool-written memory content. */
const THREAT_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|earlier|above|your)\s+(instructions?|prompts?|messages?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier|above|your)\s+(instructions?|prompts?|messages?|rules?)/i,
  /forget\s+(all|everything|your\s+instructions)/i,
  /忽略(所有|之前|以上|先前)(的)?(指令|指示|提示|规则)/,
  /无视(所有|之前|以上|先前)(的)?(指令|指示|提示|规则)/,
]

/**
 * Scan one memory entry for prompt-injection phrasing.
 * @param {string} text - the content to scan.
 * @returns {string | undefined} a human-readable block reason, or undefined.
 */
export function scanThreat(text) {
  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(text)) {
      return 'Content contains suspected prompt-injection phrasing (e.g. "ignore instructions"); write rejected. If this is intentional, please edit the memory file directly.'
    }
  }
  return undefined
}

/** Today's date as `YYYY-MM-DD` (local time). */
export function todayStamp() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Stable 12-hex project key for one working directory. */
export function projectHash(cwd) {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}

/**
 * A short, stable project label for one working directory: the basename, or
 * the last two path segments when the basename is too short or purely
 * numeric (e.g. `/data/260805/1` → `260805/1`). Tags daily-log entries with
 * their originating project — the program knows the session cwd, so the LLM
 * never has to write it.
 * @param {string | undefined} cwd - the session working directory.
 * @returns {string | undefined} the label, or undefined without a cwd.
 */
export function projectLabel(cwd) {
  if (!cwd) return undefined
  const parts = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length === 0) return '/'
  const base = parts[parts.length - 1]
  if (base.length < 3 || /^\d+$/.test(base)) {
    return parts.length > 1 ? parts.slice(-2).join('/') : base
  }
  return base
}

/**
 * Resolve the current git branch of a working directory (same pattern as the
 * DSH TUI's prompt-context helper). Outside a git worktree, without `git`,
 * or on a detached HEAD (`--show-current` returns empty) this returns
 * undefined — callers then fall back to the no-branch behavior.
 * @param {string} cwd - the working directory to query.
 * @returns {string | undefined} the branch name, or undefined.
 */
export function gitBranch(cwd) {
  if (!cwd) return undefined
  try {
    const result = spawnSync('git', ['branch', '--show-current'], {
      cwd, encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.error || result.status !== 0) return undefined
    const branch = String(result.stdout ?? '').trim()
    return branch === '' ? undefined : branch
  } catch {
    return undefined
  }
}

/**
 * List all local branch names of a working directory (for the memory tab's
 * branch-scope pickers). Empty on any failure.
 * @param {string} cwd - the working directory to query.
 * @returns {string[]} the branch names ([] = not a git repo / no git).
 */
export function gitBranchList(cwd) {
  if (!cwd) return []
  try {
    const result = spawnSync('git', ['branch', '--format=%(refname:short)'], {
      cwd, encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.error || result.status !== 0) return []
    return String(result.stdout ?? '')
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0)
  } catch {
    return []
  }
}

/**
 * Persistent curated memory store over the five tracks: global facts
 * (MEMORY.md / USER.md), the daily log (daily/YYYY-MM-DD.md), the per-project
 * log (projects/<hash>/MEMORY.md, keyed by the session cwd) and per-project
 * KEY facts (projects/<hash>/KEY.md — the project's long-term memory, which
 * IS injected into the context like the global tracks).
 */
export class MemoryStore {
  /**
   * @param {string} dir - the memory directory (created on demand).
   * @param {object} [options] - scan and stamping switches.
   * @param {boolean} [options.injectionScan=true] - enable the threat scan.
   * @param {boolean} [options.entryDatePrefix=true] - stamp entries with a
   *   `[YYYY-MM-DD] ` prefix on add, refreshed on replace (idempotent for
   *   content that already carries a date stamp).
   * @param {'off'|'on'} [options.entryIdMode='off'] - entry ID switch (design
   *   §4.2): when 'on', add prefixes each new entry with a random `[id:xxxxxxxx]` and
   *   replace inherits the old entry's ID ("replace without changing identity").
   *   **Only enabled for projects with Git sync** — projects without sync keep 'off',
   *   behavior stays byte-for-byte identical. Default 'off'.
   * @param {(cwd: string) => string} [options.projectDirResolver] - project directory
   *   resolver (injected by the memory-sync assembly layer): returns the projectId
   *   directory for sync-initialized projects, otherwise falls back to projectHash(cwd)
   *   (default logic).
   */
  constructor(dir, options = {}) {
    this.dir = dir
    this.injectionScan = options.injectionScan ?? true
    this.entryDatePrefix = options.entryDatePrefix ?? true
    this.entryIdMode = options.entryIdMode === 'on' ? 'on' : 'off'
    this.projectDirResolver = typeof options.projectDirResolver === 'function' ? options.projectDirResolver : null
  }

  /**
   * Resolve one target to its file location.
   * @param {string} target - 'memory' | 'user' | 'daily' | 'project' | 'key'.
   * @param {object | undefined} agent - the calling agent; required for
   *   'project' and 'key' (its session cwd selects the project directory).
   * @returns {{dir: string, file: string} | undefined}
   *   the location, or undefined when it cannot be resolved (e.g. project
   *   memory without a session cwd).
   */
  locate(target, agent) {
    switch (target) {
      case 'memory':
        return { dir: this.dir, file: 'MEMORY.md' }
      case 'user':
        return { dir: this.dir, file: 'USER.md' }
      case 'daily':
        return { dir: join(this.dir, 'daily'), file: `${todayStamp()}.md` }
      case 'project':
      case 'key': {
        const cwd = agent?.session?.header?.cwd
        if (!cwd) return undefined
        // Project directory resolution: sync-initialized projects use the projectId
        // directory (after migration), otherwise fall back to projectHash(cwd)
        // (no behavior change for projects without sync).
        // projectDirResolver is injected by the assembly layer (lib/sync/index.js).
        const dir = this.projectDirResolver
          ? this.projectDirResolver(cwd)
          : join(this.dir, 'projects', projectHash(cwd))
        return {
          dir,
          file: target === 'key' ? 'KEY.md' : 'MEMORY.md',
        }
      }
      default:
        throw new Error(`maestro-memory: invalid memory track "${target}"`)
    }
  }

  /** Resolve a target or fail loud with a locatable message. */
  resolveTarget(target, agent) {
    const loc = this.locate(target, agent)
    if (!loc) {
      throw new Error(`maestro-memory: cannot resolve memory track "${target}" (project memory requires a valid session working directory)`)
    }
    return loc
  }

  /**
   * Stamp one entry with a time prefix: date stamp for the long-term tracks
   * (global memory/user AND the per-project KEY track — a `[YYYY-MM-DD]`
   * prefix, same shape as the injected global tracks), date+time for the
   * per-project log (project entries need hour granularity to reconstruct
   * when something happened), time-of-day for the daily log (its file name
   * already carries the date). Idempotent for content that already carries
   * the matching prefix; a bare `[YYYY-MM-DD]` project entry is upgraded to
   * the dated-time form on replace.
   *
   * For daily/project/key, a hand-written date-like prefix (`[2026-08-05]`,
   * `[2026-08-05 late night]`) is STRIPPED first: writers (review subagents) do
   * not know the current date and guess — dates belong to the file name
   * (daily) or the program stamp (project/key), so the canonical stamp wins.
   *
   * Daily entries additionally carry a program-tagged project label
   * (`[HH:MM] [git branch] [label] …`) derived from the calling agent's
   * cwd, so the log shows which project each entry belongs to without the
   * LLM writing it. Daily AND project entries carry a program-tagged git
   * branch (`[git main]`, right after the time stamp) whenever the session
   * cwd is a git worktree — logs stay branch-reliable without any LLM
   * cooperation.
   * @param {string} target - the memory track.
   * @param {string} content - trimmed entry text.
   * @param {object | undefined} agent - the calling agent (its cwd selects
   *   the project label for the daily track).
   * @returns {string} the stamped entry.
   */
  stampEntry(target, content, agent) {
    // Entry ID (cross-device merge anchor) is **always at the very front**:
    // temporarily strip it, stamp all program prefixes (timestamp / git branch /
    // project label), then re-attach at the front (audit P0 — previously stamping
    // before the date caused "add/promote with own ID" to produce duplicate IDs
    // and break the merge anchor).
    const entryId = extractEntryId(content)
    if (entryId !== null) content = stripEntryId(content)
    let stamped
    if (target === 'daily' || target === 'project' || target === 'key') {
      content = content.replace(/^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*/, '')
      // Branch tag is program-exclusive: strip the model's hand-written [git branch]
      // prefix to avoid duplication with the program tag (the model does not know the branch name)
      content = content.replace(/^\[git [^\]]+\]\s*/, '')
    }
    if (target === 'daily') {
      if (!this.entryDatePrefix || /^\[\d{2}:\d{2}\]\s/.test(content)) {
        stamped = content
      } else {
        const d = new Date()
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const label = projectLabel(agent?.session?.header?.cwd)
        const branch = gitBranch(agent?.session?.header?.cwd)
        const branchTag = branch !== undefined ? `[git ${branch}] ` : ''
        stamped = `[${hh}:${mm}] ${branchTag}${label ? `[${label}] ` : ''}${content}`
      }
    } else if (target === 'project') {
      if (!this.entryDatePrefix || /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]\s/.test(content)) {
        stamped = content
      } else {
        const d = new Date()
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const branch = gitBranch(agent?.session?.header?.cwd)
        const branchTag = branch !== undefined ? `[git ${branch}] ` : ''
        stamped = `[${todayStamp()} ${hh}:${mm}] ${branchTag}${content}`
      }
    } else if (!this.entryDatePrefix || /^\[\d{4}-\d{2}-\d{2}\]\s/.test(content)) {
      stamped = content
    } else {
      stamped = `[${todayStamp()}] ${content}`
    }
    // Single exit: re-attach the entry ID at the very front (before program prefixes)
    if (entryId !== null) stamped = `[id:${entryId}] ${stamped}`
    return stamped
  }

  /** Absolute path of one target's file (throws when not locatable). */
  pathOf(target, agent) {
    const loc = this.resolveTarget(target, agent)
    return join(loc.dir, loc.file)
  }


  /** Current character usage of one target (delimiter-joined length). */
  charsOf(target, agent) {
    return this.entriesOf(target, agent).join(ENTRY_DELIMITER).length
  }

  /** Read one target's entries without locking (snapshot reads). */
  entriesOf(target, agent) {
    return parseEntries(this.readRaw(target, agent).text)
  }

  /**
   * Query entries with LLM-friendly lookups: keyword `filter`
   * (case-insensitive substring), date range `since`/`until`
   * (`YYYY-MM-DD`; the daily track spans multiple files, so a range reads
   * every day's log in between), `recent` newest-first ordering and a
   * `limit` cap. Entries without a date stamp survive date filters.
   * @param {string} target - the memory track.
   * @param {object | undefined} agent - the calling agent (required for
   *   'project').
   * @param {{filter?: string, since?: string, until?: string, limit?: number, recent?: boolean}} [opts]
   * @returns {string[]} the matching entries (raw text with stamps).
   */
  query(target, agent, opts = {}, stats = {}) {
    const { filter, since, until, limit, recent } = opts
    let rows = []
    if (target === 'daily' && (since !== undefined || until !== undefined)) {
      // Cross-date query: enumerate daily/ files within the range (collected in ascending date order)
      const dir = join(this.dir, 'daily')
      let days = []
      try {
        days = readdirSync(dir)
          .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
          .map((name) => name.slice(0, 10))
          .sort()
      } catch {
        days = [] // daily directory does not exist yet
      }
      for (const day of days) {
        if ((since !== undefined && day < since) || (until !== undefined && day > until)) continue
        let text
        try {
          text = readFileSync(join(dir, `${day}.md`), 'utf8')
        } catch {
          continue
        }
        for (const entry of parseEntries(text)) rows.push({ date: day, text: entry })
      }
    } else {
      // Single-file track: date extracted from the entry timestamp (daily single file = today's file)
      const fileDate = target === 'daily' ? todayStamp() : null
      for (const entry of this.entriesOf(target, agent)) {
        rows.push({ date: fileDate ?? extractEntryDate(entry), text: entry })
      }
    }
    if (filter !== undefined && String(filter) !== '') {
      const q = String(filter).toLowerCase()
      rows = rows.filter((row) => row.text.toLowerCase().includes(q))
    }
    if (since !== undefined || until !== undefined) {
      rows = rows.filter((row) => {
        if (row.date === null) return true // undated entries are excluded from date filtering
        if (since !== undefined && row.date < since) return false
        if (until !== undefined && row.date > until) return false
        return true
      })
    }
    // Count entries whose date cannot be parsed (legacy format / hand-written prefix) — caller can prompt the model to read the full file
    stats.undated = rows.filter((row) => row.date === null).length
    stats.total = rows.length
    if (recent) rows.reverse() // collected in ascending order then globally reversed = date descending + intra-group descending
    if (limit !== undefined && Number.isFinite(Number(limit)) && Number(limit) > 0) {
      rows = rows.slice(0, Math.floor(Number(limit)))
    }
    return rows.map((row) => row.text)
  }

  /** Read the raw file; a missing file reads as an empty store. */
  readRaw(target, agent) {
    const path = this.pathOf(target, agent)
    try {
      return { text: readFileSync(path, 'utf8'), size: statSync(path).size }
    } catch (error) {
      if (error.code === 'ENOENT') return { text: '', size: 0 }
      throw error
    }
  }

  /**
   * Reload one target under the caller's lock.
   * @returns {{kind:'ok', entries: string[]} | {kind:'read-failed'} | {kind:'drift', backup: string}}
   */
  reload(target, agent) {
    const { text, size } = this.readRaw(target, agent)
    // Only a truly unreadable file is refused (non-empty size yet zero bytes
    // read back — e.g. a broken encoding). A whitespace-only file is a normal
    // empty store: rewriting it cannot wipe history.
    if (text === '' && size > 0) return { kind: 'read-failed' }
    if (!isCanonical(text)) {
      const backup = `${this.pathOf(target, agent)}.bak.${Date.now()}`
      writeFileSync(backup, text)
      return { kind: 'drift', backup }
    }
    return { kind: 'ok', entries: parseEntries(text) }
  }

  /** Atomically write entries to one target's file. */
  write(target, entries, agent) {
    const path = this.pathOf(target, agent)
    const tmp = `${path}.tmp.${process.pid}`
    writeFileSync(tmp, serializeEntries(entries))
    renameSync(tmp, path)
  }

  /**
   * Reload one target under the caller's lock, skipping the drift guard.
   * Append-only mutations never clobber parsed entries, so an un-roundtrippable
   * file is tolerated (Hermes semantics); an unreadable file is not
   * (rewriting it would wipe history). A whitespace-only file is a normal
   * empty store — only a file that exists with a size yet reads back as the
   * empty string is treated as unreadable.
   * @returns {{kind:'ok', entries: string[]} | {kind:'read-failed'}}
   */
  reloadForAppend(target, agent) {
    const { text, size } = this.readRaw(target, agent)
    if (text === '' && size > 0) return { kind: 'read-failed' }
    return { kind: 'ok', entries: parseEntries(text) }
  }

  /**
   * Append one entry. Skips the drift guard (append-only), rejects empty
   * content, exact duplicates, over-limit additions, and unreadable files.
   * @param {string} target - 'memory' or 'user'.
   * @param {string} content - the entry text.
   * @returns {object} a tool-friendly result object.
   */
  add(target, content, agent) {
    const loc = this.resolveTarget(target, agent)
    const text = String(content).trim()
    if (!text) return { ok: false, message: st('store.emptyContent'), target }
    if (this.injectionScan) {
      const threat = scanThreat(text)
      if (threat) return { ok: false, message: threat, target }
    }
    const stamped = this.stampEntry(target, text, agent)
    return withLock(loc.dir, () => {
      const reload = this.reloadForAppend(target, agent)
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      // entryIdMode=on (projects with Git sync enabled): new entries are prefixed
      // with a random ID (design §4.2; projects without sync are untouched, no behavior change).
      // Phase-1 sync scope = project tracks (key + project log); global tracks
      // (memory/user/daily) are shared only in phase 2, so no ID is generated in phase 1 —
      // on-disk format stays as-is. PROVENANCE exists = project has completed bootstrap
      // (uninitialized projects do not generate IDs even if the global switch is on).
      const syncedTrack = this.entryIdMode === 'on' && (target === 'key' || target === 'project')
        && isProjectSyncEnabled(loc.dir)
      const withId = syncedTrack && !/^\[id:[0-9a-f]{8}\]\s*/.test(stamped)
        ? `[id:${genEntryId()}] ${stamped}`
        : stamped
      // Dedup comparison: in on-mode compare after stripping IDs (IDs are random each time,
      // so a direct includes would never hit and duplicate content would be added repeatedly);
      // off-mode keeps the original behavior.
      const dup = syncedTrack
        ? entries.some((entry) => stripEntryId(entry) === stripEntryId(withId))
        : entries.includes(stamped)
      if (dup) {
        return {
          ok: true, duplicate: true, message: st('store.duplicate'), target,
          entries: [...entries], chars: this.charsOf(target, agent),
        }
      }
      const next = [...entries, withId]
      this.write(target, next, agent)
      return {
        ok: true, message: st('store.added', { target, before: entries.length, after: next.length }), target,
        entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Replace the whole entry containing the unique substring `match`.
   * Enforces the drift guard (full-file rewrite).
   * @param {string} target - 'memory' or 'user'.
   * @param {string} match - a short substring uniquely identifying one entry.
   * @param {string} content - the replacement entry text.
   * @returns {object} a tool-friendly result object.
   */
  replace(target, match, content, agent) {
    const loc = this.resolveTarget(target, agent)
    const oldText = String(match ?? '').trim()
    const newContent = String(content ?? '').trim()
    if (!oldText) return { ok: false, message: st('store.emptyMatch'), target }
    if (!newContent) return { ok: false, message: st('store.emptyNewContent'), target }
    if (this.injectionScan) {
      const threat = scanThreat(newContent)
      if (threat) return { ok: false, message: threat, target }
    }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardWrite', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      const matches = entries.filter((entry) => entry.includes(oldText))
      if (matches.length === 0) {
        return { ok: false, message: st('store.noMatch', { match: oldText }), target, entries: [...entries] }
      }
      if (matches.length > 1) {
        return {
          ok: false,
          message: st('store.multiMatch', { match: oldText, count: matches.length }),
          target, matches: [...matches], entries: [...entries],
        }
      }
      const index = entries.indexOf(matches[0])
      const next = [...entries]
      // Replace without changing identity (design §4.3; Codex round-2 P1-3 extension):
      //   - **Old entry already has an ID (any track) -> must keep it** — after global
      //     tracks are enabled, memory/user will also get [id:xxxx]; if replace drops the ID,
      //     two devices editing the same entry cannot be aligned (treated as two new entries);
      //   - Old entry has no ID: project tracks (key/project) with sync enabled -> deterministically
      //     re-issue based on old content (legacyIdFor, consistent across devices); memory/user
      //     without sync -> no ID (stay purely local).
      let replacement = this.stampEntry(target, newContent, agent)
      const oldId = extractEntryId(matches[0])
      if (this.entryIdMode === 'on' && oldId !== null) {
        replacement = stripEntryId(replacement)
        replacement = `[id:${oldId}] ${replacement}`
      } else if (this.entryIdMode === 'on' && (target === 'key' || target === 'project')
        && isProjectSyncEnabled(loc.dir)) {
        const legacyId = legacyIdFor(stripEntryId(matches[0]))
        replacement = stripEntryId(replacement)
        replacement = `[id:${legacyId}] ${replacement}`
      }
      next[index] = replacement
      this.write(target, next, agent)
      return {
        ok: true, message: st('store.replaced', { target, count: entries.length }), target,
        entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Remove the entry containing the unique substring `match`.
   * Enforces the drift guard (full-file rewrite).
   * @param {string} target - 'memory' or 'user'.
   * @param {string} match - a short substring uniquely identifying one entry.
   * @returns {object} a tool-friendly result object.
   */
  remove(target, match, agent) {
    const loc = this.resolveTarget(target, agent)
    const oldText = String(match ?? '').trim()
    if (!oldText) return { ok: false, message: st('store.emptyMatch'), target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardOp', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      const matches = entries.filter((entry) => entry.includes(oldText))
      if (matches.length === 0) {
        return { ok: false, message: st('store.noMatch', { match: oldText }), target, entries: [...entries] }
      }
      if (matches.length > 1) {
        return {
          ok: false,
          message: st('store.multiMatch', { match: oldText, count: matches.length }),
          target, matches: [...matches], entries: [...entries],
        }
      }
      const index = entries.indexOf(matches[0])
      const next = [...entries]
      next.splice(index, 1)
      this.write(target, next, agent)
      return {
        ok: true, message: st('store.removed', { target, before: entries.length, after: next.length }), target,
        // removed: the full original deleted entry (including timestamp) — for
        // archive-style "move" scenarios, append directly to the archive file to avoid a second match
        removed: matches[0],
        entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Preview the single entry containing the unique substring `match`,
   * WITHOUT writing anything. Same matching semantics as remove (unique substring hit,
   * drift guard pre-check), for "archive first, then delete" move scenarios:
   * first peek the matched original to write into the archive file, then delete after
   * the archive succeeds — replaces the old "delete first, then add" order and avoids
   * losing the main-track entry if the archive write fails.
   * @param {string} target - 'memory' or 'user'.
   * @param {string} match - a short substring uniquely identifying one entry.
   * @returns {object} a tool-friendly result object ({ ok, entry } on success).
   */
  peek(target, match, agent) {
    const loc = this.resolveTarget(target, agent)
    const oldText = String(match ?? '').trim()
    if (!oldText) return { ok: false, message: st('store.emptyMatch'), target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardOp', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableOp'), target }
      }
      const matches = reload.entries.filter((entry) => entry.includes(oldText))
      if (matches.length === 0) {
        return { ok: false, message: st('store.noMatch', { match: oldText }), target }
      }
      if (matches.length > 1) {
        return {
          ok: false,
          message: st('store.multiMatch', { match: oldText, count: matches.length }),
          target,
        }
      }
      return { ok: true, entry: matches[0], target }
    })
  }

  /**
   * Preview whether an EXACT whole-entry match exists (same matching
   * semantics as removeExact, read-only, writes nothing). For "archive first,
   * then delete" scenarios, verify the target entry really exists on the main track
   * before writing to the archive file — avoids writing junk content for invalid
   * requests (partial substrings, already-deleted entries).
   * @param {string} target - the memory track ('memory' | 'user' | 'daily' |
   *   'project' | 'key').
   * @param {string} entry - the FULL entry text (with its stamp) to check.
   * @returns {object} a tool-friendly result object ({ ok, entry } on success).
   */
  peekExact(target, entry, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    if (!exact) return { ok: false, message: st('store.emptyEntry'), target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardOp', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableOp'), target }
      }
      if (!reload.entries.includes(exact)) {
        return { ok: false, message: stt('storetail.mainMissing'), target }
      }
      return { ok: true, entry: exact, target }
    })
  }

  /**
   * Remove the entry that EXACTLY equals `entry` (whole-entry match, not a
   * substring). Used by the memory tab's per-entry delete button: the UI
   * sends the full entry text it rendered, and this deletes precisely that
   * entry — a substring match could hit a longer entry that merely contains
   * the text (e.g. deleting "prefers concise" must not remove "prefers concise, also prefers detailed"). Enforces the drift guard; a missing exact entry is reported
   * without touching anything.
   * @param {string} target - the memory track ('memory' | 'user' | 'daily' |
   *   'project' | 'key').
   * @param {string} entry - the FULL entry text (with its stamp) to delete.
   * @returns {object} a tool-friendly result object.
   */
  removeExact(target, entry, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    if (!exact) return { ok: false, message: st('store.emptyEntry'), target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardOp', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      // Exact match is ID-immune (audit P0): text returned after the display layer strips
      // [id:...] can still hit the on-disk original (strip-equality); multiple hits are
      // reported as ambiguous (defensive).
      const index = findExactIndex(entries, exact)
      if (index === -1) {
        return {
          ok: false,
          message: stt('storetail.entryMissing'),
          target, entries: [...entries],
        }
      }
      const next = [...entries]
      next.splice(index, 1)
      this.write(target, next, agent)
      return {
        ok: true, message: st('store.removed', { target, before: entries.length, after: next.length }), target,
        entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Set the branch scope of one KEY entry (whole-entry exact match). An
   * empty `branches` array means "all branches" — the tag is REMOVED
   * ("all" has the highest weight: it wins over any branch selection).
   * The date stamp is preserved; the tag is (re)inserted right after it.
   * @param {string} target - 'key' (other tracks are rejected).
   * @param {string} entry - the FULL entry text to update.
   * @param {string[]} branches - the branch names ([] = all branches).
   * @returns {object} a tool-friendly result object.
   */
  setEntryBranches(target, entry, branches, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    if (!exact) return { ok: false, message: st('store.emptyEntry'), target }
    if (target !== 'key') return { ok: false, message: stt('storetail.branchKeyOnly'), target }
    const list = (Array.isArray(branches) ? branches : [])
      .map((b) => String(b).trim())
      .filter((b) => b.length > 0)
    const tag = list.length > 0 ? `[branch:${list.join(',')}] ` : ''
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardOp', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      const index = findExactIndex(entries, exact)
      if (index === -1) {
        return {
          ok: false,
          message: stt('storetail.entryMissing'),
          target, entries: [...entries],
        }
      }
      // Rebuild from the **on-disk original** (including ID) (audit P1: rebuilding from stripped text loses the ID);
      // splitEntryHead extracts all program prefixes (id / date / git / branch / dsh-only),
      // then remove the old [branch:] and insert the new marker
      const diskEntry = entries[index]
      const { head, body } = splitEntryHead(diskEntry, target)
      const headNoBranch = head.replace(/\[branch:[^\]]*\]\s*/, '')
      const next = [...entries]
      next[index] = `${headNoBranch}${tag}${body}`
      this.write(target, next, agent)
      return {
        ok: true, message: list.length > 0 ? `Branch scope set (${list.join(', ')})` : 'Set to visible in all branches',
        target, entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Set / clear the "DSH-only" marker on an entry (whole-entry exact match, same
   * validation as setEntryBranches: drift guard + exact equality + reject missing entries).
   *
   * Marked as `[dsh-only]` (after timestamp and [branch:...], before the body): once marked,
   * the entry is still injected into DSH's own sessions but is skipped entirely when
   * injecting into external executors (COI task injectTracks memory injection) via
   * buildMemoryContext's excludeDshOnly — used for discipline / rules / architecture facts
   * that only matter to DSH (external CLI agents are not DSH; forcing them to follow DSH
   * rules would only confuse). Clearing the marker = remove the tag (entry becomes visible
   * to external executors again).
   * @param {string} target - 'memory' | 'user' | 'key' (other tracks rejected).
   * @param {string} entry - full original entry text (whole-entry exact match).
   * @param {boolean} on - true = mark, false = clear.
   * @returns {object} a tool-friendly result object.
   */
  setEntryDshOnly(target, entry, on, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    if (!exact) return { ok: false, message: st('store.emptyEntry'), target }
    if (target !== 'memory' && target !== 'user' && target !== 'key') {
      return { ok: false, message: stt('storetail.dshOnlyTrackLimit'), target }
    }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardOp', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      const index = findExactIndex(entries, exact)
      if (index === -1) {
        return {
          ok: false,
          message: stt('storetail.entryMissing'),
          target, entries: [...entries],
        }
      }
      // Rebuild from on-disk original (preserve ID); splitEntryHead extracts all program prefixes,
      // remove old [dsh-only] then insert as needed — fixed position: after program metadata, before body
      const diskEntry = entries[index]
      const bare = diskEntry.replace(DSH_ONLY_RE, '')
      const { head, body } = splitEntryHead(bare, target)
      const next = [...entries]
      next[index] = on ? `${head}${DSH_ONLY_TAG} ${body}` : `${head}${body}`
      this.write(target, next, agent)
      return {
        ok: true,
        message: on ? 'Marked as DSH-only (skipped when injecting into external executors)' : 'DSH-only marker removed (visible to external executors)',
        target, entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Update only the body of an entry (whole-entry exact match) — the "edit" entry point
   * for the Memory Tab pretty view. Timestamp and all tags ([git ...] / [branch:...] /
   * daily project tag) are preserved verbatim: program-maintained metadata must not be
   * altered by editing. Content must not contain the entry delimiter § (would break
   * § splitting). Enforces the drift guard (full-file rewrite).
   * @param {string} target - 'memory' | 'user' | 'daily' | 'project' | 'key'.
   * @param {string} entry - full original entry text (same as delete/archive, held by the UI when rendered).
   * @param {string} content - new body (may be multiline; use delete for empty content).
   * @returns {object} a tool-friendly result object.
   */
  updateEntryContent(target, entry, content, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    const newContent = String(content ?? '').trim()
    if (!exact) return { ok: false, message: st('store.emptyEntry'), target }
    if (!newContent) return { ok: false, message: stt('storetail.emptyContentTab'), target }
    if (newContent.includes('§')) {
      return { ok: false, message: stt('storetail.sectionDelimiter'), target }
    }
    if (this.injectionScan) {
      const threat = scanThreat(newContent)
      if (threat) return { ok: false, message: threat, target }
    }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return {
          ok: false,
          message: st('store.driftGuardWrite', { file: loc.file, backup: reload.backup }),
          target, backup: reload.backup,
        }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: st('store.fileUnreadableWrite'), target }
      }
      const entries = reload.entries
      const index = findExactIndex(entries, exact)
      if (index === -1) {
        return {
          ok: false,
          message: stt('storetail.entryMissing'),
          target, entries: [...entries],
        }
      }
      const { head } = splitEntryHead(entries[index], target) // on-disk original (preserve ID)
      // Defensive: entry whose prefix cannot be parsed at all — editing would break its format — reject and ask for manual handling
      if (head === '') {
        return {
          ok: false,
          message: stt('storetail.unrecognizedPrefix'),
          target, entries: [...entries],
        }
      }
      const next = [...entries]
      next[index] = `${head}${newContent}`
      this.write(target, next, agent)
      return {
        ok: true, message: stt('storetail.updated', { target }), target,
        entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }
}

/**
 * Append-only JSONL queue of background-review memory suggestions
 * (the "learned track" awaiting user confirmation).
 */
export class SuggestionQueue {
  /**
   * @param {string} file - the JSONL file path.
   */
  constructor(file) {
    this.file = file
  }

  /** Read all suggestions; a missing file reads as empty. */
  read() {
    try {
      const text = readFileSync(this.file, 'utf8')
      return text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Atomically write the full suggestion list. */
  write(entries) {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}`
    writeFileSync(tmp, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : ''))
    renameSync(tmp, this.file)
  }

  /** Append one suggestion under the directory lock. */
  append(entry) {
    return withLock(dirname(this.file), () => {
      const entries = this.read()
      entries.push(entry)
      this.write(entries)
      return { ok: true, queued: entries.length }
    })
  }

  /**
   * Mutate the suggestion list under the directory lock.
   * @param {(entries: object[]) => T} fn - the mutation; return value is passed through.
   * @returns {T} the mutation's return value.
   * @template T
   */
  mutate(fn) {
    return withLock(dirname(this.file), () => {
      const entries = this.read()
      const result = fn(entries)
      this.write(entries)
      return result
    })
  }
}

/**
 * Archive storage: cold storage for low-priority memories — suggestions that are
 * "a pity to lose but not good enough for main memory" land here. Never injected into
 * any session; entries can be "moved back to main memory" (promoted, written back to
 * the corresponding main track) or deleted via the Memory Tab. Files share the same
 * format as main tracks (§ delimited + `[YYYY-MM-DD]` timestamp), split by original
 * target: `MEMORY-archive.md` / `USER-archive.md`, and project-level
 * `projects/<cwd-hash>/KEY-archive.md` (archive for the key track, lives with the project, needs cwd).
 */
export class ArchiveStore {
  /**
   * @param {string} dir - the memory directory (archive files live beside
   *   the main track files).
   * @param {object} [options]
   * @param {(cwd: string) => string} [options.projectDirResolver] - project directory
   *   resolver (injected by the memory-sync assembly layer): sync projects locate the
   *   projectId directory (audit P1: archive writes and migration/merge must use the same
   *   directory). Falls back to projectHash(cwd) by default.
   */
  constructor(dir, options = {}) {
    this.dir = dir
    this.projectDirResolver = typeof options.projectDirResolver === 'function' ? options.projectDirResolver : null
  }

  /** Resolve one archive file path; key requires the project cwd. */
  fileOf(target, cwd) {
    if (target === 'memory') return join(this.dir, 'MEMORY-archive.md')
    if (target === 'user') return join(this.dir, 'USER-archive.md')
    if (target === 'key') {
      if (!cwd) throw new Error('maestro-memory: key archive requires a session working directory')
      const projectDir = this.projectDirResolver
        ? this.projectDirResolver(cwd)
        : join(this.dir, 'projects', projectHash(cwd))
      return join(projectDir, 'KEY-archive.md')
    }
    // todo-* suggestions are archived together to TODO-archive.md (archive entries are plain § text;
    // promotion writes back to the corresponding todo track by original target)
    if (typeof target === 'string' && target.startsWith('todo-')) {
      return join(this.dir, 'TODO-archive.md')
    }
    throw new Error(`maestro-memory: invalid archive track "${target}"`)
  }

  /** Read one archive track's entries; a missing file reads as empty. */
  entriesOf(target, cwd) {
    try {
      return parseEntries(readFileSync(this.fileOf(target, cwd), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Append one entry under the directory lock (atomic write). */
  append(target, content, cwd) {
    // Lock file directory (key archive = project directory, mutually exclusive with main-track writes/merges; global archive = memory root)
    const lockDir = dirname(this.fileOf(target, cwd))
    return withLock(lockDir, () => {
      const entries = this.entriesOf(target, cwd)
      entries.push(content)
      const path = this.fileOf(target, cwd)
      const tmp = `${path}.tmp.${process.pid}`
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmp, serializeEntries(entries))
      renameSync(tmp, path)
      return { ok: true, total: entries.length }
    })
  }

  /** Remove the single entry containing the unique substring `match`. */
  remove(target, match, cwd) {
    const lockDir = dirname(this.fileOf(target, cwd))
    return withLock(lockDir, () => {
      const entries = this.entriesOf(target, cwd)
      const matches = entries.filter((entry) => entry.includes(match))
      if (matches.length === 0) return { ok: false, message: stt('storetail.archiveNoMatch', { match }) }
      if (matches.length > 1) {
        return { ok: false, message: stt('storetail.archiveMultiMatch', { match, count: matches.length }) }
      }
      const next = entries.filter((entry) => !entry.includes(match))
      const path = this.fileOf(target, cwd)
      const tmp = `${path}.tmp.${process.pid}`
      writeFileSync(tmp, serializeEntries(next))
      renameSync(tmp, path)
      return { ok: true, removed: matches[0] }
    })
  }

  /** Remove the entry that EXACTLY equals `content` (whole-entry match). */
  removeExact(target, content, cwd) {
    return withLock(this.dir, () => {
      const entries = this.entriesOf(target, cwd)
      const index = entries.indexOf(content)
      if (index === -1) {
        return { ok: false, message: stt('storetail.archiveEntryMissing') }
      }
      const next = [...entries]
      next.splice(index, 1)
      const path = this.fileOf(target, cwd)
      const tmp = `${path}.tmp.${process.pid}`
      writeFileSync(tmp, serializeEntries(next))
      renameSync(tmp, path)
      return { ok: true, removed: content }
    })
  }
}
