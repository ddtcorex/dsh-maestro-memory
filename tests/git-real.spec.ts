import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { RealGitAdapter } from '../src/host/sync/git.ts'

let dir: string
let bare: string
let adapter: RealGitAdapter
const branch = 'maestro-memory/test'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maestro-realgit-'))
  bare = join(dir, 'remote.git')
  const init = spawnSync('git', ['init', '--bare', bare], { encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`failed to init bare repo: ${init.stderr}`)
  adapter = new RealGitAdapter()
  // set a known commit identity for deterministic pushes
  spawnSync('git', ['config', '--global', 'user.email', 'test@local'], { encoding: 'utf8' })
  spawnSync('git', ['config', '--global', 'user.name', 'test'], { encoding: 'utf8' })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('RealGitAdapter push to a file:// bare remote', () => {
  it('a second push fast-forwards instead of being rejected (no orphan root commit)', async () => {
    const remote = 'file://' + bare
    const p1 = await adapter.push(remote, branch, { 'KEY.md': 'v1\n' }, 'first push')
    expect(p1.ok).toBe(true)

    const p2 = await adapter.push(remote, branch, { 'KEY.md': 'v2\n' }, 'second push')
    expect(p2.ok).toBe(true)

    // The second commit must be a child of the first (fast-forward), so the
    // remote branch has exactly 2 commits in a linear history.
    const log = spawnSync('git', ['--git-dir', bare, 'log', '--oneline', `refs/heads/${branch}`], { encoding: 'utf8' })
    expect(log.status).toBe(0)
    const lines = log.stdout.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(2)
  })

  it('reports a hard error when the remote is unreachable, not silent success', async () => {
    // A non-existent path on the local filesystem is an unreachable remote.
    const remote = 'file://' + join(dir, 'does-not-exist.git')
    const f = await adapter.fetch(remote, branch)
    expect(f.ok).toBe(false)
  })
})
