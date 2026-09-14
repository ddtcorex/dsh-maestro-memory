/**
 * dsh-maestro-memory — host entry (M2-PR-B: confirmation queue, gated memory_suggest, RPC decide, Review UI)
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MaestroMemoryStore } from './memory/store.ts'
import { repairAllTracks } from './memory/repair-runner.ts'
import { applyBatch } from './memory/batch.ts'
import { buildFeedbackLine } from './memory/feedback.ts'
import { TodoStore, resolveQuadrant, DEFAULT_VIEW_LIMIT } from './todo/store.ts'
import { TODO_TARGETS, TODO_STATUSES } from './storage/legacy-format.ts'
import { SuggestionQueue, enqueueSuggestion, approveSuggestions, rejectSuggestions } from './review/queue.ts'
import { resolveMemoryRoot, suggestionsPath, globalArchivePath, userArchivePath, projectKeyArchivePath, projectArchivePath, projectMemoryPath, dailyPath, todoArchivePath, maestroMetaDir } from './storage/layout.ts'
import { appendEntryAtomicSync } from './storage/atomic-store.ts'
import * as migration from './migration/service.ts'
import { SyncService } from './sync/service.ts'
import { RealGitAdapter } from './sync/git.ts'
import { listSkillsSync, resolveDefaultMaestroSkillsDir } from './skills-browser.ts'
import { renderSnapshotWithStats } from './prompt/snapshot.ts'
import { createCostTracker } from './cost-tracker.ts'
import { installAutoMemoryHooks, DEFAULT_AUTO_MEMORY, type AutoMemoryOptions } from './auto-memory.ts'
import { computeFiveDim } from './health-score.ts'
import { createWriteGapCounter, isGuardedTrack } from './memory/write-guard.ts'

export const inject = ['tools', 'systemPrompt', 'connection', 'sessions'] as const

export interface WriteGuardConfig {
  /** Enable the per-turn write watchdog (default false — an opt-in pacing aid). */
  enabled?: boolean
  /** Consecutive write-less human turns before the snapshot escalates. */
  threshold?: number
}

export interface MaestroMemoryConfig {
  memoryDir?: string | null
  snapshotOrder?: number
  autoMemory?: Partial<AutoMemoryOptions>
  writeGuard?: WriteGuardConfig
}

export const DEFAULT_WRITE_GUARD: Required<WriteGuardConfig> = {
  enabled: false,
  threshold: 2,
}

export const DEFAULTS: Required<MaestroMemoryConfig> = {
  memoryDir: null,
  snapshotOrder: 500,
  autoMemory: { ...DEFAULT_AUTO_MEMORY },
  writeGuard: { ...DEFAULT_WRITE_GUARD },
}

/**
 * Routing line for the two task systems one session can see. `todo_write` is the
 * harness's in-session plan (whole-list replace, rendered by the Todos panel);
 * `maestro_todo` is this plugin's durable cross-session store. Published on
 * every turn because the two tool descriptions cannot see each other, and a
 * model that has to guess puts the human's real todos in a throwaway list (or
 * plans its own work into the human's store).
 */
export const TASK_SYSTEMS_NOTE =
  '---\n'
  + 'Task lists — two separate systems, never mix them: `todo_write` is THIS session\'s plan '
  + '(ephemeral, replaces the whole list on every call, shown in the harness Todos panel). '
  + '`maestro_todo` is the human\'s durable cross-session store (tracks life/work/project/daily, '
  + 'ids, due, quadrant, status, smart views; survives restarts; shown in the Memory view\'s Todo store tab). '
  + 'Plan your own work with `todo_write`; record or look up the human\'s real todos with `maestro_todo`.'

/** Resolve the write-guard config, keeping the threshold a usable positive integer. */
export function resolveWriteGuard(config?: WriteGuardConfig): Required<WriteGuardConfig> {
  const merged = { ...DEFAULT_WRITE_GUARD, ...(config ?? {}) }
  const raw = Number(merged.threshold)
  return {
    enabled: merged.enabled === true,
    // A misconfigured threshold must not silently disable the watchdog, and 0
    // must not mean "warn every turn": any value below 1 reads as 1.
    threshold: Number.isFinite(raw) ? Math.max(1, Math.trunc(raw)) : DEFAULT_WRITE_GUARD.threshold,
  }
}

export const READ_ACTIONS = new Set(['list', 'expand'])
export function isMemoryConcurrencySafe(args: any): boolean {
  return READ_ACTIONS.has(String(args?.action ?? ''))
}

// Extended unions for memory tool (M2-PR-A + M2-PR-B queue)
export type MemoryTarget = 'memory' | 'user' | 'project' | 'key' | 'daily'
export type MemoryAction = 'add' | 'list' | 'replace' | 'remove' | 'archive' | 'expand'

const CONTENT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { content: { type: 'array', required: true } },
  } as const,
  render: (_args: unknown, value: { content: any[] }) => value.content,
}

