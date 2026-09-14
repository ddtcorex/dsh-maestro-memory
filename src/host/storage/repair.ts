/**
 * repair.ts — pure, deterministic repair of a memory-track file.
 *
 * Two corruption classes are repaired, both observed in the live store:
 *
 * 1. **Glued entries** — a blob that holds two logical entries but only one
 *    `§` delimiter (or none). A delimiter-based split cannot recover these, so
 *    the rule is stricter and narrower: a line whose FIRST token is an entry
 *    head starts a new entry. A continuation line that merely mentions a date
 *    mid-sentence does not match, because the pattern is anchored at line start.
 * 2. **Exact duplicates** — the same entry appended more than once. Keeping the
 *    FIRST occurrence preserves the original chronology.
 *
 * No I/O, no store, no clock: `planRepair` is a pure function so the caller can
 * preview it (dryRun) and the tests never touch disk. Equality is the same
 * notion `add()` uses — id-stripped, summary-stripped, whitespace-normalized.
 *
 * @module storage/repair
 */
import { parseEntries, serializeEntries } from './atomic-store.ts'
import { entryHeadPrefix, parseEntrySummary } from './legacy-format.ts'

/** An entry head at line start: `[YYYY-MM-DD]`, `[YYYY-MM-DD HH:MM]`, optional `[id:xxxxxxxx]` first. */
const HEAD_LINE_RE = /^(?:\[id:\s*[0-9a-f]{8}\]\s*)?\[\d{4}-\d{2}-\d{2}(?:[ T][\d:]*)?\]/

const SUMMARY_TAG_RE = /\[summary:[^\]]*\]\s*/g
const ID_TAG_RE = /^\[id:\s*[0-9a-f]{8}\]\s*/i

export interface RepairPlan {
  /** Entries parsed from the raw text before repair. */
  before: number
  /** Entries after split + dedupe. */
  after: number
  /** Entries recovered by splitting glued blobs. */
  split: number
  /** Entries removed as exact duplicates. */
  deduped: number
  /** Entries whose trailing `[summary:…]` tag was moved to the header position. */
  relocated: number
  /** True when `text` differs from the input. */
  changed: boolean
  /** Repaired entries, in file order. */
  entries: string[]
  /** Canonical serialization of `entries`. */
  text: string
}

/** Split one parsed entry into the logical entries glued inside it. */
function splitGlued(entry: string): string[] {
  const lines = entry.split('\n')
  const parts: string[][] = []
  for (const line of lines) {
    const startsNew = HEAD_LINE_RE.test(line)
    if (startsNew && parts.length > 0 && parts[parts.length - 1].length > 0) parts.push([])
    if (parts.length === 0) parts.push([])
    parts[parts.length - 1].push(line)
  }
  return parts.map((p) => p.join('\n').trim()).filter((p) => p.length > 0)
}

/** Equality key: id- and summary-insensitive, whitespace-normalized. */
function entryKey(entry: string): string {
  return entry
    .replace(ID_TAG_RE, '')
    .replace(SUMMARY_TAG_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Move a trailing `[summary:…]` tag to the canonical header position.
 *
 * The grammar places the tag immediately after the id/timestamp header, and
 * that is the only position `parseEntrySummary` recognises. The auto-summary
 * writer appended it at the END of the entry instead, so the tag existed but
 * was invisible to the snapshot's compactor: `# Recent Daily` (cap 512 B)
 * rendered 1,518 B and the global section 2,303 B, because no auto-summarized
 * entry could ever be compacted. Deterministic and idempotent.
 */
function relocateTrailingSummary(entry: string): string {
  if (parseEntrySummary(entry) !== null) return entry
  const trailing = /\[summary:([^\]]*)\]\s*$/.exec(entry)
  if (trailing === null) return entry
  const body = entry.slice(0, trailing.index).trimEnd()
  const head = entryHeadPrefix(body)
  if (!head) return entry
  const rest = body.slice(head.length).replace(/^\s+/, '')
  const rebuilt = `${head.trimEnd()} [summary:${trailing[1]}] ${rest}`.trimEnd()
  return rebuilt.trim() === '' ? entry : rebuilt
}

/** Drop later copies of an entry, keeping the first occurrence. */
function dedupe(entries: string[]): { entries: string[]; removed: number } {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const entry of entries) {
    const key = entryKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(entry)
  }
  return { entries: kept, removed: entries.length - kept.length }
}

/** Plan a repair without touching disk. Idempotent: `planRepair(plan.text).changed === false`. */
export function planRepair(raw: string): RepairPlan {
  const source = String(raw ?? '')
  const parsed = parseEntries(source)
  const splitEntries = parsed.flatMap(splitGlued)
  const relocatedEntries = splitEntries.map(relocateTrailingSummary)
  const relocated = relocatedEntries.reduce((n, e, i) => (e === splitEntries[i] ? n : n + 1), 0)
  const { entries, removed } = dedupe(relocatedEntries)
  const text = serializeEntries(entries)
  // A blank file is canonical by `isCanonical()`'s own definition, so repairing
  // it would only rewrite whitespace and mint a pointless backup: no-op.
  const changed = source.trim() !== '' && text !== source
  return {
    before: parsed.length,
    after: entries.length,
    split: splitEntries.length - parsed.length,
    deduped: removed,
    relocated,
    changed,
    entries,
    text,
  }
}
