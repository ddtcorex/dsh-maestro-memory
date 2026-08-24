import { describe, it, expect } from 'vitest'

describe('scaffold smoke', () => {
  it('host + client scaffold compiles', async () => {
    const host = await import('../src/host/index.ts')
    expect(host.apply).toBeDefined()
    const store = await import('../src/host/storage/layout.ts')
    expect(store.projectHash('/tmp/test')).toMatch(/^[0-9a-f]{12}$/)
  })
})