export function apply(ctx: any, config: MaestroMemoryConfig = {}): void {
  const order = config.snapshotOrder ?? DEFAULTS.snapshotOrder
  const store = new MaestroMemoryStore(config.memoryDir ?? null)
  const todoStore = new TodoStore(config.memoryDir ?? null)
  const root = resolveMemoryRoot(config.memoryDir ?? null)
  const queue = new SuggestionQueue(suggestionsPath(root))
  const syncService = new SyncService(config.memoryDir ?? null, new RealGitAdapter())
  const writeGuardConfig = resolveWriteGuard(config.writeGuard)
  // Per-turn write watchdog (opt-in). The counter lives for the process; it is
  // a pacing aid for drift inside one run, not durable state.
  const writeGuard = createWriteGapCounter(ctx, () => writeGuardConfig.enabled)
  // What the snapshot is costing the prompt, per section. In-memory only: a
  // restart starts a fresh window on purpose (same reasoning as the gap counter).
  const costTracker = createCostTracker()

  // One-time KEY.md delimiter repair (guarded by flag file)
  ctx.effect(() => {
    const flagFile = join(maestroMetaDir(root), 'key-repaired-v1')
    if (!existsSync(flagFile)) {
      // Attempt repair for any project that has a KEY.md
      try {
        const projectsDir = join(root, 'projects')
        if (existsSync(projectsDir)) {
          for (const projectHash of readdirSync(projectsDir)) {
            const keyFile = join(projectsDir, projectHash, 'KEY.md')
            if (existsSync(keyFile)) {
              store.repairKeyDelimiter(keyFile.replace(join(root, 'projects', projectHash, 'KEY.md'), ''))
            }
          }
        }
      } catch {}
      // Write flag to prevent re-running
      try {
        mkdirSync(maestroMetaDir(root), { recursive: true })
        writeFileSync(flagFile, 'ok', 'utf8')
      } catch {}
    }
    return () => {}
  }, 'maestro-memory: key-repair')

  // Whole-store repair, versioned separately from the KEY-only v1 pass above.
  // v1 never looked at the global MEMORY.md, which is exactly where the
  // 2026-09-09 migration glued two entries together and duplicated a third —
  // the injected `# Global Memory` section became one blob and pushed a hard
  // rule out of every prompt. A new flag file (not a rename of the old one)
  // keeps a downgrade from re-running v1.
  ctx.effect(() => {
    const flagFile = join(maestroMetaDir(root), 'delimiter-repaired-v2')
    if (!existsSync(flagFile)) {
      let report: unknown = null
      try {
        report = repairAllTracks(root, { dryRun: false })
      } catch {}
      try {
        mkdirSync(maestroMetaDir(root), { recursive: true })
        writeFileSync(flagFile, JSON.stringify({ at: new Date().toISOString(), report }), 'utf8')
      } catch {}
    }
    return () => {}
  }, 'maestro-memory: delimiter-repair')

  // Auto-memory (opt-in, default disabled) — session/event → store
  ctx.effect(() => {
    const am: AutoMemoryOptions = { ...DEFAULT_AUTO_MEMORY, ...(config.autoMemory ?? {}) }
    const dispose = installAutoMemoryHooks(ctx, store, am)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: auto-memory')

  ctx.effect(() => {
    const dispose = ctx.systemPrompt.context({
      name: 'memory:snapshot',
      order,
      text: (promptCtx: any) => {
        const agent = promptCtx?.agent
        const cwd: string | null = agent?.session?.header?.cwd ?? null
        const branch: string | undefined = agent?.session?.header?.branch ?? undefined
        const sessionId: string | undefined = agent?.session?.header?.sessionId
          ?? agent?.session?.id
          ?? undefined
        const sessionName: string | undefined = agent?.session?.header?.sessionName
          ?? agent?.session?.name
          ?? undefined
        // Subagent sessions owe one entry per achievement, not one per turn —
        // the per-turn watchdog is a human-facing duty and never applies to them.
        const isSubagent = agent?.session?.header?.origin === 'subagent'
        const due = writeGuardConfig.enabled
          && !isSubagent
          && writeGuard.gapOf(agent) >= writeGuardConfig.threshold
        const { text, stats } = renderSnapshotWithStats(
          store,
          { cwd, branch, sessionId, sessionName, isSubagent },
          due ? { writeGuard: { threshold: writeGuardConfig.threshold } } : {},
        )
        // Pacing/stats must never fail a turn.
        try {
          costTracker.record(stats)
        } catch {}
        return text
      },
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: snapshot')

  // The two task systems are named side by side on every turn (see
  // TASK_SYSTEMS_NOTE): a durable-vs-session mix-up is a routing mistake the
  // tool descriptions alone cannot prevent, because neither tool can see the
  // other one's text.
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.context({
      name: 'memory:task-systems',
      order,
      text: () => TASK_SYSTEMS_NOTE,
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: task-systems')

  ctx.effect(() => {
    const tool = defineTool({
      name: 'memory',
      description: 'Maestro memory (M2: five tracks, query, replace/remove, archive, branch, summary/expand)',
      parameters: {
        action: { type: 'string', required: true, enum: ['add', 'list', 'replace', 'remove', 'archive', 'expand'], description: 'Memory action' },
        target: { type: 'string', description: 'Memory track (daily=YYYY-MM-DD file, project=per-cwd log, key=per-cwd long-term); optional only when entries[] is used' },
        entries: { type: 'array', description: 'Batch add: array of {target,content,cwd?,date?,branches?,summary?} — sequential through store.add with rollback on first failure' },
        content: { type: 'string', description: 'Entry content (add) or new content (replace)' },
        match: { type: 'string', description: 'Unique substring identifying entry (replace/remove/archive)' },
        filter: { type: 'string', description: 'Content substring filter (list)' },
        since: { type: 'string', description: 'Start date YYYY-MM-DD (list)' },
        until: { type: 'string', description: 'End date YYYY-MM-DD (list)' },
        limit: { type: 'integer', description: 'Max entries (list)' },
        recent: { type: 'boolean', description: 'Newest first (list)' },
        branch: { type: 'string', description: 'Branch filter for key (list)' },
        branches: { type: 'string', description: 'Branch scope csv for key add, e.g. main,dev (empty=all)' },
        summary: { type: 'string', description: 'One-line summary for key add (progressive disclosure)' },
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'], description: 'Attach [Feedback] line on add when set (single add or entries[])' },
        category: { type: 'string', description: 'Feedback category (requires sentiment)' },
        quote: { type: 'string', description: 'Feedback quote (requires sentiment)' },
        note: { type: 'string', description: 'Feedback note (requires sentiment)' },
        id: { type: 'string', description: 'Entry id for expand (key)' },
        archived: { type: 'boolean', description: 'Query archive files (list)' },
        cwd: { type: 'string', description: 'Working directory for project/key tracks' },
        date: { type: 'string', description: 'Date YYYY-MM-DD for daily track (add/list/replace/remove)' },
      },
      output: CONTENT_OUTPUT,
      isConcurrencySafe: (args: any) => isMemoryConcurrencySafe(args),
      execute: async (args: any, exec: any) => {
        if (exec?.signal?.aborted) throw new Error('memory aborted')
        const target = args.target as MemoryTarget
        const action = args.action as MemoryAction
        const cwd: string | undefined = args.cwd ?? exec?.agent?.session?.header?.cwd
        try {
          switch (action) {
            case 'add': {
              // Batch path: entries[] takes precedence over the single target/content form.
              if (Array.isArray(args.entries)) {
                if (exec?.agent && args.entries.some((e: any) => String(e.target ?? '').trim() === 'key')) {
                  return { content: [{ type: 'text', text: 'key is gated — use memory_suggest target=key with reason (batch contains key)' }] }
                }
                if (!args.target && !args.content) {
                  // Inject the session cwd as per-entry fallback, mirroring the
                  // single-add path — otherwise project/key entries without an
                  // explicit cwd fail deep inside the store mid-batch.
                  const batchEntries = args.entries.map((entry: any) => ({ ...entry, cwd: entry.cwd ?? cwd }))
                  const batchRes = applyBatch(store, batchEntries)
                  if (!batchRes.ok) {
                    return { content: [{ type: 'text', text: `batch failed at [${batchRes.index}]: ${batchRes.error}` }] }
                  }
                  // Discharge the write-watchdog duty only when the batch really
                  // recorded something on a guarded track — a duplicate-only
                  // batch changed nothing, so the backlog still stands.
                  if (batchRes.added.some((entry) => isGuardedTrack(entry.target))) {
                    writeGuard.noteWrite(exec?.agent)
                  }
                  return { content: [{ type: 'text', text: `added ${batchRes.ids.length} ${batchRes.ids.length === 1 ? 'entry' : 'entries'} (batch)` }] }
                }
              } else if (!target) {
                return { content: [{ type: 'text', text: 'add failed: target is required for single add (or pass entries[])' }] }
              }
              // G1: gate key via agent — direct memory add for key must go through memory_suggest
              if (target === 'key' && exec?.agent) {
                return { content: [{ type: 'text', text: 'key is gated — use memory_suggest target=key with reason (direct memory add for key is CLI-only)' }] }
              }
              let entryText = args.content ?? ''
              if (args.sentiment !== undefined) {
                entryText = `${entryText.trimEnd()} ${buildFeedbackLine({
                  sentiment: args.sentiment,
                  category: args.category,
                  quote: args.quote,
                  note: args.note,
                })}`
              }
              const res = store.add(target, entryText, cwd, {
                branches: args.branches,
                summary: args.summary,
                // daily add targets a specific day when the caller passes date
                date: args.date,
              })
              if (!res.ok) return { content: [{ type: 'text', text: `add failed: ${res.error}` }] }
              // Discharge the per-turn write duty: only a guarded track counts,
              // and a deduplicated add recorded nothing new this turn.
              if (!res.duplicate && isGuardedTrack(target)) writeGuard.noteWrite(exec?.agent)
              return { content: [{ type: 'text', text: res.duplicate ? 'duplicate' : `added to ${target}` }] }
            }
            case 'list': {
              const entries = store.list(target, cwd, {
                filter: args.filter,
                since: args.since,
                until: args.until,
                limit: args.limit,
                recent: args.recent,
                branch: args.branch,
                archived: args.archived,
                date: args.date,
              })
              const text = entries.length ? entries.join('\n---\n') : '(no entries)'
              return { content: [{ type: 'text', text }] }
            }
            case 'replace': {
              const res = store.replace(target, args.match ?? '', args.content ?? '', cwd, { date: args.date })
              if (!res.ok) return { content: [{ type: 'text', text: `replace failed: ${res.error}` }] }
              return { content: [{ type: 'text', text: 'replaced' }] }
            }
            case 'remove': {
              const res = store.remove(target, args.match ?? '', cwd, { date: args.date })
              if (!res.ok) return { content: [{ type: 'text', text: `remove failed: ${res.error}` }] }
              return { content: [{ type: 'text', text: 'removed' }] }
            }
            case 'archive': {
              const res = store.archive(target, args.match ?? '', cwd)
              if (!res.ok) return { content: [{ type: 'text', text: `archive failed: ${res.error}` }] }
              return { content: [{ type: 'text', text: 'archived' }] }
            }
            case 'expand': {
              const res = store.expand(target, args.id ?? '', cwd)
              if (!res.ok) return { content: [{ type: 'text', text: `expand failed: ${res.error}` }] }
              return { content: [{ type: 'text', text: res.entry }] }
            }
            default:
              return { content: [{ type: 'text', text: `unknown action ${action}` }] }
          }
        } catch (e: any) {
          return { content: [{ type: 'text', text: `error: ${e?.message ?? String(e)}` }] }
        }
      },
    })
    const dispose = ctx.tools.register(tool)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: tool')

  // Gated memory_suggest tool — model proposals go to queue, never directly to memory
  ctx.effect(() => {
    const tool = defineTool({
      name: 'memory_suggest',
      description: 'Propose memory/todo for confirmation queue (gated, requires user approve). Targets: memory/user/key/todo-*',
      isConcurrencySafe: () => false,
      parameters: {
        target: { type: 'string', required: true, enum: ['memory', 'user', 'key', 'todo-life', 'todo-work', 'todo-project', 'todo-daily'] },
        content: { type: 'string', required: true },
        reason: { type: 'string', required: true },
      },
      output: CONTENT_OUTPUT,
      execute: async (args: any, exec: any) => {
        if (exec?.signal?.aborted) throw new Error('memory_suggest aborted')
        const target = String(args.target ?? '').trim()
        const content = String(args.content ?? '').trim()
        const reason = String(args.reason ?? '').trim()
        const valid = ['memory', 'user', 'key', 'todo-life', 'todo-work', 'todo-project', 'todo-daily']
        if (!valid.includes(target)) return { content: [{ type: 'text', text: `invalid target ${target}` }] }
        if (!content) return { content: [{ type: 'text', text: 'empty content' }] }
        if (!reason) return { content: [{ type: 'text', text: 'empty reason' }] }
        const agent = exec?.agent
        const res = enqueueSuggestion(queue, target, content, reason, agent)
        if (!res.ok) return { content: [{ type: 'text', text: res.message ?? 'failed' }] }
        const msg = (res as any).hits ? `queued (deduped hits=${(res as any).hits})` : `queued (${res.queued})`
        return { content: [{ type: 'text', text: msg }] }
      },
    })
    const dispose = ctx.tools.register(tool)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: suggest-tool')

  // Durable todo store (four tracks, IDs, status/due/quadrant, smart view, historical daily
  // lookup). Named `maestro_todo`, not `dtodo`: the old name read as another "Todos" tool
  // next to the harness's own session task list (`todo_write`), and the description below
  // now has to carry the contrast because the two tools cannot see each other's text.
  ctx.effect(() => {
    const tool = defineTool({
      name: 'maestro_todo',
      isConcurrencySafe: (args: any) => String(args?.action ?? '') === 'list',
      description: 'Durable cross-session todo store — the human\'s own list, NOT this session\'s plan. Tracks life/work/project/daily with ids, status/due/quadrant, smart views (overdue/today/project/Q1-Q2, limit 8) and historical daily lookup. To plan the current work use the harness tool `todo_write` instead.',
      parameters: {
        action: { type: 'string', required: true, enum: ['add', 'list', 'done', 'update', 'remove'] },
        target: { type: 'string', enum: [...TODO_TARGETS] },
        content: { type: 'string' },
        id: { type: 'string' },
        due: { type: 'string' },
        quadrant: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'] },
        important: { type: 'boolean' },
        urgent: { type: 'boolean' },
        cat: { type: 'string' },
        status: { type: 'string', enum: [...TODO_STATUSES] },
        all: { type: 'boolean' },
        past: { type: 'boolean' },
        expired: { type: 'boolean' },
        cwd: { type: 'string' },
        date: { type: 'string' },
      },
      output: CONTENT_OUTPUT,
      execute: async (args: any, exec: any) => {
        if (exec?.signal?.aborted) throw new Error('maestro_todo aborted')
        const action = args.action as string
        const cwd: string | undefined = args.cwd ?? exec?.agent?.session?.header?.cwd
        const dateArg = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
        try {
          if (action === 'add') {
            const target = (args.target ?? (cwd ? 'project' : 'work')) as any
            if (!TODO_TARGETS.includes(target)) return { content: [{ type: 'text', text: `invalid target ${target}` }] }
            const due = typeof args.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.due) ? args.due : undefined
            const cat = typeof args.cat === 'string' && args.cat.trim() !== '' ? args.cat.trim() : undefined
            const quadrant = resolveQuadrant({ quadrant: args.quadrant, important: args.important, urgent: args.urgent })
            const res = todoStore.addTodo(target, String(args.content ?? ''), { quadrant, due, cat }, cwd)
            if (!res.ok) return { content: [{ type: 'text', text: res.message }] }
            return { content: [{ type: 'text', text: `${res.message} (id: ${res.id})` }] }
          }
          if (action === 'list') {
            const targets: any[] = args.target !== undefined ? [args.target] : [...TODO_TARGETS]
            const projectCwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? args.cwd.trim() : cwd
            const result = todoStore.listTodos(targets, {
              status: args.status,
              quadrant: args.quadrant,
              due: args.due,
              cat: args.cat,
              all: args.all === true,
              past: args.past === true,
              expired: args.expired === true,
              date: dateArg(args.date),
            }, projectCwd, dateArg(args.date))
            const text = todoStore.formatList(result, dateArg(args.date))
            return { content: [{ type: 'text', text }] }
          }
          if (action === 'done') {
            const id = String(args.id ?? '').trim()
            if (!id) return { content: [{ type: 'text', text: 'id required' }] }
            const res = todoStore.doneTodo(args.target, id, cwd, dateArg(args.date))
            return { content: [{ type: 'text', text: res.message }] }
          }
          if (action === 'remove') {
            const id = String(args.id ?? '').trim()
            if (!id) return { content: [{ type: 'text', text: 'id required' }] }
            const res = todoStore.removeTodo(args.target, id, cwd, dateArg(args.date))
            return { content: [{ type: 'text', text: res.message }] }
          }
          if (action === 'update') {
            const id = String(args.id ?? '').trim()
            if (!id) return { content: [{ type: 'text', text: 'id required' }] }
            const patch: any = {}
            if (args.status !== undefined) patch.status = args.status
            if (args.quadrant !== undefined) patch.quadrant = /^q[1-4]$/.test(args.quadrant) ? args.quadrant : undefined
            else if (args.important !== undefined || args.urgent !== undefined) {
              const q = resolveQuadrant({ important: args.important, urgent: args.urgent })
              if (q) patch.quadrant = q
            }
            if (args.due !== undefined) patch.due = /^\d{4}-\d{2}-\d{2}$/.test(args.due) ? args.due : null
            if (args.cat !== undefined) patch.cat = args.cat === '' ? null : args.cat
            if (args.content !== undefined) patch.content = String(args.content)
            const res = todoStore.updateTodo(args.target, id, patch, cwd, dateArg(args.date))
            return { content: [{ type: 'text', text: res.message }] }
          }
          return { content: [{ type: 'text', text: `unknown action ${action}` }] }
        } catch (e: any) {
          return { content: [{ type: 'text', text: `error: ${e?.message ?? String(e)}` }] }
        }
      },
    })
    const dispose = ctx.tools.register(tool)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: todo-tool')

  // RPC channel for Review queue — explicit user-click decisions
  ctx.effect(() => {
    const channel = '/dsh-maestro-memory'
    const rpcDate = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
    const legacyHandler = async (endpoint: string, payload: any) => {
      switch (endpoint) {
        case 'queue.list': {
          const entries = queue.read()
          return { ok: true, entries }
        }
        case 'queue.decide': {
          const action = payload?.action as 'approve' | 'reject' | 'archive'
          const indices: number[] = Array.isArray(payload?.indices) ? payload.indices.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 1) : []
          if (indices.length === 0) return { ok: false, error: 'indices required' }
          if (action === 'approve') {
            const editsRaw = payload?.edits as Record<string, string> | undefined
            const targetsRaw = payload?.targets as Record<string, string> | undefined
            const edits = editsRaw ? new Map(Object.entries(editsRaw).map(([k, v]) => [Number(k), String(v)])) : undefined
            const targets = targetsRaw ? new Map(Object.entries(targetsRaw).map(([k, v]) => [Number(k), String(v)])) : undefined
            let agent: any = payload?.cwd ? { session: { header: { cwd: String(payload.cwd) } } } : undefined
            if (!agent) {
              try {
                const snap: any = (ctx as any).sessions?.list?.getSnapshot?.() ?? (ctx as any).get?.('sessions')?.list?.getSnapshot?.()
                const cur = snap?.current as string | undefined
                const cwd = cur ? (snap?.byId?.[cur]?.cwd as string | undefined) : undefined
                if (cwd) agent = { session: { header: { cwd } } }
              } catch {}
            }
            const res = approveSuggestions(store, todoStore, queue, indices, agent, edits, targets)
            return { ok: true, ...res }
          }
          if (action === 'reject') {
            const res = rejectSuggestions(queue, indices)
            return { ok: true, ...res }
          }
          if (action === 'archive') {
            const res = queue.mutate((entries) => {
              const kept: typeof entries = []
              const lines: string[] = []
              entries.forEach((entry, idx) => {
                const number = idx + 1
                if (!indices.includes(number)) {
                  kept.push(entry)
                  return
                }
                try {
                  const stamp = new Date().toISOString().slice(0, 10)
                  const originTag = entry.target.startsWith('todo-') ? `\n(original track: ${entry.target})` : ''
                  const stamped = `[${stamp}] ${entry.content}${originTag}${entry.reason ? `\n(archive reason: ${entry.reason})` : ''}`
                  let archiveFile: string | null = null
                  if (entry.target === 'memory') archiveFile = globalArchivePath(root)
                  else if (entry.target === 'user') archiveFile = userArchivePath(root)
                  else if (entry.target === 'key' && entry.cwd) archiveFile = projectKeyArchivePath(root, entry.cwd)
                  else if (entry.target.startsWith('todo-')) archiveFile = todoArchivePath(root)
                  // No archivable target (e.g. key without cwd): DO NOT silently drop the suggestion.
                  if (!archiveFile) {
                    lines.push(`✗ #${number} [${entry.target}] cannot archive (missing cwd or unsupported target)`)
                    kept.push(entry)
                    return
                  }
                  const appended = appendEntryAtomicSync(archiveFile, stamped)
                  if (!appended.ok) {
                    lines.push(`✗ #${number} [${entry.target}] archive failed: ${appended.error}`)
                    kept.push(entry)
                    return
                  }
                  lines.push(`#${number} [${entry.target}] archived`)
                } catch (e: any) {
                  lines.push(`✗ #${number} [${entry.target}] ${e?.message ?? String(e)}`)
                  kept.push(entry)
                }
              })
              entries.length = 0
              entries.push(...kept)
              return { lines, remaining: kept.length }
            })
            return { ok: true, ...res }
          }
          return { ok: false, error: `unknown action ${action}` }
        }
        case 'queue.propose': {
          try {
            const content = String(payload?.content ?? '').trim()
            const reason = String(payload?.reason ?? 'promote from Health longest').trim()
            if (!content) return { ok: false, error: 'empty content' }
            if (!reason) return { ok: false, error: 'empty reason' }
            const payloadCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
            const cwd: string | null = payloadCwd || null
            const agent: any = cwd ? { session: { header: { cwd } } } : undefined
            const res = enqueueSuggestion(queue, 'key', content, reason, agent)
            if (!res.ok) return { ok: false, error: (res as any).message ?? 'failed' }
            return res as any
          } catch (e: any) {
            return { ok: false, error: e?.message ?? String(e) }
          }
        }
        case 'memory.list': {
          const target = payload?.target as string
          const cwd = payload?.cwd as string | undefined
          const entries = store.list(target as any, cwd, { ...(payload?.opts ?? {}), date: payload?.date })
          return { ok: true, entries }
        }
        case 'memory.mutate': {
          const action = payload?.action as string
          const target = payload?.target as string
          const cwd = payload?.cwd as string | undefined
          const content = payload?.content as string | undefined
          const match = payload?.match as string | undefined
          const id = payload?.id as string | undefined
          const opts = payload?.opts ?? {}
          try {
            if (action === 'list') {
              return { ok: true, entries: store.list(target as any, cwd, { ...opts, date: payload?.date }) }
            }
            if (action === 'add') {
              return store.add(target as any, content ?? '', cwd, { branches: payload?.branches, summary: payload?.summary, date: payload?.date })
            }
            if (action === 'replace') {
              return store.replace(target as any, match ?? '', content ?? '', cwd, { date: payload?.date })
            }
            if (action === 'remove') {
              return store.remove(target as any, match ?? '', cwd, { date: payload?.date })
            }
            if (action === 'archive') {
              return store.archive(target as any, match ?? '', cwd)
            }
            if (action === 'expand') {
              return store.expand(target as any, id ?? '', cwd)
            }
            return { ok: false, error: `unknown memory action ${action}` }
          } catch (e: any) {
            return { ok: false, error: e?.message ?? String(e) }
          }
        }
        case 'todo.list': {
          const targets: any[] = payload?.targets ?? (payload?.target ? [payload.target] : [...TODO_TARGETS])
          const cwd = payload?.cwd as string | undefined
          const opts = payload?.opts ?? payload ?? {}
          const date = rpcDate(opts.date)
          const result = todoStore.listTodos(targets, {
            status: opts.status,
            quadrant: opts.quadrant,
            due: opts.due,
            cat: opts.cat,
            all: opts.all === true,
            past: opts.past === true,
            expired: opts.expired === true,
            date,
          }, cwd, date)
          return { ok: true, ...result, text: todoStore.formatList(result, date) }
        }
        case 'todo.mutate': {
          const action = payload?.action as string
          const target = payload?.target as any
          const cwd = payload?.cwd as string | undefined
          const date = rpcDate(payload?.date as string | undefined)
          if (action === 'add') {
            const due = typeof payload?.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.due) ? payload.due : undefined
            const quadrant = resolveQuadrant({ quadrant: payload?.quadrant, important: payload?.important, urgent: payload?.urgent })
            const res = todoStore.addTodo(target ?? (cwd ? 'project' : 'work'), String(payload?.content ?? ''), { quadrant, due, cat: payload?.cat }, cwd)
            return { ...res }
          }
          if (action === 'done') {
            const res = todoStore.doneTodo(target, String(payload?.id ?? ''), cwd, date)
            return { ...res }
          }
          if (action === 'remove') {
            const res = todoStore.removeTodo(target, String(payload?.id ?? ''), cwd, date)
            return { ...res }
          }
          if (action === 'update') {
            const patch: any = {}
            if (payload?.status !== undefined) patch.status = payload.status
            if (payload?.quadrant !== undefined) patch.quadrant = payload.quadrant
            if (payload?.due !== undefined) patch.due = payload.due
            if (payload?.cat !== undefined) patch.cat = payload.cat
            if (payload?.content !== undefined) patch.content = payload.content
            const res = todoStore.updateTodo(target, String(payload?.id ?? ''), patch, cwd, date)
            return { ...res }
          }
          return { ok: false, error: `unknown todo action ${action}` }
        }
        case 'status': {
          return { ok: true, queue: queue.read().length, blocked: migration.isWriteBlocked(root) }
        }
        case 'memory.repair': {
          // Preview-first: cleaning a store file is a write, so `dryRun` is the
          // default and an actual repair needs an explicit confirm.
          const dryRun = payload?.dryRun !== false
          if (!dryRun && payload?.confirm !== true) {
            return { ok: false, error: 'confirm:true required to write repairs' }
          }
          const report = repairAllTracks(root, { dryRun })
          return { ok: true, dryRun, report }
        }
        case 'migration.inspect': {
          const insp = await migration.inspect(root)
          return { ...insp }
        }
        case 'migration.dryRun': {
          const res = await migration.dryRun(root)
          return { ...res }
        }
        case 'migration.run': {
          // RPC run requires explicit apply flag in payload to enforce CLI's --apply semantics
          if (payload?.apply !== true) {
            return { ok: false, error: 'migration requires explicit apply=true (read-only by default)' }
          }
          const res = await migration.run(root)
          return { ...res }
        }
        case 'migration.verify': {
          const res = await migration.verify(root, payload?.runId)
          return { ...res }
        }
        case 'sync.enable': {
          const cwd = String(payload?.cwd ?? '').trim()
          const remoteUrl = String(payload?.remoteUrl ?? payload?.remote ?? '').trim()
          const branch = payload?.branch ? String(payload.branch).trim() : undefined
          if (!cwd) return { ok: false, error: 'cwd required' }
          if (!remoteUrl) return { ok: false, error: 'remoteUrl required' }
          const res = syncService.enable(cwd, remoteUrl, branch)
          return { ...res }
        }
        case 'sync.disable': {
          const cwd = String(payload?.cwd ?? '').trim()
          if (!cwd) return { ok: false, error: 'cwd required' }
          const res = syncService.disable(cwd)
          return { ...res }
        }
        case 'sync.status': {
          const cwd = String(payload?.cwd ?? '').trim()
          if (!cwd) return { ok: false, error: 'cwd required' }
          const reveal = payload?.reveal === true
          // explicit fetch on status when requested
          if (payload?.fetch === true) {
            const fetchRes = await syncService.fetch(cwd)
            if (!fetchRes.ok) return { ok: false, error: fetchRes.error }
            const st = syncService.status(cwd, reveal)
            return { ok: true, ...st, fetched: true, conflicts: fetchRes.conflicts }
          }
          const st = syncService.status(cwd, reveal)
          return { ok: true, ...st }
        }
        case 'sync.fetch': {
          const cwd = String(payload?.cwd ?? '').trim()
          if (!cwd) return { ok: false, error: 'cwd required' }
          const res = await syncService.fetch(cwd)
          return { ...res }
        }
        case 'sync.push': {
          const cwd = String(payload?.cwd ?? '').trim()
          if (!cwd) return { ok: false, error: 'cwd required' }
          const res = await syncService.push(cwd, payload?.message ? String(payload.message) : undefined)
          return { ...res }
        }
        case 'sync.pull': {
          const cwd = String(payload?.cwd ?? '').trim()
          if (!cwd) return { ok: false, error: 'cwd required' }
          const res = await syncService.pull(cwd)
          return { ...res }
        }
        case 'sync.resolve': {
          const cwd = String(payload?.cwd ?? '').trim()
          const id = String(payload?.id ?? '').trim()
          const choice = String(payload?.choice ?? '').trim() as any
          if (!cwd) return { ok: false, error: 'cwd required' }
          if (!id) return { ok: false, error: 'id required' }
          const res = syncService.resolve(cwd, id, choice)
          return { ...res }
        }
        case 'sync.listConflicts': {
          const cwd = String(payload?.cwd ?? '').trim()
          if (!cwd) return { ok: false, error: 'cwd required' }
          const conflicts = syncService.listConflicts(cwd)
          return { ok: true, conflicts }
        }
        case 'skills.list': {
          // M6 read-first: list metadata/origin only, no mutation, no body content.
          // Constrained to the resolved default maestro-skills checkout — the RPC
          // must NOT honor an arbitrary client-supplied dir/roots (that would let a
          // payload read any directory). The client sends {} and relies on the default.
          try {
            const def = resolveDefaultMaestroSkillsDir()
            if (def) {
              const entries = listSkillsSync(def, 'maestro-skills')
              return { ok: true, entries }
            }
            return { ok: true, entries: [] }
          } catch (e: any) {
            return { ok: false, error: e?.message ?? String(e) }
          }
        }
        default:
          return { ok: false, error: `unknown endpoint ${endpoint}` }
      }
    }
    const handler = async (endpoint: string, payload: unknown, _signal: AbortSignal) => ({
      ok: true as const,
      value: await legacyHandler(endpoint, payload),
    })
    // ctx.connection may be undefined in tests; guard
    const conn = (ctx as any).connection ?? (ctx.get && ctx.get('connection'))
    if (!conn?.rpc?.handle) return () => {}
    const dispose = conn.rpc.handle(channel, handler, { authority: 'loopback' })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'maestro-memory: rpc')

  // Health dashboard handler (Task6) — loopback only, returns coverage + daily counts
  ctx.effect(() => {
    const conn2 = (ctx as any).connection ?? (ctx.get && ctx.get('connection'))
    if (!conn2?.rpc?.handle) return () => {}
    const healthChannel = '/dsh-maestro-memory-health'
    const healthHandler = async (endpoint: string, payload: any) => {
      try {
        // Cost is a property of the renderer, not of any one project, so it is
        // reported on both paths — including when cwd is missing.
        const cost = costTracker.snapshot()
        const cwdRaw = (payload && typeof payload.cwd === 'string' && payload.cwd.trim()) ? payload.cwd.trim() : ''
        // Health requires explicit cwd; if missing, return empty (client should pass sessionCwd)
        if (!cwdRaw) {
          return { ok: true, value: { project: { total: 0, withSummary: 0, coverage: 100 }, daily: { counts: [0,0,0,0,0,0,0] }, longest: [], cost } }
        }
        const cwd = cwdRaw
        const projectEntries = store.list('project', cwd)
        const total = projectEntries.length
        const withSummary = projectEntries.filter((e: string) => /\[summary:/.test(e)).length
        const coverage = total ? (withSummary / total) * 100 : 100
        // daily last 7 days
        const dailyCounts: number[] = []
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const ds = d.toISOString().slice(0, 10)
          try {
            const list = store.list('daily', undefined, { date: ds } as any)
            dailyCounts.push(Array.isArray(list) ? list.length : 0)
          } catch { dailyCounts.push(0) }
        }
        const longest = [...projectEntries].sort((a, b) => b.length - a.length).slice(0, 5).map((e) => ({ len: e.length, preview: e.slice(0, 80).replace(/\n/g, ' ') }))
        const fiveDim = computeFiveDim({
          projectTotal: total,
          withSummary,
          dailyCounts,
          longestLen: longest[0]?.len ?? 0,
          hasAutoRecall: true,
          hasSanitize: true,
          hasGatedQueue: true,
        })
        const health = { project: { total, withSummary, coverage }, daily: { counts: dailyCounts }, longest, fiveDim, cost }
        return { ok: true, value: health }
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) }
      }
    }
    const h = async (ep: string, pl: unknown, _s: AbortSignal) => {
      const res: any = await healthHandler(ep, pl)
      if (res.ok) return { ok: true as const, value: res.value }
      return { ok: false as const, error: { message: res.error } }
    }
    const dispose2 = conn2.rpc.handle(healthChannel, h, { authority: 'loopback' })
    return () => { if (typeof dispose2 === 'function') dispose2() }
  }, 'maestro-memory: health')

  // Propose handler for Health → queue (Task4) — loopback only
  ctx.effect(() => {
    const conn3 = (ctx as any).connection ?? (ctx.get && ctx.get('connection'))
    if (!conn3?.rpc?.handle) return () => {}
    const proposeHandler = async (endpoint: string, payload: any) => {
      try {
        const content = String(payload?.content ?? '').trim()
        const reason = String(payload?.reason ?? 'promote from Health longest').trim()
        if (!content) return { ok: false, error: 'empty content' }
        if (!reason) return { ok: false, error: 'empty reason' }
        const payloadCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
        let sessionCwd: string | null = null
        try {
          const snap: any = (ctx as any).sessions?.list?.getSnapshot?.() ?? (ctx as any).get?.('sessions')?.list?.getSnapshot?.()
          const cur = snap?.current as string | undefined
          sessionCwd = cur ? (snap?.byId?.[cur]?.cwd as string | undefined) ?? null : null
        } catch {}
        const cwd = payloadCwd || sessionCwd || null
        const agent: any = cwd ? { session: { header: { cwd } } } : undefined
        const res = enqueueSuggestion(queue, 'key', content, reason, agent)
        if (!res.ok) return { ok: false, error: (res as any).message ?? 'failed' }
        return { ok: true, value: res }
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) }
      }
    }
    const wrapped = async (ep: string, pl: unknown, _s: AbortSignal) => {
      const r: any = await proposeHandler(ep, pl)
      if (r.ok) return { ok: true as const, value: r.value }
      return { ok: false as const, error: { message: r.error } }
    }
    const d3 = conn3.rpc.handle('/dsh-maestro-memory-propose', wrapped, { authority: 'loopback' })
    return () => { if (typeof d3 === 'function') d3() }
  }, 'maestro-memory: propose')
}
