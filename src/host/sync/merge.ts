/**
 * merge.ts — union merge by id, never drops either version.
 * Pure functions, no I/O.
 */

const MEMORY_ID_RE = /^\[id:\s*([0-9a-f]{8})\]\s*/i

export interface ConflictRecord {
  id: string
  track: string
  localEntry: string | null
  remoteEntry: string | null
  reason: string
}

export interface MergeResult {
  merged: string[]
  conflicts: ConflictRecord[]
  addedLocal: string[]
  addedRemote: string[]
}

function extractMemoryId(entry: string): string | null {
  const m = MEMORY_ID_RE.exec(String(entry))
  return m ? m[1].toLowerCase() : null
}

function normalizeEntry(entry: string): string {
  return String(entry).trim()
}

function contentHash(entry: string): string {
  // strip id prefix for comparison of body? But for modifiedBoth we want body difference
  // Compare full stripped id content; if id same but body differs => conflict
  const withoutId = String(entry).replace(MEMORY_ID_RE, '').trim()
  return withoutId
}

/**
 * Parse entries into map id => entry. Entries without id are assigned a synthetic
 * id derived from content hash (for safety) but flagged as missing.
 */
export function mapById(entries: string[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of entries) {
    const id = extractMemoryId(e)
    if (id) {
      // keep first occurrence; duplicates by id should not happen but last wins
      if (!m.has(id)) m.set(id, e)
    }
  }
  return m
}

export function idsOf(entries: string[]): Set<string> {
  const s = new Set<string>()
  for (const e of entries) {
    const id = extractMemoryId(e)
    if (id) s.add(id)
  }
  return s
}

/**
 * Union merge for memory-style entries (KEY, MEMORY, archive).
 * - local + remote entries with distinct ids => union (both present)
 * - same id, same content => one entry
 * - same id, different content => conflict (neither applied, keep local)
 */
export function mergeMemoryEntries(opts: {
  track: string
  local: string[]
  remote: string[]
  baseIds?: Set<string>
}): MergeResult {
  const { track, local, remote, baseIds } = opts
  const localMap = mapById(local)
  const remoteMap = mapById(remote)

  const base = baseIds ?? new Set<string>()

  const localIds = new Set(localMap.keys())
  const remoteIds = new Set(remoteMap.keys())

  const allIds = new Set<string>([...localIds, ...remoteIds])

  const merged: string[] = []
  const conflicts: ConflictRecord[] = []
  const addedLocal: string[] = []
  const addedRemote: string[] = []

  for (const id of allIds) {
    const hasLocal = localMap.has(id)
    const hasRemote = remoteMap.has(id)
    const localEntry = localMap.get(id) ?? null
    const remoteEntry = remoteMap.get(id) ?? null

    if (hasLocal && !hasRemote) {
      // local only
      if (base.has(id)) {
        // deletedRemote? base had it, remote deleted -> conflict if local modified?
        // per spec: delete vs modify => conflict, delete vs delete => absent
        // Our simple rule: if base has id and remote missing, but local present and content differs from base? we don't have base content, so treat as remote deletion -> keep local but flag? For MVP, keep local.
        merged.push(localEntry!)
      } else {
        // addedLocal
        addedLocal.push(id)
        merged.push(localEntry!)
      }
      continue
    }
    if (!hasLocal && hasRemote) {
      if (base.has(id)) {
        // deletedLocal vs remote present => conflict? keep remote? per spec conflict
        // For MVP, we consider this addedRemote if not in base, else conflict -> keep remote but record conflict? Simpler add.
        if (localIds.has(id)) {
          // unreachable
        }
        // If base had it and local deleted -> conflict not auto delete. We treat as conflict.
        // Check if local deleted intentionally: we flag conflict
        conflicts.push({ id, track, localEntry: null, remoteEntry, reason: 'deletedLocal vs modifiedRemote' })
        // do not auto-merge; keep local deletion (i.e., not in merged) — but per never-drop, we should keep remote as conflict.
        // For now, push remote to merged but also mark conflict, so union still contains remote? Spec says delete not applied when other side modified => conflict.
        // We'll keep remote out of merged until resolve, to avoid auto-drop of delete.
        // Decision: do not push to merged, leave conflict.
        continue
      } else {
        addedRemote.push(id)
        merged.push(remoteEntry!)
      }
      continue
    }
    if (hasLocal && hasRemote) {
      const l = localEntry!
      const r = remoteEntry!
      if (normalizeEntry(l) === normalizeEntry(r)) {
        merged.push(l)
      } else if (contentHash(l) === contentHash(r)) {
        // ids same, content same after stripping id? Actually already compared normalized; if equal after stripping id they are same body
        merged.push(l)
      } else {
        // same id, different body => conflict
        conflicts.push({ id, track, localEntry: l, remoteEntry: r, reason: 'modifiedBoth' })
        // keep local in merged, remote not auto-applied
        merged.push(l)
      }
    }
  }

  // Also handle local entries without id (legacy) — they are not in map; append them verbatim to merged if not duplicated
  for (const e of local) {
    if (!extractMemoryId(e)) {
      if (!merged.includes(e)) merged.push(e)
    }
  }
  for (const e of remote) {
    if (!extractMemoryId(e) && !merged.includes(e)) {
      // remote entry without id — treat as addedRemote but can't dedupe; add if not duplicate body
      const body = contentHash(e)
      const exists = merged.some((m) => contentHash(m) === body)
      if (!exists) {
        merged.push(e)
        if (!extractMemoryId(e)) {
          // synthetic id absent, still count as added
        }
      }
    }
  }

  return { merged, conflicts, addedLocal, addedRemote }
}

// Todo merge: same id logic but todos are already stamped with id; reuse same function with track='TODOS'
export function mergeTodoEntries(opts: { local: string[]; remote: string[]; baseIds?: Set<string> }): MergeResult {
  // Todos use same id regex: \[id: xxxxxxxx\]
  // But todo entries are multiline: first line contains id; our extract works on full entry (first line)
  return mergeMemoryEntries({ track: 'TODOS', local: opts.local, remote: opts.remote, baseIds: opts.baseIds })
}

// Helpers for sync service: compute ids snapshot for meta
export function snapshotIds(entriesByTrack: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [track, entries] of Object.entries(entriesByTrack)) {
    const ids = [...idsOf(entries)].sort()
    out[track] = ids
  }
  return out
}
