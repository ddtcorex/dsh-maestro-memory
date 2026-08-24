/**
 * git.ts — Git adapter abstraction. Disabled => zero spawn.
 * Real adapter uses child_process git with file:// remotes via --git-dir show.
 * Mock adapter is in-memory for tests.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface GitAdapter {
  /** Fetch remote branch, return ok/error */
  fetch(remoteUrl: string, branch: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** Push files to remote branch (commit & push). files keys are branch-root paths e.g. KEY.md */
  push(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** Get remote branch files (read). */
  getRemoteFiles(remoteUrl: string, branch: string): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: string }>
}

/**
 * MockGitAdapter — in-memory remote, tracks calls for disabled assertions.
 */
export class MockGitAdapter implements GitAdapter {
  // remoteUrl -> branch -> files
  public remotes = new Map<string, Map<string, Record<string, string>>>()
  public calls: Array<{ method: string; remoteUrl: string; branch: string }> = []
  public failNextFetch: string | null = null
  public failNextPush: string | null = null
  public failNextGet: string | null = null

  async fetch(remoteUrl: string, branch: string): Promise<{ ok: true } | { ok: false; error: string }> {
    this.calls.push({ method: 'fetch', remoteUrl, branch })
    if (this.failNextFetch) {
      const e = this.failNextFetch
      this.failNextFetch = null
      return { ok: false, error: e }
    }
    return { ok: true }
  }

  async push(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
    this.calls.push({ method: 'push', remoteUrl, branch })
    if (this.failNextPush) {
      const e = this.failNextPush
      this.failNextPush = null
      return { ok: false, error: e }
    }
    let br = this.remotes.get(remoteUrl)
    if (!br) {
      br = new Map()
      this.remotes.set(remoteUrl, br)
    }
    br.set(branch, { ...files, '.meta.json': JSON.stringify({ message, at: new Date().toISOString() }) })
    return { ok: true }
  }

  async getRemoteFiles(remoteUrl: string, branch: string): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: string }> {
    this.calls.push({ method: 'getRemoteFiles', remoteUrl, branch })
    if (this.failNextGet) {
      const e = this.failNextGet
      this.failNextGet = null
      return { ok: false, error: e }
    }
    const br = this.remotes.get(remoteUrl)?.get(branch)
    if (!br) return { ok: true, files: {} }
    // strip meta
    const { '.meta.json': _m, ...files } = br as any
    return { ok: true, files }
  }

  // helper to directly set remote files (simulate other machine push)
  setRemoteFiles(remoteUrl: string, branch: string, files: Record<string, string>) {
    let br = this.remotes.get(remoteUrl)
    if (!br) {
      br = new Map()
      this.remotes.set(remoteUrl, br)
    }
    br.set(branch, { ...files })
  }

  getRemoteFilesSync(remoteUrl: string, branch: string): Record<string, string> | undefined {
    return this.remotes.get(remoteUrl)?.get(branch)
  }

  reset() {
    this.calls = []
    this.failNextFetch = null
    this.failNextPush = null
    this.failNextGet = null
  }
}

/**
 * RealGitAdapter — uses git CLI for file:// remotes.
 * For http/ssh remotes it delegates to git fetch/push via temp clone.
 * Minimal implementation sufficient for integration tests with file:// bare remotes.
 */
