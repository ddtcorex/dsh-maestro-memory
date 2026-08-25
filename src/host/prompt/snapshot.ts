import type { MaestroMemoryStore } from '../memory/store.ts'

export interface SnapshotContext {
  cwd: string | null
  branch?: string
  sessionId?: string
  sessionName?: string
}

/**
 * Bounded snapshot renderer — contract từ README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + end-of-turn discipline note.
 * daily và project KHÔNG inject.
 */
export function renderSnapshot(
  store: MaestroMemoryStore,
  ctx: SnapshotContext,
): string {
  const parts: string[] = []

  // Header
  if (ctx.sessionId || ctx.sessionName) {
    const header = [
      ctx.sessionId ? `sessionId: ${ctx.sessionId}` : null,
      ctx.sessionName ? `sessionName: ${ctx.sessionName}` : null,
    ].filter(Boolean).join(' | ')
    if (header) parts.push(`# Session\n${header}`)
  }

  // Bounded memory sections — delegate branch filtering to store.list
  const mem = store.list('memory')
  const user = store.list('user')
  const key = ctx.cwd ? store.list('key', ctx.cwd, ctx.branch ? { branch: ctx.branch } : {}) : []

  if (mem.length) parts.push(`# Global Memory\n${mem.join('\n---\n')}`)
  if (user.length) parts.push(`# User Memory\n${user.join('\n---\n')}`)
  if (key.length) parts.push(`# Project Key Memory\n${key.join('\n---\n')}`)

  // End-of-turn discipline note — verbatim contract
  parts.push(
    `---\nEnd of every turn you must: 1. Write daily+project via memory entries (daily+project in one call) 2. Check dtodo list (bounded, max 8)`,
  )

  return parts.join('\n\n')
}
