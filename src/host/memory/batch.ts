import type { MaestroMemoryStore, MemoryTarget } from './store.ts'

/** Targets accepted by MaestroMemoryStore ('global' is a normalized alias of 'memory'). */
const VALID_TARGETS = new Set<string>(['memory', 'global', 'user', 'project', 'key', 'daily'])

export interface BatchEntryInput {
  target: MemoryTarget | string
  content: string
  /** Working directory for project/key tracks. */
  cwd?: string
  /** Explicit day for daily track (YYYY-MM-DD). */
  date?: string
  /** Branch scope csv for key add (e.g. 'main,dev'). */
  branches?: string
  /** One-line summary for key add (progressive disclosure). */
  summary?: string
}

export type BatchResult =
  | { ok: true; ids: (string | undefined)[] }
  | { ok: false; index: number; error: string }

/**
 * Add several entries sequentially through {@link MaestroMemoryStore.add}.
 *
 * Atomicity contract: storage-level writes stay per-file atomic (existing
 * appendEntryAtomicSync), and the batch wraps them with rollback-on-failure —
 * every entry successfully created earlier in this same call is removed again
 * before reporting the failure index. Removal targets the generated `[id:]`
 * token when the track issues ids (key), otherwise the trimmed content itself;
 * remove()'s unique-match guard turns any ambiguity into a reported rollback
 * failure instead of deleting a wrong entry. Entries detected as duplicates
 * are left untouched (they pre-date this call).
 *
 * Unknown targets are rejected up-front per entry so a typo never writes a
 * stray file mid-batch.
 */
export function applyBatch(
  store: MaestroMemoryStore,
  entries: BatchEntryInput[],
): BatchResult {
  const added: { target: MemoryTarget; token: string; cwd?: string; date?: string }[] = []
  const ids: (string | undefined)[] = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const target = String(e?.target ?? '')
    if (!VALID_TARGETS.has(target)) {
      return fail(store, added, i, `unknown target '${target}'`)
    }
    const res = store.add(target as MemoryTarget, e.content ?? '', e.cwd, {
      branches: e.branches,
      summary: e.summary,
      date: e.date,
    })
    if (!res.ok) {
      return fail(store, added, i, res.error)
    }
    ids.push(res.id)
    // Duplicates carry no id and did not modify storage — nothing to roll back.
    if (!res.duplicate) {
      added.push({
        target: target as MemoryTarget,
        // key entries carry a generated id token; other tracks are stored
        // verbatim, so the trimmed content is the precise removal token.
        token: res.id !== undefined ? `[id:${res.id}]` : String(e.content ?? '').trim(),
        cwd: e.cwd,
        date: e.date,
      })
    }
  }
  return { ok: true, ids }
}

function fail(
  store: MaestroMemoryStore,
  added: { target: MemoryTarget; token: string; cwd?: string; date?: string }[],
  index: number,
  error: string,
): BatchResult {
  const rollbackFailures: string[] = []
  for (const a of added) {
    const rm = store.remove(a.target, a.token, a.cwd, { date: a.date })
    if (!rm.ok) rollbackFailures.push(`${a.target}:${a.token.slice(0, 24)}`)
  }
  const suffix = rollbackFailures.length ? ` (rollback failed for ${rollbackFailures.join(',')})` : ''
  return { ok: false, index, error: `${error}${suffix}` }
}