export class RealGitAdapter implements GitAdapter {
  async fetch(remoteUrl: string, branch: string): Promise<{ ok: true } | { ok: false; error: string }> {
    // For file:// bare remote, check existence via ls-remote; no real fetch needed.
    // We treat fetch as ls-remote to validate connectivity.
    const res = spawnSync('git', ['ls-remote', remoteUrl, `refs/heads/${branch}`], { encoding: 'utf8', timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    if (res.error) return { ok: false, error: (res.error as any).message ?? String(res.error) }
    if (res.status !== 0) {
      const stderr = String(res.stderr ?? '')
      const lower = stderr.toLowerCase()
      // Only a reachable repo where this exact branch/ref does not exist yet is
      // acceptable (means "first push"). Everything else — unreachable remote,
      // not a repo, or an auth/connectivity failure — is a hard error so we
      // never silently treat an offline remote as "no data".
      if (lower.includes("couldn't find remote ref") || lower.includes('no such ref') || lower.includes('unknown revision')) {
        return { ok: true }
      }
      return { ok: false, error: stderr.trim() || `ls-remote failed (status ${res.status})` }
    }
    return { ok: true }
  }

  async getRemoteFiles(remoteUrl: string, branch: string): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: string }> {
    // Use git --git-dir=<remote> show branch:file if remote is file:// path
    const filePath = this.resolveFileUrl(remoteUrl)
    if (filePath) {
      // file:// bare remote
      return this.getFilesFromBare(filePath, branch)
    }
    // For non-file remotes, clone to temp and read
    return this.getFilesViaClone(remoteUrl, branch)
  }

  async push(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const filePath = this.resolveFileUrl(remoteUrl)
    if (filePath) {
      return this.pushToBare(filePath, branch, files, message)
    }
    return this.pushViaClone(remoteUrl, branch, files, message)
  }

  private resolveFileUrl(url: string): string | null {
    if (url.startsWith('file://')) return url.slice('file://'.length)
    if (url.startsWith('/tmp/') || url.startsWith('/')) {
      // Treat absolute path as file remote for tests (implicit file://)
      if (existsSync(url)) return url
      // also allow /tmp/xxx without existence check
      if (url.startsWith('/tmp/')) return url
    }
    return null
  }

  private getFilesFromBare(barePath: string, branch: string): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const expected = ['KEY.md', 'MEMORY.md', 'KEY-archive.md', 'TODOS.md']
      const files: Record<string, string> = {}
      for (const f of expected) {
        const res = spawnSync('git', ['--git-dir', barePath, 'show', `${branch}:${f}`], { encoding: 'utf8', timeout: 5000 })
        if (res.status === 0) {
          files[f] = res.stdout
        } else {
          // file not on branch or branch missing -> treat as missing
          // if branch missing, files empty
          const stderr = String(res.stderr ?? '')
          if (stderr.includes('not found') || stderr.includes('does not exist') || stderr.includes('invalid object')) {
            continue
          }
          // other error -> treat as empty for now
          continue
        }
      }
      // Check if branch exists at all: if no files and branch missing, return empty (not error)
      const ls = spawnSync('git', ['--git-dir', barePath, 'rev-parse', '--verify', `refs/heads/${branch}`], { encoding: 'utf8' })
      if (ls.status !== 0 && Object.keys(files).length === 0) {
        // branch not existent yet
        resolve({ ok: true, files: {} })
        return
      }
      resolve({ ok: true, files })
    })
  }

  private pushToBare(barePath: string, branch: string, files: Record<string, string>, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const tmp = mkdtempSync(join(tmpdir(), 'maestro-sync-'))
      try {
        // init temp repo
        let r = spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' })
        if (r.status !== 0) return resolve({ ok: false, error: r.stderr?.toString() ?? 'init failed' })
        r = spawnSync('git', ['remote', 'add', 'origin', barePath], { cwd: tmp, encoding: 'utf8' })
        if (r.status !== 0) return resolve({ ok: false, error: r.stderr?.toString() ?? 'remote add failed' })
        // try fetch existing branch
        spawnSync('git', ['fetch', 'origin', branch], { cwd: tmp, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
        // Check out the branch ON TOP of the fetched remote tip (FETCH_HEAD) so a
        // subsequent commit is a descendant of the remote history and can be
        // pushed as a fast-forward. On the first push FETCH_HEAD is absent, so
        // checkout falls through to the orphan branch path below.
        const checkout = spawnSync('git', ['checkout', '-B', branch, 'FETCH_HEAD'], { cwd: tmp, encoding: 'utf8' })
        if (checkout.status !== 0) {
          // try orphan
          spawnSync('git', ['checkout', '--orphan', branch], { cwd: tmp, encoding: 'utf8' })
          spawnSync('git', ['rm', '-rf', '.'], { cwd: tmp, encoding: 'utf8' })
        }
        // write files
        for (const [name, content] of Object.entries(files)) {
          const p = join(tmp, name)
          mkdirSync(join(p, '..'), { recursive: true })
          writeFileSync(p, content, 'utf8')
        }
        spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' })
        // need user identity
        const env = { ...process.env, GIT_AUTHOR_NAME: 'maestro', GIT_AUTHOR_EMAIL: 'maestro@local', GIT_COMMITTER_NAME: 'maestro', GIT_COMMITTER_EMAIL: 'maestro@local' }
        const commit = spawnSync('git', ['commit', '-m', message, '--allow-empty'], { cwd: tmp, encoding: 'utf8', env })
        if (commit.status !== 0) return resolve({ ok: false, error: commit.stderr?.toString() ?? 'commit failed' })
        const push = spawnSync('git', ['push', 'origin', `${branch}:${branch}`], { cwd: tmp, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
        if (push.status !== 0) return resolve({ ok: false, error: push.stderr?.toString() ?? 'push failed' })
        resolve({ ok: true })
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch {}
      }
    })
  }

  private getFilesViaClone(remoteUrl: string, branch: string): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const tmp = mkdtempSync(join(tmpdir(), 'maestro-sync-clone-'))
      try {
        const clone = spawnSync('git', ['clone', '--branch', branch, '--single-branch', remoteUrl, tmp + '/repo'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
        if (clone.status !== 0) {
          // branch may not exist yet
          resolve({ ok: true, files: {} })
          return
        }
        const repo = join(tmp, 'repo')
        const files: Record<string, string> = {}
        for (const f of ['KEY.md', 'MEMORY.md', 'KEY-archive.md', 'TODOS.md']) {
          const p = join(repo, f)
          if (existsSync(p)) files[f] = readFileSync(p, 'utf8')
        }
        resolve({ ok: true, files })
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch {}
      }
    })
  }

  private pushViaClone(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const tmp = mkdtempSync(join(tmpdir(), 'maestro-sync-push-'))
      try {
        // shallow clone or init
        let repo = join(tmp, 'repo')
        mkdirSync(repo, { recursive: true })
        let r = spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' })
        if (r.status !== 0) return resolve({ ok: false, error: r.stderr?.toString() ?? 'init failed' })
        r = spawnSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: repo, encoding: 'utf8' })
        if (r.status !== 0) return resolve({ ok: false, error: r.stderr?.toString() ?? 'remote add failed' })
        spawnSync('git', ['fetch', 'origin', branch], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
        // Base the branch on the remote tip (FETCH_HEAD) so we fast-forward
        // instead of producing an orphan root commit that the second push
        // rejects as non-fast-forward.
        const checkout = spawnSync('git', ['checkout', '-B', branch, 'FETCH_HEAD'], { cwd: repo, encoding: 'utf8' })
        if (checkout.status !== 0) {
          spawnSync('git', ['checkout', '--orphan', branch], { cwd: repo, encoding: 'utf8' })
          spawnSync('git', ['rm', '-rf', '.'], { cwd: repo, encoding: 'utf8' })
        }
        for (const [name, content] of Object.entries(files)) {
          writeFileSync(join(repo, name), content, 'utf8')
        }
        spawnSync('git', ['add', '.'], { cwd: repo, encoding: 'utf8' })
        const env = { ...process.env, GIT_AUTHOR_NAME: 'maestro', GIT_AUTHOR_EMAIL: 'maestro@local', GIT_COMMITTER_NAME: 'maestro', GIT_COMMITTER_EMAIL: 'maestro@local' }
        const commit = spawnSync('git', ['commit', '-m', message, '--allow-empty'], { cwd: repo, encoding: 'utf8', env })
        if (commit.status !== 0) return resolve({ ok: false, error: commit.stderr?.toString() ?? 'commit failed' })
        const push = spawnSync('git', ['push', 'origin', `${branch}:${branch}`], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
        if (push.status !== 0) return resolve({ ok: false, error: push.stderr?.toString() ?? 'push failed' })
        resolve({ ok: true })
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch {}
      }
    })
  }
}
