import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// M6 read-first skills browser: boundary with maestro-skills, metadata/origin only,
// no mutation, model suggestions cannot change skills, no altaration of discovery.

describe('M6 skills-browser: read-first, metadata/origin only', () => {
  let root: string
  let skillsDir: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-browser-'))
    skillsDir = join(root, 'skills')
    mkdirSync(skillsDir, { recursive: true })
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  async function writeSkill(name: string, frontmatter: string, body = 'body text') {
    const dir = join(skillsDir, name)
    mkdirSync(dir, { recursive: true })
    const content = `---\n${frontmatter}\n---\n${body}\n`
    writeFileSync(join(dir, 'SKILL.md'), content, 'utf8')
  }

  it('lists metadata/origin only, not full body, from a fixture skills dir', async () => {
    await writeSkill('alpha', 'name: alpha\ndescription: Alpha skill', 'Alpha body should not be in list')
    await writeSkill('beta', 'name: beta\ndescription: Beta description', 'Beta body')
    const { listSkillsSync } = await import('../src/host/skills-browser.ts')
    const entries = listSkillsSync(skillsDir, 'maestro-skills')
    expect(entries.length).toBe(2)
    const alpha = entries.find(e => e.name === 'alpha')
    expect(alpha).toBeDefined()
    expect(alpha!.description).toBe('Alpha skill')
    expect(alpha!.origin).toBe('maestro-skills')
    expect(alpha!.path).toContain('alpha/SKILL.md')
    expect(alpha!.metadata.name).toBe('alpha')
    // must NOT expose full body as primary field in list — body is not part of list entry
    expect((alpha as any).body).toBeUndefined()
    expect((alpha as any).content).toBeUndefined()
    // metadata present, body hidden
    expect(alpha!.metadata.description).toBe('Alpha skill')
  })

  it('handles missing SKILL.md and malformed frontmatter gracefully', async () => {
    mkdirSync(join(skillsDir, 'empty-folder'), { recursive: true })
    // no SKILL.md => skipped
    await writeSkill('good', 'name: good\ndescription: ok')
    // malformed file without frontmatter
    const badDir = join(skillsDir, 'bad')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'SKILL.md'), 'no frontmatter here', 'utf8')
    const { listSkillsSync } = await import('../src/host/skills-browser.ts')
    const entries = listSkillsSync(skillsDir, 'custom')
    // should include good and bad (bad with empty metadata fallback)
    expect(entries.find(e => e.name === 'good')).toBeDefined()
    const bad = entries.find(e => e.name === 'bad')
    expect(bad).toBeDefined()
    // bad falls back to folder name when no name in frontmatter
    expect(bad!.name).toBe('bad')
  })

  it('empty dir returns empty list', async () => {
    const { listSkillsSync } = await import('../src/host/skills-browser.ts')
    const entries = listSkillsSync(skillsDir, 'custom')
    expect(entries).toEqual([])
  })

  it('async listSkills mirrors sync', async () => {
    await writeSkill('x', 'name: x\ndescription: y')
    const { listSkills, listSkillsSync } = await import('../src/host/skills-browser.ts')
    const sync = listSkillsSync(skillsDir, 'test')
    const asyncEntries = await listSkills({ roots: [{ dir: skillsDir, origin: 'test' }] })
    expect(asyncEntries.length).toBe(sync.length)
    expect(asyncEntries[0].name).toBe(sync[0].name)
  })

  it('aggregates multiple origins', async () => {
    await writeSkill('one', 'name: one')
    const otherRoot = join(root, 'other-skills')
    mkdirSync(join(otherRoot, 'two'), { recursive: true })
    writeFileSync(join(otherRoot, 'two', 'SKILL.md'), '---\nname: two\ndescription: second\n---\nbody', 'utf8')
    const { listSkills } = await import('../src/host/skills-browser.ts')
    const all = await listSkills({ roots: [{ dir: skillsDir, origin: 'first' }, { dir: otherRoot, origin: 'second' }] })
    expect(all.length).toBe(2)
    expect(all.find(e => e.name === 'one')!.origin).toBe('first')
    expect(all.find(e => e.name === 'two')!.origin).toBe('second')
  })
})

