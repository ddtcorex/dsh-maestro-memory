import { describe, it, expect } from 'vitest'
import { coverageSummary, seriesText, shortPath } from '../src/client/format'

// Unit tests for the rules the Memory view renders straight from the store.
// Two 2026-10-28 audit findings were formatting bugs, not layout bugs:
//   F3  Health painted a hardcoded "1.5 avg / session" next to real zeroes, and
//       the host reports coverage 100 for an empty project, which rendered as a
//       green "100.0% PASS" beside "0 entries".
//   F16 Skills printed the full absolute skill path in a 12px line.
describe('coverageSummary', () => {
  it('reports an empty project as unknown, never as a pass', () => {
    expect(coverageSummary(0, 0)).toEqual({ value: 'n/a', state: 'unknown', caption: 'no entries yet' })
  })

  it('passes at the documented 90% floor', () => {
    const summary = coverageSummary(10, 9)
    expect(summary.value).toBe('90.0%')
    expect(summary.state).toBe('pass')
    expect(summary.caption).toBe('PASS')
  })

  it('fails below the floor and says why', () => {
    const summary = coverageSummary(10, 8)
    expect(summary.value).toBe('80.0%')
    expect(summary.state).toBe('fail')
    expect(summary.caption).toBe('FAIL (<90%)')
  })

  it('treats a non-finite count as unknown', () => {
    expect(coverageSummary(Number.NaN, 3).state).toBe('unknown')
  })
})

describe('seriesText', () => {
  it('renders a daily series as a separated row', () => {
    expect(seriesText([0, 1, 2])).toBe('0 · 1 · 2')
  })

  it('says n/a instead of rendering an empty string', () => {
    expect(seriesText([])).toBe('n/a')
    expect(seriesText(undefined)).toBe('n/a')
  })
})

describe('shortPath', () => {
  it('keeps the last two segments of a long path', () => {
    expect(shortPath('/home/user/.dsh/skills/git-workflow/SKILL.md')).toBe('…/git-workflow/SKILL.md')
  })

  it('leaves a path that is already short alone', () => {
    expect(shortPath('skills/review')).toBe('skills/review')
    expect(shortPath('SKILL.md')).toBe('SKILL.md')
  })

  it('survives an empty or undefined path', () => {
    expect(shortPath('')).toBe('')
    expect(shortPath(undefined as unknown as string)).toBe('')
  })
})
