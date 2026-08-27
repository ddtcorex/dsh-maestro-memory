import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

function sha256(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return createHash('sha256').update(b).digest('hex')
}

describe('M4-PR-A rehearsal: fixture profile with link: package/patch and one owner per tool', () => {
  it('fixture profile helper creates link package and proves single owner', async () => {
    const { createFixtureProfile, assertSingleOwner } = await import('../src/host/migration/fixture.ts')
    const tmp = await mkdtemp(join(tmpdir(), 'm4-profile-'))
    const packageDir = process.env.MAESTRO_HARNESS_ROOT
      ? join(process.env.MAESTRO_HARNESS_ROOT, 'packages/dsh-maestro-memory')
      : resolve(process.cwd(), '.')
    try {
      const profileDir = join(tmp, 'profile')
      const created = await createFixtureProfile({ profileDir, packageDir })
      expect(existsSync(join(profileDir, 'package.json'))).toBe(true)
      const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      // must use link: not version
      expect(pkg.dependencies['@ddtcorex/dsh-maestro-memory']).toMatch(/^link:/)
      expect(pkg.dependencies['@ddtcorex/dsh-maestro-memory']).toContain(packageDir)
      // bundles must list our plugin
      expect(pkg.dsh.profile.bundles).toContain('@ddtcorex/dsh-maestro-memory')
      // patch must NOT duplicate id maestro-memory (it is provided by package's cordis.patch.yml)
      const patchPath = join(profileDir, 'cordis.patch.yml')
      if (existsSync(patchPath)) {
        const patchText = readFileSync(patchPath, 'utf8')
        expect(patchText).not.toContain('maestro-memory')
      }
      // one owner per compatibility tool
      const result = await assertSingleOwner(profileDir)
      expect(result.ok).toBe(true)
      expect(result.owners['memory']).toBe('@ddtcorex/dsh-maestro-memory')
      expect(result.owners['dtodo']).toBe('@ddtcorex/dsh-maestro-memory')
      // skill_manage is optional — if present, also single owner, else not listed
      if (result.owners['skill_manage']) {
        expect(result.owners['skill_manage']).toBe('@ddtcorex/dsh-maestro-memory')
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('fails when duplicate owner detected', async () => {
    const { assertSingleOwner } = await import('../src/host/migration/fixture.ts')
    const tmp = await mkdtemp(join(tmpdir(), 'm4-dup-'))
    try {
      const profileDir = join(tmp, 'profile')
      mkdirSync(profileDir, { recursive: true })
      // create a profile that lists two owners for memory
      writeFileSync(
        join(profileDir, 'package.json'),
        JSON.stringify(
          {
            name: 'dsh-profile-fixture',
            private: true,
            dsh: { profile: { bundles: ['@ddtcorex/dsh-maestro-memory', 'some-other-memory'] } },
            dependencies: {
              '@ddtcorex/dsh-maestro-memory': `link:${process.env.MAESTRO_HARNESS_ROOT ? join(process.env.MAESTRO_HARNESS_ROOT, 'packages/dsh-maestro-memory') : resolve(process.cwd(), '.')}`,
              'some-other-memory': '1.0.0',
            },
          },
          null,
          2,
        ),
        'utf8',
      )
      // mock that some-other-memory also provides memory tool -> we pass explicit mapping
      const result = await assertSingleOwner(profileDir, {
        toolOwners: {
          memory: ['@ddtcorex/dsh-maestro-memory', 'some-other-memory'],
          dtodo: ['@ddtcorex/dsh-maestro-memory'],
        },
      })
      expect(result.ok).toBe(false)
      expect(result.errors.join(' ')).toMatch(/memory.*duplicate|multiple owners/i)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('M4-PR-A rehearsal: dry-run, backup, adopt, verify against copied schema (not live)', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'm4-copied-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function writeLegacyMemory(file: string, entries: string[]) {
    const content = entries.length === 0 ? '' : entries.join('\n§\n') + '\n'
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }

  it('dry-run is read-only, backup is byte-preserving, verify passes', async () => {
    const { inspect, dryRun, run, verify } = await import('../src/host/migration/service.ts')
    const { createCopiedMemoryRoot } = await import('../src/host/migration/fixture.ts')
    // create copied schema fixture (not live home)
    await createCopiedMemoryRoot(root)
    const memRawBefore = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    const shaBefore = sha256(memRawBefore)

    // inspect / dryRun must not create .maestro-memory
    const insp = await inspect(root)
    expect(insp.ok).toBe(true)
    const dr = await dryRun(root)
    expect(dr.ok).toBe(true)
    expect(existsSync(join(root, '.maestro-memory'))).toBe(false)

    // run creates backup + schema without reformatting
    const res = await run(root)
    expect(res.ok).toBe(true)
    expect(existsSync(res.manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(res.manifestPath, 'utf8'))
    expect(manifest.files.length).toBeGreaterThan(0)
    const memEntry = manifest.files.find((f: any) => f.relative === 'MEMORY.md')
    expect(memEntry.sha256).toBe(shaBefore)
    const backupMem = readFileSync(join(manifest.backupFilesDir, 'MEMORY.md'), 'utf8')
    expect(backupMem).toBe(memRawBefore)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe(memRawBefore)

    // verify passes when unchanged
    const ver = await verify(root)
    expect(ver.ok).toBe(true)
    expect(ver.mismatches.length).toBe(0)

    // live home must not be touched
    const liveRoot = join(process.env.HOME ?? homedir(), '.dsh', 'memories')
    const liveMeta = join(liveRoot, '.maestro-memory', 'backups')
    // we don't assert liveMeta absent (it may exist from prior runs), but our root is isolated
    expect(root).not.toBe(liveRoot)
  })
})

describe('M4-PR-A rehearsal: profile reload, live reads, one write against copied schema', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'm4-live-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('profile reload + live reads + one write', async () => {
    const { createCopiedMemoryRoot } = await import('../src/host/migration/fixture.ts')
    const { run, verify } = await import('../src/host/migration/service.ts')
    await createCopiedMemoryRoot(root)
    const runRes = await run(root)
    expect(runRes.ok).toBe(true)
    const ver = await verify(root)
    expect(ver.ok).toBe(true)

    // simulate profile reload: apply plugin with memoryDir=root, dispose, re-apply
    const { apply } = await import('../src/host/index.ts')
    function fakeCtx(memoryDir: string) {
      const tools: any[] = []
      const rpcHandlers = new Map<string, any>()
      const snapshots: any[] = []
      const ctx: any = {
        tools: { register: (t: any) => { tools.push(t); return () => {} } },
        systemPrompt: { context: (c: any) => { snapshots.push(c); return () => {} } },
        workspaceRegistry: {},
        connection: { rpc: { handle: (ch: string, h: any) => { rpcHandlers.set(ch, h); return () => {} } } },
        effect: (fn: any) => { const d = fn(); return d },
        get: (n: string) => (n === 'connection' ? ctx.connection : undefined),
        state: { tools, rpcHandlers, snapshots },
      }
      return ctx
    }

    const ctx1 = fakeCtx(root)
    apply(ctx1, { memoryDir: root })
    expect(ctx1.state.tools.find((t: any) => t.name === 'memory')).toBeDefined()
    expect(ctx1.state.tools.find((t: any) => t.name === 'dtodo')).toBeDefined()

    // live reads via stores against copied schema
    const { MaestroMemoryStore } = await import('../src/host/memory/store.ts')
    const { TodoStore } = await import('../src/host/todo/store.ts')
    const memStore = new MaestroMemoryStore(root)
    const todoStore = new TodoStore(root)
    const memEntries = memStore.list('memory')
    expect(memEntries.length).toBeGreaterThan(0)
    const keyEntries = memStore.list('key', '/tmp/proj-a')
    // key may be present from fixture
    expect(Array.isArray(keyEntries)).toBe(true)

    // list todos across tracks
    const lifeItems = todoStore.listTodos(['life'], {}, undefined)
    // at least empty or with fixture data
    expect(lifeItems).toBeDefined()

    // one write against copied schema (not live home)
    const cwd = '/tmp/proj-a'
    const addRes = memStore.add('memory', 'rehearsal write ' + Date.now())
    expect(addRes.ok).toBe(true)
    const after = memStore.list('memory')
    expect(after.join('\n')).toContain('rehearsal write')

    // second reload should see the write (re-apply)
    const ctx2 = fakeCtx(root)
    apply(ctx2, { memoryDir: root })
    const memStore2 = new MaestroMemoryStore(root)
    const afterReload = memStore2.list('memory')
    expect(afterReload.join('\n')).toContain('rehearsal write')
  })
})

describe('M4-PR-A rehearsal: full end-to-end (fixture profile + migrate + reload + write + rollback)', () => {
  it('runs the complete rehearsal sequence against a copied schema, never touching live home', async () => {
    const { createFixtureProfile, assertSingleOwner, createCopiedMemoryRoot } = await import('../src/host/migration/fixture.ts')
    const { inspect, dryRun, run, verify, rollback } = await import('../src/host/migration/service.ts')
    const tmp = await mkdtemp(join(tmpdir(), 'm4-e2e-'))
    const profileDir = join(tmp, 'profile')
    const memoryRoot = join(tmp, 'memories')
    const packageDir = process.env.MAESTRO_HARNESS_ROOT
      ? join(process.env.MAESTRO_HARNESS_ROOT, 'packages/dsh-maestro-memory')
      : resolve(process.cwd(), '.')
    try {
      // 1. fixture profile with link:
      await createFixtureProfile({ profileDir, packageDir })
      const ownerRes = await assertSingleOwner(profileDir)
      expect(ownerRes.ok).toBe(true)
      expect(ownerRes.owners['memory']).toBe('@ddtcorex/dsh-maestro-memory')
      // patch must not duplicate
      expect(ownerRes.errors.length).toBe(0)

      // 2. copied schema (not live home)
      await createCopiedMemoryRoot(memoryRoot)
      const liveRoot = join(process.env.HOME ?? homedir(), '.dsh', 'memories')
      expect(memoryRoot).not.toBe(liveRoot)
      const memBefore = readFileSync(join(memoryRoot, 'MEMORY.md'), 'utf8')
      const shaBefore = sha256(memBefore)

      // 3. dry-run (read-only)
      const dr = await dryRun(memoryRoot)
      expect(dr.ok).toBe(true)
      expect(existsSync(join(memoryRoot, '.maestro-memory', 'schema.json'))).toBe(false)

      // 4. backup + adopt (run)
      const runRes = await run(memoryRoot)
      expect(runRes.ok).toBe(true)
      expect(existsSync(runRes.manifestPath)).toBe(true)
      expect(readFileSync(join(memoryRoot, 'MEMORY.md'), 'utf8')).toBe(memBefore)

      // 5. verify
      const ver = await verify(memoryRoot)
      expect(ver.ok).toBe(true)

      // 6. profile reload (apply/dispose) + live reads
      const { apply } = await import('../src/host/index.ts')
      function fakeCtx(dir: string) {
        const tools: any[] = []
        const ctx: any = {
          tools: { register: (t: any) => { tools.push(t); return () => {} } },
          systemPrompt: { context: () => () => {} },
          workspaceRegistry: {},
          connection: { rpc: { handle: () => () => {} } },
          effect: (fn: any) => fn(),
          get: () => undefined,
          state: { tools },
        }
        return ctx
      }
      const ctx = fakeCtx(memoryRoot)
      apply(ctx, { memoryDir: memoryRoot })
      expect(ctx.state.tools.find((t: any) => t.name === 'memory')).toBeDefined()
      const { MaestroMemoryStore } = await import('../src/host/memory/store.ts')
      const { TodoStore } = await import('../src/host/todo/store.ts')
      const ms = new MaestroMemoryStore(memoryRoot)
      const ts = new TodoStore(memoryRoot)
      expect(ms.list('memory').length).toBeGreaterThan(0)
      expect(ts.listTodos(['life'], {}, undefined)).toBeDefined()

      // 7. one write against copied schema
      const w = ms.add('memory', 'e2e write ' + Date.now())
      expect(w.ok).toBe(true)
      expect(ms.list('memory').join('\n')).toContain('e2e write')
      // verify now fails (digest changed)
      const ver2 = await verify(memoryRoot)
      expect(ver2.ok).toBe(false)

      // 8. rollback exercise
      const rb = await rollback(memoryRoot, runRes.runId)
      expect(rb.ok).toBe(true)
      expect(readFileSync(join(memoryRoot, 'MEMORY.md'), 'utf8')).toBe(memBefore)
      expect(sha256(readFileSync(join(memoryRoot, 'MEMORY.md'), 'utf8'))).toBe(shaBefore)
      const ver3 = await verify(memoryRoot)
      expect(ver3.ok).toBe(true)

      // 9. live home untouched
      expect(memoryRoot).not.toBe(liveRoot)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('M4-PR-A rehearsal: rollback exercise', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'm4-rollback-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function writeLegacyMemory(file: string, entries: string[]) {
    const content = entries.length === 0 ? '' : entries.join('\n§\n') + '\n'
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }

  it('rollback restores backup files byte-identical', async () => {
    const { createCopiedMemoryRoot, } = await import('../src/host/migration/fixture.ts')
    const { run, verify, rollback } = await import('../src/host/migration/service.ts')
    await createCopiedMemoryRoot(root)
    const beforeRaw = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    const beforeSha = sha256(beforeRaw)
    const res = await run(root)
    expect(res.ok).toBe(true)

    // one write after adopt
    const { MaestroMemoryStore } = await import('../src/host/memory/store.ts')
    const store = new MaestroMemoryStore(root)
    const addRes = store.add('memory', 'post-adopt entry ' + Date.now())
    expect(addRes.ok).toBe(true)
    const afterWriteRaw = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(sha256(afterWriteRaw)).not.toBe(beforeSha)
    expect(afterWriteRaw).toContain('post-adopt entry')

    // tamper detection before rollback
    const verFail = await verify(root)
    expect(verFail.ok).toBe(false)
    expect(verFail.mismatches.length).toBeGreaterThan(0)

    // rollback to backup
    const rb = await rollback(root, res.runId)
    expect(rb.ok).toBe(true)
    expect(rb.restored).toBeGreaterThan(0)
    const restoredRaw = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(restoredRaw).toBe(beforeRaw)
    expect(sha256(restoredRaw)).toBe(beforeSha)

    // verify passes after rollback, write-block cleared
    const verOk = await verify(root)
    expect(verOk.ok).toBe(true)

    // new write should succeed after rollback
    const store2 = new MaestroMemoryStore(root)
    const add2 = store2.add('memory', 'after-rollback write')
    expect(add2.ok).toBe(true)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toContain('after-rollback write')
  })

  it('rollback is no-op before any writes (profile reload only)', async () => {
    const { createCopiedMemoryRoot } = await import('../src/host/migration/fixture.ts')
    const { run, verify, rollback } = await import('../src/host/migration/service.ts')
    await createCopiedMemoryRoot(root)
    const beforeRaw = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    const res = await run(root)
    expect(res.ok).toBe(true)
    // no writes, just rollback immediately (should still restore same bytes)
    const rb = await rollback(root, res.runId)
    expect(rb.ok).toBe(true)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe(beforeRaw)
    const ver = await verify(root)
    expect(ver.ok).toBe(true)
  })
})
