/**
 * maintenance.ts — pure archive planning for an overgrown track.
 *
 * The store has no curation path in practice (`archive` was never called in
 * 1,434 recorded sessions), so a track grows until its section cap silently
 * excludes everything but the newest entries: `projects/<hash>/KEY.md` holds
 * 150 entries while the snapshot shows 3 of them.
 *
 * This planner decides, deterministically, which entries stay live and which
 * move to the track's `*-archive.md`. Two rules, both conservative:
 *
 *   - keep the newest entries that fit `keepBytes`; older ones are archived;
 *   - archive anything older than `maxAgeDays` — but never an undated entry on
 *     the age rule alone, because an undated entry is evidence the grammar did
 *     not parse, not evidence that it is stale.
 *
 * Pure: no I/O and no clock (the caller passes `now`), so the result can be
 * shown to a human before anything moves.
 *
 * @module memory/maintenance
 */
import { extractEntryDate } from '../storage/legacy-format.ts'

export interface ArchivePolicy {
  keepBytes: number
  maxAgeDays: number
}

/** Tracks that have an archive file. `daily` is excluded: it is already per-day. */
export type ArchivableTrack = 'memory' | 'user' | 'key' | 'project'

export const DEFAULT_ARCHIVE_POLICY: Record<ArchivableTrack, ArchivePolicy> = {
  memory: { keepBytes: 8_192, maxAgeDays: 180 },
  user: { keepBytes: 8_192, maxAgeDays: 180 },
  key: { keepBytes: 65_536, maxAgeDays: 180 },
  project: { keepBytes: 131_072, maxAgeDays: 180 },
}

export interface ArchivePlan {
  /** Entries that stay in the live file, in file order. */
  keep: string[]
  /** Entries that move to the archive file, in file order. */
  archive: string[]
  oldestKept: string | null
}

/** Plan which entries of `entries` stay live under `policy`. */
export function planArchive(entries: string[], policy: ArchivePolicy, now: Date = new Date()): ArchivePlan {
  const cutoff = new Date(now.getTime() - policy.maxAgeDays * 86_400_000).toISOString().slice(0, 10)
  const keepFlags = new Array<boolean>(entries.length).fill(true)

  // Rule 1 — age. An undated entry is never archived by this rule.
  entries.forEach((entry, i) => {
    const date = extractEntryDate(entry)
    if (date !== null && date < cutoff) keepFlags[i] = false
  })

  // Rule 2 — byte budget over whatever still survives, newest backwards.
  let used = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!keepFlags[i]) continue
    const cost = Buffer.byteLength(entries[i], 'utf8')
    if (used + cost > policy.keepBytes) keepFlags[i] = false
    else used += cost
  }

  const keep: string[] = []
  const archive: string[] = []
  entries.forEach((entry, i) => (keepFlags[i] ? keep : archive).push(entry))
  return { keep, archive, oldestKept: keep.length > 0 ? keep[0] : null }
}
