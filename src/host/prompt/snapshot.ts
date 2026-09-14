import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import type { MaestroMemoryStore } from '../memory/store.ts'
import { entryHeadPrefix, parseEntrySummary } from '../storage/legacy-format.ts'
import { projectReferencePath, userMemoryPath } from '../storage/layout.ts'
import { appendEntryAtomicSync } from '../storage/atomic-store.ts'

export interface SnapshotContext {
  cwd: string | null
  branch?: string
  sessionId?: string
  sessionName?: string
  /**
   * True for a subagent session (`session.header.origin === 'subagent'`).
   * Subagents deliver to a parent session, not to the human, so they get the
   * per-achievement cadence instead of the per-turn one.
   */
  isSubagent?: boolean
}

/** Default per-section byte budgets for the snapshot prompt. */
export const SNAPSHOT_SECTION_CAPS = { memory: 2048, user: 4096, key: 6144, recentDaily: 512, autoRecall: 1024 } as const

export type SnapshotSectionKey = keyof typeof SNAPSHOT_SECTION_CAPS

export interface SnapshotRenderOpts {
  /** Partial override of {@link SNAPSHOT_SECTION_CAPS}; unspecified sections keep defaults. */
  caps?: Partial<Record<SnapshotSectionKey, number>>
  /**
   * Set only while the per-turn write watchdog is due for this session. The
   * caller owns the gap counter; the renderer only renders the escalation.
   */
  writeGuard?: { threshold: number } | null
}

const SECTION_SEP = '\n---\n'

/** Compact an oversize entry to `head + [summary:…]` when it carries a summary tag; otherwise keep whole. */
function compactToHead(entry: string): string {
  const summary = parseEntrySummary(entry)
  if (summary === null) return entry
  return `${entryHeadPrefix(entry)}[summary:${summary}]`
}

/** What a capped section actually cost, including what the cap excluded. */
export interface FittedSection {
  kept: string[]
  /** UTF-8 bytes of the kept entries, separators included. */
  bytes: number
  /** Entries the cap excluded. */
  dropped: number
}

/**
 * Keep the newest entries whose combined UTF-8 size (with separators) fits `cap`.
 * The newest entry is always kept — compacted to its summary head when oversized
 * and tagged; untagged oversize entries stay whole rather than vanishing.
 *
 * Returns the drop count as well as the kept entries: without it, a store that
 * has outgrown its window and a cap that is too eager look identical from the
 * outside — which is how a hard rule silently stopped being injected.
 */
function fitSection(entries: string[], cap: number): FittedSection {
  if (entries.length === 0) return { kept: [], bytes: 0, dropped: 0 }
  const keptDesc: string[] = []
  let used = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const isNewest = keptDesc.length === 0
    let candidate = entries[i]
    if (isNewest && Buffer.byteLength(candidate, 'utf8') > cap) candidate = compactToHead(candidate)
    const cost = Buffer.byteLength(candidate, 'utf8') + (keptDesc.length ? SECTION_SEP.length : 0)
    if (!isNewest && used + cost > cap) break
    keptDesc.push(candidate)
    used += cost
  }
  return { kept: keptDesc.reverse(), bytes: used, dropped: entries.length - keptDesc.length }
}

/**
 * Collapse every run of two or more braces to one.
 *
 * DSH interpolates each prompt context before it reaches the model and fails
 * the whole turn when a `{{name}}` group carries a malformed or unregistered
 * name. Memory entries are free-form prose that may quote a template language,
 * so the snapshot must not hand a literal `{{` to that step; a single brace is
 * literal text to the interpolator.
 */
function neutralizePromptBraces(text: string): string {
  return text.replace(/\{{2,}/g, '{').replace(/\}{2,}/g, '}')
}

/** Per-section cost of one render. */
export interface SectionStats {
  key: 'memory' | 'user' | 'key' | 'projectContext' | 'reference' | 'recentDaily'
  cap: number
  bytes: number
  entries: number
  dropped: number
}

/** Cost of one rendered snapshot. */
export interface SnapshotStats {
  totalBytes: number
  sections: SectionStats[]
  renderedAt: number
}

/**
 * Bounded snapshot renderer — contract from README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + Project Context (auto-recall top-4, 600 chars each)
 * + Recent Daily + end-of-turn discipline note.
 * Full daily/project logs are query-only; only the bounded recall slices are injected.
 *
 * Every capped section records what it kept and what its cap excluded, so the
 * cost of memory on the prompt is measurable instead of inferred.
 */
