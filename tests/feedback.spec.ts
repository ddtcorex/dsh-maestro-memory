import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { buildFeedbackLine } from '../src/host/memory/feedback.ts'
import { applyBatch } from '../src/host/memory/batch.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/demo-project'

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'fb-')); store = new MaestroMemoryStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('buildFeedbackLine', () => {
  it('formats all provided fields as a single [Feedback] line', () => {
    const line = buildFeedbackLine({ sentiment: 'positive', category: 'ui', quote: 'works well', note: 'keep it' })
    expect(line).toBe('[Feedback] sentiment=positive; category="ui"; quote="works well"; note="keep it"')
  })

  it('omits absent optional fields — sentiment alone is valid', () => {
    expect(buildFeedbackLine({ sentiment: 'negative' })).toBe('[Feedback] sentiment=negative')
    expect(buildFeedbackLine({ sentiment: 'neutral', note: 'meh' })).toBe('[Feedback] sentiment=neutral; note="meh"')
  })

  it('rejects unknown sentiments instead of writing them', () => {
    expect(() => buildFeedbackLine({ sentiment: 'meh' as any })).toThrow(/unknown feedback sentiment/i)
    expect(() => buildFeedbackLine({} as any)).toThrow(/sentiment is required/i)
  })

  it('escapes double quotes inside values', () => {
    const line = buildFeedbackLine({ sentiment: 'negative', quote: 'said "no"' })
    expect(line).toBe('[Feedback] sentiment=negative; quote="said \\"no\\""')
  })
})

describe('feedback wiring through adds', () => {
  it('batch entry carrying sentiment gets the line appended to stored content', () => {
    const res = applyBatch(store, [
      { target: 'project', content: '[2026-08-26] shipped caps', cwd, sentiment: 'positive', category: 'prompt-size' },
    ])
    expect(res).toMatchObject({ ok: true })
    const stored = store.list('project', cwd)[0]
    expect(stored).toContain('[2026-08-26] shipped caps')
    expect(stored).toContain('[Feedback] sentiment=positive; category="prompt-size"')
  })

  it('batch entry without sentiment stores content verbatim', () => {
    applyBatch(store, [{ target: 'daily', content: '[10:00] plain log' }])
    expect(store.list('daily')[0]).not.toContain('[Feedback]')
  })

  it('invalid sentiment inside a batch fails atomically at that index', () => {
    const res = applyBatch(store, [
      { target: 'memory', content: '[2026-08-26] good one' },
      { target: 'daily', content: '[10:00] bad', sentiment: 'meh' as any },
    ])
    expect(res).toMatchObject({ ok: false, index: 1 })
    if (!res.ok) expect(res.error).toMatch(/unknown feedback sentiment/i)
    expect(store.list('memory')).toEqual([]) // rolled back
  })
})