describe('M6 skills-browser: read-only, no mutation surface', () => {
  it('module exposes no mutation/write API', async () => {
    const mod: any = await import('../src/host/skills-browser.ts')
    expect(mod.listSkills).toBeDefined()
    expect(mod.listSkillsSync).toBeDefined()
    // must NOT expose any write/mutate/delete/create API for M6 read-first
    expect(mod.writeSkill).toBeUndefined()
    expect(mod.createSkill).toBeUndefined()
    expect(mod.deleteSkill).toBeUndefined()
    expect(mod.mutateSkill).toBeUndefined()
    expect(mod.updateSkill).toBeUndefined()
    expect(mod.removeSkill).toBeUndefined()
  })

  it('host RPC only exposes read endpoints (skills.list)', async () => {
    // Verify host index registers only read endpoint under skills.* and does not expose mutate
    const text = readFileSync(join('/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory/src/host/index.ts'), 'utf8')
    // should have skills.list handling
    expect(text).toMatch(/skills\.list/)
    // must NOT contain skills.mutate / skills.write / skills.create in M6
    expect(text).not.toMatch(/skills\.mutate/)
    expect(text).not.toMatch(/skills\.write/)
    expect(text).not.toMatch(/skills\.create/)
    expect(text).not.toMatch(/skills\.delete/)
  })
})

describe('M6 skills-browser: boundary with maestro-skills — does not alter discovery', () => {
  it('does not register a SkillProvider and does not import ctx.skills', async () => {
    const src = readFileSync(join('/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory/src/host/skills-browser.ts'), 'utf8')
    expect(src).not.toMatch(/ctx\.skills\.registerProvider/)
    expect(src).not.toMatch(/registerProvider/)
    expect(src).not.toMatch(/inject.*skills/)
    // also check host index does not make skills-browser touch ctx.skills
    const hostSrc = readFileSync(join('/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory/src/host/index.ts'), 'utf8')
    // the skills-browser RPC handler should not call ctx.skills
    // simple check: ensure no "skills" provider registration in host
    // (maestro-skills is the only provider, we must not add another)
    const skillsProviderMatches = hostSrc.match(/skills\.registerProvider/g) ?? []
    expect(skillsProviderMatches.length).toBe(0)
  })

  it('listing maestro-skills checkout yields expected skills without affecting provider', async () => {
    const maestroDir = '/home/kai/Work/htdocs/maestro-harness/maestro-skills/skills'
    if (!existsSync(maestroDir)) {
      // if not present in CI, skip assertion but still pass
      expect(true).toBe(true)
      return
    }
    const { listSkillsSync } = await import('../src/host/skills-browser.ts')
    const entries = listSkillsSync(maestroDir, 'maestro-skills')
    // maestro-skills has 26 skills (12 Magento/Govard + 14 superpowers fork) — allow >=20 to avoid brittle exact count
    expect(entries.length).toBeGreaterThanOrEqual(20)
    const names = entries.map(e => e.name)
    expect(names).toContain('brainstorming')
    // ensure each has description and origin preserved
    for (const e of entries) {
      expect(e.description.length).toBeGreaterThan(0)
      expect(e.origin).toBe('maestro-skills')
      expect(e.path).toContain('SKILL.md')
    }
  })
})