export function renderSnapshotWithStats(
  store: MaestroMemoryStore,
  ctx: SnapshotContext,
  opts: SnapshotRenderOpts = {},
): { text: string; stats: SnapshotStats } {
  const caps = { ...SNAPSHOT_SECTION_CAPS, ...opts.caps }
  const parts: string[] = []
  const sections: SectionStats[] = []
  const take = (key: SectionStats['key'], fitted: FittedSection, cap: number, text: string) => {
    parts.push(text)
    sections.push({ key, cap, bytes: fitted.bytes, entries: fitted.kept.length, dropped: fitted.dropped })
  }

  // Header
  if (ctx.sessionId || ctx.sessionName) {
    const header = [
      ctx.sessionId ? `sessionId: ${ctx.sessionId}` : null,
      ctx.sessionName ? `sessionName: ${ctx.sessionName}` : null,
    ].filter(Boolean).join(' | ')
    if (header) parts.push(`# Session\n${header}`)
  }

  // Bounded memory sections — delegate branch filtering to store.list, then enforce byte caps
  const mem = fitSection(store.list('memory'), caps.memory)
  let user = fitSection(store.list('user'), caps.user)
  // Bootstrap USER.md from session context when missing/empty (no profile file yet)
  if (user.kept.length === 0 && (ctx.sessionName || ctx.sessionId)) {
    try {
      const userFile = userMemoryPath(store.resolveRoot())
      if (!existsSync(userFile) || readFileSync(userFile, 'utf8').trim() === '') {
        const stamp = new Date().toISOString().slice(0, 10)
        const profileLines: string[] = []
        if (ctx.sessionName) profileLines.push(`Session: ${ctx.sessionName}`)
        if (ctx.sessionId) profileLines.push(`Session ID: ${ctx.sessionId}`)
        if (profileLines.length) {
          const bootEntry = `[${stamp}] ${profileLines.join('; ')}`
          appendEntryAtomicSync(userFile, bootEntry)
          user = fitSection(store.list('user'), caps.user)
        }
      }
    } catch {}
  }
  const key = ctx.cwd
    ? fitSection(store.list('key', ctx.cwd, ctx.branch ? { branch: ctx.branch } : {}), caps.key)
    : { kept: [], bytes: 0, dropped: 0 }

  if (mem.kept.length) take('memory', mem, caps.memory, `# Global Memory\n${mem.kept.join('\n---\n')}`)
  if (user.kept.length) take('user', user, caps.user, `# User Memory\n${user.kept.join('\n---\n')}`)
  if (key.kept.length) take('key', key, caps.key, `# Project Key Memory\n${key.kept.join('\n---\n')}`)

  // Auto-recall: newest 4 project entries for current cwd, each truncated to 600 chars
  // Mirrors dsh-memory timeline(limit:4, 600 chars) but file-native, no Python.
  if (ctx.cwd) {
    try {
      const proj = store.list('project', ctx.cwd)
      if (proj.length) {
        const newest4 = proj.slice(-4).map((e) => e.slice(0, 600))
        const fitted = fitSection(newest4, (caps as any).autoRecall ?? 1024)
        if (fitted.kept.length) take('projectContext', fitted, (caps as any).autoRecall ?? 1024, `# Project Context\n${fitted.kept.join('\n---\n')}`)
      }
    } catch {}

    // Bounded REFERENCE.md slice — project's curated knowledge (hybrid: invariants in KEY, narrative here)
    // Only injects the top 2048 bytes so large references stay out of context but remain discoverable.
    try {
      const refPath = projectReferencePath(store.resolveRoot(), ctx.cwd)
      if (existsSync(refPath)) {
        const refContent = readFileSync(refPath, 'utf8')
        const slice = refContent.slice(0, 2048)
        if (slice.trim().length > 0) {
          const bytes = Buffer.byteLength(slice, 'utf8')
          take('reference', { kept: [slice], bytes, dropped: 0 }, 2048, `# Project Knowledge\n${slice}`)
        }
      }
    } catch {}
  }

  // Recent daily slot (512B) — last 2 days' newest entries
  // Keeps recent context without exceeding cap; full logs remain query-only.
  // Use local calendar (matching store.todayStamp) to avoid UTC/local drift near midnight.
  try {
    const recentDaily: string[] = []
    // Oldest first: fitSection() treats the last element as the newest and keeps
    // entries backwards from there, so today's entry must be pushed last.
    for (let i = 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const ds = `${d.getFullYear()}-${mm}-${dd}`
      try {
        const list: string[] = store.list('daily', undefined, { date: ds } as any)
        if (list.length) recentDaily.push(list[list.length - 1])
      } catch {}
    }
    if (recentDaily.length) {
      const fitted = fitSection(recentDaily, caps.recentDaily)
      if (fitted.kept.length) take('recentDaily', fitted, caps.recentDaily, `# Recent Daily\n${fitted.kept.join('\n---\n')}`)
    }
  } catch {}

  // End-of-turn discipline note — verbatim contract (hardened: exactly once, always last)
  // Conditional to avoid idle loops: only when turn produced meaningful progress.
  // Updated 2026-09-05: reality is daily-only (project MEMORY.md stays timeline-log, not entries);
  // durable decisions go through memory_suggest target=key, not memory add.
  // Subagent sessions get a restrained per-achievement cadence instead: they
  // report to a parent session rather than to the human, and a per-turn duty
  // under bulk delegation would flood the tracks.
  const discipline = ctx.isSubagent
    ? SUBAGENT_TURN_END
    : `---\nEnd of every turn — if this turn produced meaningful progress (code, decisions, learnings, or next steps): 1. Write daily via memory entries (daily in one call, skip if idle/waiting or no new information — never write entries containing only 'Idle' or placeholders). 2. For important project decisions (convention, incident, infra) use memory_suggest target=key with reason, not memory add. 3. Check maestro_todo list only if relevant (bounded, max 8).`
  // Defensive: strip any pre-existing discipline entry (should never occur — parts is fresh per call)
  // then append exactly once so the note is guaranteed last even for empty stores or repeated calls.
  const deduped = parts.filter((p) => p !== discipline)
  // Write watchdog escalation, placed immediately before the discipline note so
  // the note stays the snapshot's final instruction. The text is deliberately
  // static — the threshold comes from configuration, never from the live gap —
  // so one open gap costs at most two tail snapshots (appear, then disappear).
  // Never rendered for a subagent: the per-turn duty is not theirs to pay.
  if (opts.writeGuard && !ctx.isSubagent) deduped.push(renderWriteBacklog(opts.writeGuard.threshold))
  deduped.push(discipline)

  const text = neutralizePromptBraces(deduped.join('\n\n'))
  return {
    text,
    stats: {
      totalBytes: Buffer.byteLength(text, 'utf8'),
      // The discipline/backlog tail is prompt contract, not store content: it is
      // counted in `totalBytes` and deliberately has no section row of its own.
      sections,
      renderedAt: Date.now(),
    },
  }
}

