/**
 * cost-tracker.ts — a bounded in-memory window of snapshot renders.
 *
 * Deliberately not durable: this answers "what is memory costing right now", and
 * a host restart should start a fresh window — the same reasoning as the write
 * watchdog's in-memory gap counter. It stores byte counts only, never entry
 * text, so it can never become a second copy of the store.
 *
 * Measured baseline before this existed (1,434 session logs): 25.9 MB of memory
 * text injected across 1,300 sessions, median 12.6 KB per render, largest single
 * session 1.76 MB. Nothing in the plugin reported any of it.
 *
 * @module cost-tracker
 */
import type { SnapshotStats } from './prompt/snapshot.ts'

export interface CostSummary {
  samples: number
  last: SnapshotStats | null
  medianTotalBytes: number
  maxTotalBytes: number
  /** Median bytes per section key across the window. */
  medianBySection: Record<string, number>
}

export interface CostTracker {
  record(stats: SnapshotStats): void
  snapshot(): CostSummary
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/** Create a tracker holding at most `maxSamples` renders. */
export function createCostTracker(maxSamples = 50): CostTracker {
  const window: SnapshotStats[] = []
  return {
    record(stats: SnapshotStats): void {
      window.push(stats)
      if (window.length > maxSamples) window.shift()
    },
    snapshot(): CostSummary {
      if (window.length === 0) {
        return { samples: 0, last: null, medianTotalBytes: 0, maxTotalBytes: 0, medianBySection: {} }
      }
      const bySection: Record<string, number[]> = {}
      for (const s of window) for (const sec of s.sections) (bySection[sec.key] ??= []).push(sec.bytes)
      const medianBySection: Record<string, number> = {}
      for (const [k, v] of Object.entries(bySection)) medianBySection[k] = median(v)
      return {
        samples: window.length,
        last: window[window.length - 1],
        medianTotalBytes: median(window.map((s) => s.totalBytes)),
        maxTotalBytes: Math.max(...window.map((s) => s.totalBytes)),
        medianBySection,
      }
    },
  }
}
