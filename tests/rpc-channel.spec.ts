import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const CHANNEL_RE = /^\/[A-Za-z0-9._~-]+$/

describe('RPC channel names — Cordis assertChannel', () => {
  it('known channels match regex', () => {
    expect('/dsh-maestro-memory').toMatch(CHANNEL_RE)
    expect('/dsh-maestro-memory-health').toMatch(CHANNEL_RE)
    expect('/dsh-maestro-memory-propose').toMatch(CHANNEL_RE)
  })

  it('invalid channels fail regex (would crash dsh web)', () => {
    expect('/maestro-memory/health').not.toMatch(CHANNEL_RE)
    expect('/maestro-memory/propose').not.toMatch(CHANNEL_RE)
    expect('/dsh-maestro-memory/health').not.toMatch(CHANNEL_RE)
  })

  it('src files contain no invalid channel literals', () => {
    const host = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
    const client = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    // Find all rpc.handle / rpc.call channel strings
    const re = /rpc\.(handle|call)\(['"`]([^'"`]+)['"`]/g
    const invalid: string[] = []
    for (const src of [host, client]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const channel = m[2]
        // Only check channels starting with / and containing maestro (our plugin)
        if (channel.includes('maestro') && !CHANNEL_RE.test(channel)) {
          invalid.push(channel)
        }
      }
    }
    expect(invalid).toEqual([])
  })
})
