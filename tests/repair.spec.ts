import { describe, it, expect } from 'vitest'
import { planRepair } from '../src/host/storage/repair.ts'

const A = '[2026-08-24] alpha entry body'
const B = '[2026-09-01] beta entry body'
const C = '[2026-09-02] gamma entry body'

describe('planRepair — glued entries', () => {
  it('splits two entries glued without the § delimiter', () => {
    const plan = planRepair(`${A}\n${B}\n`)
    expect(plan.before).toBe(1)
    expect(plan.after).toBe(2)
    expect(plan.split).toBe(1)
    expect(plan.changed).toBe(true)
    expect(plan.entries).toEqual([A, B])
  })

  it('splits an id-prefixed entry head inside a blob', () => {
    const raw = `${A}\n[id:118f37fb] ${C}\n`
    const plan = planRepair(raw)
    expect(plan.after).toBe(2)
    expect(plan.entries[1]).toBe(`[id:118f37fb] ${C}`)
  })

  it('keeps a multi-line entry whose continuation merely mentions a date', () => {
    const raw = `${A}\nsee the note from [2026-01-01] for context\n`
    const plan = planRepair(raw)
    expect(plan.after).toBe(1)
    expect(plan.changed).toBe(false)
  })
})

describe('planRepair — exact duplicates', () => {
  it('drops later copies and keeps the first occurrence', () => {
    const raw = `${A}\n§\n${B}\n§\n${A}\n`
    const plan = planRepair(raw)
    expect(plan.deduped).toBe(1)
    expect(plan.entries).toEqual([A, B])
    expect(plan.after).toBe(2)
  })

  it('treats id-only and summary-only differences as the same entry', () => {
    const raw = `${A}\n§\n${A} [summary:alpha entry body]\n`
    const plan = planRepair(raw)
    expect(plan.deduped).toBe(1)
    expect(plan.entries).toEqual([A])
  })

  it('never merges entries with different bodies', () => {
    const raw = `${A}\n§\n${B}\n`
    const plan = planRepair(raw)
    expect(plan.deduped).toBe(0)
    expect(plan.changed).toBe(false)
  })
})

describe('planRepair — trailing summary relocation (F10)', () => {
  it('moves a trailing [summary:…] to the header position the compactor reads', () => {
    const plan = planRepair('[2026-08-24] alpha body [summary:alpha body]\n')
    expect(plan.relocated).toBe(1)
    expect(plan.entries[0]).toBe('[2026-08-24] [summary:alpha body] alpha body')
  })

  it('leaves a canonical header-position summary untouched', () => {
    const raw = '[2026-08-24] [summary:already canonical] alpha body\n'
    const plan = planRepair(raw)
    expect(plan.relocated).toBe(0)
    expect(plan.changed).toBe(false)
  })

  it('is a no-op for an entry with no summary tag', () => {
    expect(planRepair(`${A}\n`).relocated).toBe(0)
  })

  it('is idempotent', () => {
    const once = planRepair('[2026-08-24] alpha body [summary:alpha body]\n')
    expect(planRepair(once.text).relocated).toBe(0)
    expect(planRepair(once.text).text).toBe(once.text)
  })
})

describe('planRepair — stray § delimiter (F12)', () => {
  it('splits on a § glued to content instead of the canonical \\n§\\n', () => {
    const plan = planRepair('[2026-08-24] alpha body§ [2026-09-01] beta body\n')
    expect(plan.before).toBe(1)
    expect(plan.after).toBe(2)
    expect(plan.entries).toEqual(['[2026-08-24] alpha body', '[2026-09-01] beta body'])
  })

  it('keeps prose that merely contains a § as one entry', () => {
    const plan = planRepair('[2026-08-24] the § section marker matters\n')
    expect(plan.after).toBe(1)
    expect(plan.changed).toBe(false)
  })

  it('repaired text never carries a § glued to content', () => {
    expect(planRepair('[2026-08-24] alpha body§ [2026-09-01] beta body\n').text).not.toMatch(/[^\n]§/)
  })
})

describe('planRepair — no-ops', () => {
  it('leaves empty and whitespace-only files alone', () => {
    for (const raw of ['', '   \n\n']) {
      const plan = planRepair(raw)
      expect(plan.changed).toBe(false)
      expect(plan.after).toBe(0)
      expect(plan.text).toBe('')
    }
  })

  it('leaves a clean file byte-identical', () => {
    const raw = `${A}\n§\n${B}\n`
    const plan = planRepair(raw)
    expect(plan.changed).toBe(false)
    expect(plan.text).toBe(raw)
  })
})