/**
 * Signature-compatible wrapper. Callers that need the cost use
 * {@link renderSnapshotWithStats}; everything else keeps calling this.
 */
export function renderSnapshot(
  store: MaestroMemoryStore,
  ctx: SnapshotContext,
  opts: SnapshotRenderOpts = {},
): string {
  return renderSnapshotWithStats(store, ctx, opts).text
}

/**
 * Turn-end instruction for subagent sessions. Mirrors the human-facing note's
 * intent at the cadence a subagent actually has: one entry per independent
 * achievement, nothing when there is nothing to report.
 */
const SUBAGENT_TURN_END = `---
Turn end (subagent session) — only after completing an independent achievement (a substantive deliverable, a key decision, or a pitfall conclusion), write ONE concise entry with a single memory add; for important conclusions use memory_suggest target=key with reason. Skip entirely when there is no independent achievement — do not write for writing's sake. The per-turn daily cadence applies to human-facing sessions only.`

/**
 * Sticky backlog alert emitted while the per-turn write watchdog is tripped.
 * Names only the guarded tracks so it can never order a write to a track the
 * human disabled.
 */
function renderWriteBacklog(threshold: number): string {
  return `# ⚠️ Memory Write Backlog
This session has gone ${threshold}+ consecutive turns with no daily/project memory write. Before this turn ends, catch up in ONE memory call — action=add with an entries[] array holding one item per track, condensing the missed turns into 1-2 lines each — then resume the one-entry-per-turn rhythm.`
}
