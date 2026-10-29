/**
 * Pure formatting helpers for the Memory view.
 *
 * Kept out of index.tsx so the rules can be unit-tested without React: the
 * panel renders values straight from the store and two of the 2026-10-28 audit
 * findings were about formatting, not layout (a fabricated metric and a full
 * filesystem path in the skills list).
 */

/** Collapse a long filesystem path to its last `keep` segments. */
export function shortPath(path: string, keep = 2): string {
  const raw = String(path ?? '')
  const parts = raw.split('/').filter(Boolean)
  if (parts.length === 0) return raw
  if (parts.length <= keep) return parts.join('/')
  return `…/${parts.slice(-keep).join('/')}`
}

export type CoverageState = 'pass' | 'fail' | 'unknown'

export interface CoverageSummary {
  /** Rendered value: a percentage, or `n/a` when there is no ratio to report. */
  value: string
  state: CoverageState
  /** Short caption under the value. */
  caption: string
}

/**
 * Coverage of the durable memory of a project.
 *
 * An empty project has no ratio: the host reports `coverage: 100` for
 * `total === 0` (src/host/index.ts), which the panel used to paint as a green
 * "100.0% PASS" next to "0 entries". The ratio is undefined there, so it is
 * reported as unknown instead of passed.
 */
export function coverageSummary(total: number, withSummary: number): CoverageSummary {
  if (!Number.isFinite(total) || total <= 0) {
    return { value: 'n/a', state: 'unknown', caption: 'no entries yet' }
  }
  const pct = (Number(withSummary) / total) * 100
  const state: CoverageState = pct >= 90 ? 'pass' : 'fail'
  return {
    value: `${pct.toFixed(1)}%`,
    state,
    caption: state === 'pass' ? 'PASS' : 'FAIL (<90%)',
  }
}

/** Counts rendered as a `·`-separated row, tolerant of an empty series. */
export function seriesText(values: readonly number[] | undefined, separator = ' · '): string {
  if (!Array.isArray(values) || values.length === 0) return 'n/a'
  return values.map((v) => String(v)).join(separator)
}
