import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the DSH peer contract (spec docs/specs/2026-09-23-dsh-maestro-peer-compat-design.md).
 *
 * DSH 0.1.7-rc.1 denies any profile row whose `@deepseek-ai/dsh*` peer cannot be satisfied
 * by the running runtime, evaluated with `includePrerelease: true`. An exact pin therefore
 * disables the plugin at boot on the very next DSH release.
 *
 * The check is structural and dependency-free on purpose: `semver` is not a dependency of
 * this package, and hand-rolling a comparator is how a guard starts lying. It asserts the
 * shape of the contract instead — a range, an early floor, and a `-0` ceiling.
 */
const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
  peerDependencies?: Record<string, string>
}

/** The one range every dsh peer must carry. Keep in sync with the workspace AGENTS.md rule. */
const NORMALIZED = '^0.1.0-rc.6 || >=0.1.1-rc.0 <0.2.0-0'
const FORBIDDEN_PEER_PREFIX = '@deepseek-ai/dsh'

interface Violation { name: string; range: string; reasons: string[] }

function dshPeers(): Array<[string, string]> {
  return Object.entries(manifest.peerDependencies ?? {}).filter(
    ([name]) => name === FORBIDDEN_PEER_PREFIX || name.startsWith(`${FORBIDDEN_PEER_PREFIX}-`),
  )
}

function violations(): Violation[] {
  const found: Violation[] = []
  for (const [name, range] of dshPeers()) {
    const reasons: string[] = []
    if (/^\d/.test(range.trim())) reasons.push('exact pin')
    if (!/<\s*0\.\d/.test(range)) reasons.push('missing ceiling')
    else if (!/0\.2\.0-0/.test(range)) reasons.push('ceiling lacks -0 suffix')
    const earlyFloor = /(?:>=|\^|~)?\s*0\.1\.\d/.test(range)
    if (!earlyFloor) reasons.push('floor too late')
    if (reasons.length > 0) found.push({ name, range, reasons })
  }
  return found
}

describe('dsh peer ranges', () => {
  it('declares at least one dsh peer (sanity: the guard would be vacuous otherwise)', () => {
    expect(dshPeers().length).toBeGreaterThan(0)
  })

  it('uses the normalized range for every dsh peer', () => {
    for (const [name, range] of dshPeers()) expect(range, name).toBe(NORMALIZED)
  })

  it('reports no structural violations', () => {
    const found = violations()
    expect(found.map(v => `${v.name}: ${v.reasons.join(', ')}`)).toEqual([])
  })

  it('flags an exact pin (the 2026-09-23 incident)', () => {
    expect(/^\d/.test('0.1.7-alpha.2')).toBe(true)
  })

  it('flags a ceiling that lacks the -0 suffix', () => {
    expect(/0\.2\.0-0/.test('^0.1.0-rc.6 || >=0.1.1-rc.0 <0.2.0')).toBe(false)
    expect(/0\.2\.0-0/.test(NORMALIZED)).toBe(true)
  })
})
