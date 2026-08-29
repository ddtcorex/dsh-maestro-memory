import { describe, it, expect } from 'vitest'
import { computeFiveDim } from '../src/host/health-score.ts'

describe('health 5-dim scoring', () => {
  it('composite = min*0.4+mean*0.6', () => {
    const r = computeFiveDim({ projectTotal: 10, withSummary: 10, dailyCounts: [1,2,0,1,0,0,1], longestLen: 120, hasAutoRecall: true, hasSanitize: true, hasGatedQueue: true })
    const vals = [r.S, r.R, r.J, r.C, r.Safety]
    const min = Math.min(...vals)
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length
    const expected = Math.round((min*0.4+mean*0.6)*10)/10
    expect(r.composite).toBe(expected)
  })
  it('values in 0-10', () => {
    const r = computeFiveDim({ projectTotal: 0, withSummary: 0, dailyCounts: [0,0,0,0,0,0,0], longestLen: 0, hasAutoRecall: false, hasSanitize: false, hasGatedQueue: false })
    for (const k of ['S','R','J','C','Safety'] as const) expect(r[k]).toBeGreaterThanOrEqual(0), expect(r[k]).toBeLessThanOrEqual(10)
  })
  it('higher coverage improves scores', () => {
    const low = computeFiveDim({ projectTotal: 10, withSummary: 2, dailyCounts: [0,0,0,0,0,0,0], longestLen: 10, hasAutoRecall: true, hasSanitize: true, hasGatedQueue: true })
    const high = computeFiveDim({ projectTotal: 10, withSummary: 10, dailyCounts: [0,0,0,0,0,0,0], longestLen: 10, hasAutoRecall: true, hasSanitize: true, hasGatedQueue: true })
    expect(high.composite).toBeGreaterThan(low.composite)
  })
})
