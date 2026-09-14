import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshot } from '../src/host/prompt/snapshot.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/demo-project'

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'snap-')); store = new MaestroMemoryStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('renderSnapshot contract', () => {
  it('includes session header when sessionId/name provided', () => {
    store.add('memory', '[2026-08-10] global entry')
    const text = renderSnapshot(store, { cwd, sessionId: 'abc123', sessionName: 'my-session' })
    expect(text).toContain('abc123')
    expect(text).toContain('my-session')
  })

  it('includes end-of-turn discipline note (daily+project + maestro_todo)', () => {
    const text = renderSnapshot(store, { cwd: '/tmp/x', sessionId: 's1' })
    expect(text).toMatch(/End of every turn/i)
    expect(text).toMatch(/daily.*project/i)
    expect(text).toMatch(/maestro_todo list/i)
  })

  it('bounded: includes USER+MEMORY+KEY, project via auto-recall (top-4), recent daily (512B) may include daily', () => {
    store.add('memory', '[2026-08-10] global')
    store.add('user', '[2026-08-10] user')
    store.add('key', '[2026-08-10] key entry', cwd)
    store.add('daily', '[08:30] daily log')
    store.add('project', '[2026-08-10 10:00] project log', cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('global')
    expect(text).toContain('user')
    expect(text).toContain('key entry')
    // project injected only via bounded auto-recall (top-4, 600 chars each under Project Context)
    expect(text).toContain('Project Context')
    expect(text).toContain('project log')
    // recent daily: if today's daily exists, it appears under Recent Daily
    expect(text).toContain('Recent Daily')
    expect(text).toContain('daily log')
  })

  it('branch-filtered: only matching key entries appear', () => {
    store.add('key', '[2026-08-10] all branches', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    const mainSnap = renderSnapshot(store, { cwd, branch: 'main' })
    expect(mainSnap).toContain('main only')
    const devSnap = renderSnapshot(store, { cwd, branch: 'dev' })
    expect(devSnap).not.toContain('main only')
    expect(devSnap).toContain('all branches')
  })

  it('handles null cwd gracefully — no key section, no crash', () => {
    store.add('memory', '[2026-08-10] global')
    const text = renderSnapshot(store, { cwd: null })
    expect(text).toContain('global')
    expect(text).not.toContain('Project Key')
  })

  it('empty store still emits discipline note (never empty prompt)', () => {
    const text = renderSnapshot(store, { cwd: null })
    expect(text).toMatch(/End of every turn/i)
  })

  it('does not duplicate discipline note on repeated calls', () => {
    const a = renderSnapshot(store, { cwd })
    const b = renderSnapshot(store, { cwd })
    expect((a.match(/End of every turn/g) || []).length).toBe(1)
    expect((b.match(/End of every turn/g) || []).length).toBe(1)
  })

  it('branch undefined does not filter out any key entries', () => {
    store.add('key', '[2026-08-10] all', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    const text = renderSnapshot(store, { cwd }) // no branch
    expect(text).toContain('all')
    expect(text).toContain('main only') // no filter => all visible
  })

  it('integration: systemPrompt context text delegates to renderSnapshot', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
    expect(src).toContain('renderSnapshot')
    expect(src).toContain("name: 'memory:snapshot'")
    expect(src).toContain('order')
  })
})

describe('renderSnapshot per-track byte caps', () => {
  it('drops oldest memory entries first until under cap, always keeping the newest', () => {
    store.add('memory', '[2026-08-10] mem-oldest-AAA')
    store.add('memory', '[2026-08-10] mem-mid-BBB')
    store.add('memory', '[2026-08-10] mem-newest-CCC')
    const text = renderSnapshot(store, { cwd }, { caps: { memory: 40 } })
    expect(text).toContain('mem-newest-CCC')
    expect(text).not.toContain('mem-mid-BBB')
    expect(text).not.toContain('mem-oldest-AAA')
  })

  it('caps each section independently — other sections unaffected', () => {
    store.add('user', '[2026-08-10] usr-old-111')
    store.add('user', '[2026-08-10] usr-new-222')
    store.add('key', '[2026-08-10] key-old-333', cwd)
    store.add('key', '[2026-08-10] key-new-444', cwd)
    const text = renderSnapshot(store, { cwd }, { caps: { user: 40 } })
    expect(text).toContain('usr-new-222')
    expect(text).not.toContain('usr-old-111')
    expect(text).toContain('key-old-333') // default key cap leaves both
    expect(text).toContain('key-new-444')
  })

  it('always keeps the newest entry even when it alone exceeds the cap', () => {
    store.add('memory', '[2026-08-10] huge-single-DDD ' + 'x'.repeat(400))
    // Cap 300: the entry (≈415 B) still exceeds it alone and is kept — now as
    // its compacted head+summary rather than whole, which is why the body text
    // is no longer rendered. The dedicated ceiling case (an UNTAGGED entry more
    // than twice its cap) is pinned in tests/snapshot-caps.spec.ts.
    const text = renderSnapshot(store, { cwd }, { caps: { memory: 300 } })
    expect(text).toContain('huge-single-DDD')
    expect(text).not.toContain('x'.repeat(200))
  })

  it('oversize newest entry carrying [summary:] renders as its compact head only', () => {
    store.add('key', '[2026-08-10] [summary:key-short-summary] ' + 'z'.repeat(600), cwd)
    const text = renderSnapshot(store, { cwd }, { caps: { key: 80 } })
    expect(text).toContain('[summary:key-short-summary]')
    expect(text).not.toContain('zzzzzzzzzz')
  })

  it('caps override is partial — unspecified sections keep defaults', () => {
    store.add('user', '[2026-08-10] usr-default-555')
    store.add('user', '[2026-08-10] usr-default-666')
    store.add('memory', '[2026-08-10] mem-old-777')
    store.add('memory', '[2026-08-10] mem-new-888')
    const text = renderSnapshot(store, { cwd }, { caps: { memory: 40 } })
    expect(text).toContain('usr-default-555') // default user cap (4096) keeps both
    expect(text).toContain('usr-default-666')
    expect(text).not.toContain('mem-old-777')
    expect(text).toContain('mem-new-888')
  })

  it('auto-recall: newest 4 project entries appear (oldest dropped)', () => {
    for (let i = 1; i <= 5; i++) store.add('project', `[2026-08-10] proj-${i} short`, cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('Project Context')
    expect(text).not.toContain('proj-1') // oldest dropped (top-4)
    expect(text).toContain('proj-2')
    expect(text).toContain('proj-5')
  })
  it('auto-recall: each entry truncated to 600 chars', () => {
    store.add('project', `[2026-08-10] long-entry ` + 'x'.repeat(700), cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('Project Context')
    expect(text).not.toContain('x'.repeat(601))
  })
})

describe('renderSnapshot prompt-template safety', () => {
  // DSH interpolates every prompt context before it reaches the model
  // (@deepseek-ai/dsh-system-prompt interpolate()) and fails the whole turn on a
  // {{name}} group whose name is malformed or unregistered. Memory entries are
  // free-form prose that may quote a template language, so the rendered snapshot
  // must never contain a literal {{ at all — that is the exact trigger.
  it('collapses double-brace runs across every injected section', () => {
    store.add('memory', '[2026-09-11] global {{global_var}}')
    store.add('user', '[2026-09-11] user {{user_var}}')
    store.add('key', '[2026-09-11] key {{...}} literal', cwd)
    store.add('project', '[2026-09-11] project {{cwd}}', cwd)
    store.add('daily', '[09:00] daily {{release_path}}')
    const text = renderSnapshot(store, { cwd })
    expect(text).not.toContain('{{')
    expect(text).toContain('{...}') // readable single-brace form survives
    expect(text).toContain('{global_var}')
  })

  it('collapses nested brace runs without leaving an adjacent pair', () => {
    store.add('key', '[2026-09-11] {{{triple}}} plus {{a}} {{b}}', cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).not.toContain('{{')
    expect(text).toContain('{triple}')
    expect(text).toContain('{a} {b}')
  })
})

describe('renderSnapshot recent-daily ordering', () => {
  /** Yesterday in the store's local-calendar stamp, written straight to its dated file. */
  function yesterdayStamp(): string {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  it('keeps today when the byte cap fits only one day', () => {
    store.add('daily', '[09:00] yesterday-entry-YYY', undefined, { date: yesterdayStamp() })
    store.add('daily', '[10:00] today-entry-XXX')
    const text = renderSnapshot(store, { cwd: null }, { caps: { recentDaily: 40 } })
    expect(text).toContain('today-entry-XXX')
    expect(text).not.toContain('yesterday-entry-YYY')
  })

  it('lists the two days oldest first when both fit', () => {
    store.add('daily', '[09:00] yesterday-entry-YYY', undefined, { date: yesterdayStamp() })
    store.add('daily', '[10:00] today-entry-XXX')
    const text = renderSnapshot(store, { cwd: null })
    const yesterdayAt = text.indexOf('yesterday-entry-YYY')
    const todayAt = text.indexOf('today-entry-XXX')
    expect(yesterdayAt).toBeGreaterThan(-1)
    expect(todayAt).toBeGreaterThan(yesterdayAt)
  })
})

describe('renderSnapshot write-guard escalation', () => {
  const WARNING = /Memory Write Backlog/i
  const DUTY = /End of every turn/i

  it('omits the backlog warning when the guard is not due', () => {
    store.add('memory', '[2026-09-12] global entry')
    expect(renderSnapshot(store, { cwd })).not.toMatch(WARNING)
  })

  it('omits the warning when no writeGuard option is passed at all', () => {
    store.add('memory', '[2026-09-12] global entry')
    expect(renderSnapshot(store, { cwd }, {})).not.toMatch(WARNING)
  })

  it('injects the backlog warning once the guard is due', () => {
    store.add('memory', '[2026-09-12] global entry')
    expect(renderSnapshot(store, { cwd }, { writeGuard: { threshold: 2 } })).toMatch(WARNING)
  })

  it('renders the warning before the discipline note and keeps that note last, exactly once', () => {
    store.add('memory', '[2026-09-12] global entry')
    const text = renderSnapshot(store, { cwd }, { writeGuard: { threshold: 2 } })
    const warnAt = text.search(WARNING)
    const dutyAt = text.search(DUTY)
    expect(warnAt).toBeGreaterThan(-1)
    expect(dutyAt).toBeGreaterThan(warnAt)
    // The end-of-turn note is the snapshot's final instruction — the warning
    // must not displace it, and repeated rendering must not duplicate it.
    expect(text.indexOf('End of every turn')).toBe(text.lastIndexOf('End of every turn'))
    expect(text.trimEnd().endsWith('bounded, max 8).')).toBe(true)
  })

  it('names the guarded tracks and the configured threshold, with no live count', () => {
    store.add('memory', '[2026-09-12] global entry')
    const text = renderSnapshot(store, { cwd }, { writeGuard: { threshold: 3 } })
    expect(text).toContain('daily/project')
    expect(text).toMatch(/\b3\b/)
    // Static text is the cache contract: an open gap costs two tail snapshots
    // (appear, then disappear), so identical inputs must render identical bytes.
    expect(renderSnapshot(store, { cwd }, { writeGuard: { threshold: 3 } })).toBe(text)
  })

  it('never leaks a template brace through the warning', () => {
    store.add('memory', '[2026-09-12] global entry')
    const text = renderSnapshot(store, { cwd }, { writeGuard: { threshold: 2 } })
    expect(text).not.toContain('{{')
  })

  it('still renders the discipline note alone when the store is empty and the guard is due', () => {
    const text = renderSnapshot(store, { cwd: null }, { writeGuard: { threshold: 2 } })
    expect(text).toMatch(WARNING)
    expect(text.indexOf('End of every turn')).toBe(text.lastIndexOf('End of every turn'))
  })
})

describe('renderSnapshot subagent gating', () => {
  it('replaces the per-turn duty with the per-achievement cadence', () => {
    const text = renderSnapshot(store, { cwd, isSubagent: true })
    expect(text).toMatch(/independent achievement/i)
    expect(text).toMatch(/do not write for writing's sake/i)
    // The per-turn cadence belongs to human-facing sessions only.
    expect(text).not.toMatch(/End of every turn/i)
    expect(text).not.toMatch(/maestro_todo list/i)
  })

  it('leaves the human-facing discipline note untouched when not a subagent', () => {
    const text = renderSnapshot(store, { cwd, isSubagent: false })
    expect(text).toMatch(/End of every turn/i)
    expect(text).not.toMatch(/independent achievement/i)
  })

  it('defaults to the human-facing note when isSubagent is absent', () => {
    expect(renderSnapshot(store, { cwd })).toMatch(/End of every turn/i)
  })

  it('still injects the shared memory context for a subagent', () => {
    store.add('memory', '[2026-09-12] global-entry')
    store.add('user', '[2026-09-12] user-entry')
    store.add('key', '[2026-09-12] key-entry', cwd)
    store.add('project', '[2026-09-12] project-entry', cwd)
    const text = renderSnapshot(store, { cwd, isSubagent: true })
    expect(text).toContain('global-entry')
    expect(text).toContain('user-entry')
    expect(text).toContain('key-entry')
    expect(text).toContain('Project Context')
  })

  it('never renders the write backlog alert for a subagent, even when asked', () => {
    const text = renderSnapshot(store, { cwd, isSubagent: true }, { writeGuard: { threshold: 2 } })
    expect(text).not.toMatch(/Memory Write Backlog/i)
  })

  it('keeps the subagent note last, exactly once, and brace-free', () => {
    store.add('memory', '[2026-09-12] global entry with {brace}')
    const text = renderSnapshot(store, { cwd, isSubagent: true })
    expect(text).not.toContain('{{')
    expect((text.match(/Turn end \(subagent session\)/g) || []).length).toBe(1)
    expect(text.trimEnd().endsWith('The per-turn daily cadence applies to human-facing sessions only.')).toBe(true)
  })
})
