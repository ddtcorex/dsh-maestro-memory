// On DSH 0.2.x `ctx.connection.rpc.handle` registers its route through
// `owner.webServer`, resolved on the fiber of the `connection` row itself, not
// on the calling row's fiber. A row-level `inject: ['webServer']` therefore
// does NOT help: the row throws `cannot get property "webServer" without
// inject` and never activates. The bundle patch must declare `webServer` on the
// `connection` entry. `inject` replaces the base list, so `webStartup` (which
// the base entry needs for `trustedHosts`) has to be repeated.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')

describe('cordis.patch.yml connection entry', () => {
  it('declares webServer on the connection entry, keeping webStartup', () => {
    const m = patch.match(/^- id: connection\n {2}inject:\n((?: {4}- \S+\n?)+)/m)
    expect(m, 'top-level `- id: connection` entry with an inject list').not.toBeNull()
    const injects = [...m![1].matchAll(/- (\S+)/g)].map((x) => x[1])
    expect(injects).toEqual(['webStartup', 'webServer'])
  })
})