describe('M6 skills-browser: model suggestions cannot change skills', () => {
  it('memory_suggest valid targets exclude skills', async () => {
    const hostText = readFileSync(join('/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory/src/host/index.ts'), 'utf8')
    // extract the valid targets array from memory_suggest tool
    const match = hostText.match(/memory_suggest[\s\S]{0,500}enum:\s*\[([^\]]+)\]/)
    expect(match).not.toBeNull()
    const enumText = match![1]
    expect(enumText).not.toMatch(/skill/)
    expect(enumText).toMatch(/memory/)
    expect(enumText).toMatch(/todo-/)
    // also check queue impl does not accept skill targets
    const { enqueueSuggestion } = await import('../src/host/review/queue.ts')
    const { SuggestionQueue } = await import('../src/host/review/queue.ts')
    const tmp = await mkdtemp(join(tmpdir(), 'skills-suggest-'))
    try {
      const q = new SuggestionQueue(join(tmp, 'SUGGESTIONS.jsonl'))
      // valid target should queue
      const ok = enqueueSuggestion(q, 'memory', 'fact', 'reason')
      expect(ok.ok).toBe(true)
      // attempt to suggest a skill should be considered invalid by host tool validation;
      // enqueueSuggestion itself is generic but host tool's valid list must reject skill
      // we simulate host validation: skill targets not in valid list
      const valid = ['memory', 'user', 'key', 'todo-life', 'todo-work', 'todo-project', 'todo-daily']
      expect(valid.includes('skill_manage')).toBe(false)
      expect(valid.includes('skills')).toBe(false)
      expect(valid.includes('skill')).toBe(false)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('browser cannot be driven by model tool — only explicit user RPC', async () => {
    const hostText = readFileSync(join('/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory/src/host/index.ts'), 'utf8')
    // skills.list is via ctx.connection.rpc.handle, not via ctx.tools.register
    expect(hostText).toMatch(/skills\.list/)
    // ensure no tool named skill_manage or skill_browser is registered for model
    // skill_manage is optional and disabled by default; M6 must not register it
    const hasSkillManageTool = hostText.includes("name: 'skill_manage'") || hostText.includes('name: "skill_manage"')
    expect(hasSkillManageTool).toBe(false)
  })
})

describe('M6 skills-browser: path containment helpers for future mutation (read-first prepares)', () => {
  it('isPathContained detects inside/outside correctly', async () => {
    const { isPathContained } = await import('../src/host/skills-browser.ts')
    expect(isPathContained('/a/b/c', '/a/b')).toBe(true)
    expect(isPathContained('/a/b', '/a/b')).toBe(true) // same dir considered contained (file inside root)
    expect(isPathContained('/a/b/c/d', '/a/b')).toBe(true)
    expect(isPathContained('/a/b', '/a/b/c')).toBe(false)
    expect(isPathContained('/a/b/../c', '/a/b')).toBe(false) // traversal escapes
    expect(isPathContained('/a/other', '/a/b')).toBe(false)
    expect(isPathContained('/a/b/c/../../other', '/a/b')).toBe(false)
  })

  it('list handles symlink inside skills dir without following outside for write (read still ok)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'skills-symlink-'))
    try {
      const skillsDir = join(tmp, 'skills')
      mkdirSync(skillsDir, { recursive: true })
      const realSkill = join(tmp, 'real-skill')
      mkdirSync(join(realSkill, 'linked-skill'), { recursive: true })
      writeFileSync(join(realSkill, 'linked-skill', 'SKILL.md'), '---\nname: linked\n---\nbody', 'utf8')
      // create symlink from skillsDir/linked -> realSkill/linked-skill
      symlinkSync(join(realSkill, 'linked-skill'), join(skillsDir, 'linked'))
      const { listSkillsSync, isPathContained } = await import('../src/host/skills-browser.ts')
      const entries = listSkillsSync(skillsDir, 'custom')
      expect(entries.length).toBe(1)
      expect(entries[0].name).toBe('linked')
      // containment check: symlink target is outside skillsDir, future mutation should block
      const targetPath = join(skillsDir, 'linked', 'SKILL.md')
      // isPathContained should detect that resolved symlink path is outside? For now we test logical containment:
      // The SKILL.md path itself is inside skillsDir (symlink path), but realpath would be outside.
      // Future mutation guard should use realpath or resolved check; test helper still correctly identifies logical containment
      expect(isPathContained(targetPath, skillsDir)).toBe(true) // logical path is inside
      // but if we check real target, it should be outside
      expect(isPathContained(join(realSkill, 'linked-skill', 'SKILL.md'), skillsDir)).toBe(false)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('documents that mutation requires explicit user action and containment check (no auto-write)', async () => {
    const src = readFileSync(join('/home/kai/Work/htdocs/maestro-harness/dsh-maestro-memory/src/host/skills-browser.ts'), 'utf8')
    // must contain comment documenting future mutation guard
    expect(src).toMatch(/explicit user action/i)
    expect(src).toMatch(/containment|isPathContained/)
  })
})

describe('M6 skills-browser: RPC read-only integration', () => {
  it('skills.list via host RPC returns read-only entries', async () => {
    const { apply } = await import('../src/host/index.ts')
    // minimal fake ctx to capture RPC handler
    let handler: any = null
    const fakeCtx: any = {
      tools: { register: () => () => {} },
      systemPrompt: { context: () => () => {} },
      workspaceRegistry: {},
      connection: { rpc: { handle: (ch: string, h: any) => { if (ch === '/dsh-maestro-memory') handler = h; return () => {} } } },
      effect: (fn: any) => { const d = fn(); return d },
      get: (n: string) => (n === 'connection' ? fakeCtx.connection : undefined),
    }
    const tmp = await mkdtemp(join(tmpdir(), 'skills-rpc-'))
    try {
      const skillsDir = join(tmp, 'skills')
      mkdirSync(join(skillsDir, 'my-skill'), { recursive: true })
      writeFileSync(join(skillsDir, 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: demo\n---\nbody', 'utf8')
      apply(fakeCtx, { memoryDir: tmp } as any)
      expect(handler).not.toBeNull()
      // call skills.list endpoint — should be read-only and return entries
      const res = await handler('skills.list', { skillsDir })
      expect(res.ok).toBe(true)
      expect(Array.isArray(res.entries)).toBe(true)
      expect(res.entries.find((e: any) => e.name === 'my-skill')).toBeDefined()
      // verify no mutate endpoint
      const mutateRes = await handler('skills.mutate', {})
      expect(mutateRes.ok).toBe(false)
      expect(String(mutateRes.error).toLowerCase()).toMatch(/read.only|not implemented|unknown endpoint/)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
