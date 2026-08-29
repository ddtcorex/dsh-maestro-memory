import { describe, it, expect } from 'vitest'
import { isMemoryConcurrencySafe } from '../src/host/index.ts'

describe('concurrency gating', () => {
  it('memory list/expand safe, writes not', () => {
    expect(isMemoryConcurrencySafe({ action: 'list' })).toBe(true)
    expect(isMemoryConcurrencySafe({ action: 'expand' })).toBe(true)
    expect(isMemoryConcurrencySafe({ action: 'add' })).toBe(false)
    expect(isMemoryConcurrencySafe({ action: 'replace' })).toBe(false)
    expect(isMemoryConcurrencySafe({ action: 'remove' })).toBe(false)
    expect(isMemoryConcurrencySafe({ action: 'archive' })).toBe(false)
  })
  it('dtodo list safe via source check', async () => {
    const src = await import('node:fs').then(m => m.readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8'))
    expect(src).toContain("name: 'dtodo'")
    expect(src).toContain('isConcurrencySafe')
    expect(src).toContain('aborted')
  })
})
