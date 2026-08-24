/**
 * fixture.ts — helpers for M4-PR-A rehearsal: fixture profile with link: package/patch,
 * one-owner per compatibility tool, and copied-schema population (not live home).
 *
 * Pure helpers + minimal FS. No Cordis import, no network, no live home mutation.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const COMPAT_TOOLS = ['memory', 'dtodo', 'skill_manage', 'memory_suggest', 'memory_review_status'] as const
type CompatTool = typeof COMPAT_TOOLS[number]

/**
 * Known tool ownership map for rehearsal.
 * Currently only @ddtcorex/dsh-maestro-memory provides compatibility tools.
 * Future: if DSH core adds an owner, this gate must surface it.
 */
const KNOWN_OWNERS: Record<string, string[]> = {
  memory: ['@ddtcorex/dsh-maestro-memory'],
  dtodo: ['@ddtcorex/dsh-maestro-memory'],
  skill_manage: [], // optional module, not owned by default
  memory_suggest: ['@ddtcorex/dsh-maestro-memory'],
  memory_review_status: ['@ddtcorex/dsh-maestro-memory'],
}

export interface CreateFixtureProfileOpts {
  profileDir: string
  packageDir: string
  profileName?: string
}

export interface FixtureProfileResult {
  profileDir: string
  packageJsonPath: string
}

/**
 * Build a fixture profile with link: package/patch and prove one owner per tool.
 * - Creates <profileDir>/package.json with link: dependency to the local package checkout.
 * - Bundles list contains exactly one owner for each compat tool.
 * - Does NOT duplicate the cordis.patch.yml row (patch is owned by the package itself).
 */
export async function createFixtureProfile(opts: CreateFixtureProfileOpts): Promise<FixtureProfileResult> {
  const { profileDir, packageDir } = opts
  if (!profileDir) throw new Error('createFixtureProfile: profileDir is required')
  if (!packageDir) throw new Error('createFixtureProfile: packageDir is required')
  mkdirSync(profileDir, { recursive: true })
  const packageJsonPath = join(profileDir, 'package.json')
  const pkg = {
    name: opts.profileName ?? 'dsh-profile-fixture',
    private: true,
    dsh: {
      profile: {
        bundles: ['@ddtcorex/dsh-maestro-memory'],
      },
    },
    dependencies: {
      '@ddtcorex/dsh-maestro-memory': `link:${packageDir}`,
    },
  }
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2), 'utf8')
  // Intentionally do NOT create cordis.patch.yml with duplicate maestro-memory row.
  // The package's own cordis.patch.yml provides it; duplicates crash loader.
  return { profileDir, packageJsonPath }
}

export interface AssertSingleOwnerOpts {
  toolOwners?: Record<string, string[]>
}

export interface AssertSingleOwnerResult {
  ok: boolean
  owners: Record<string, string>
  errors: string[]
}

/**
 * Prove one owner per compatibility tool for a fixture profile.
 * - By default derives owners from the profile's bundles (known mapping).
 * - If opts.toolOwners provided, uses that mapping to simulate duplicate detection (for tests).
 */
export async function assertSingleOwner(
  profileDir: string,
  opts?: AssertSingleOwnerOpts,
): Promise<AssertSingleOwnerResult> {
  const owners: Record<string, string> = {}
  const errors: string[] = []

  // If caller supplies explicit toolOwners mapping, use it for validation
  if (opts?.toolOwners) {
    for (const [tool, list] of Object.entries(opts.toolOwners)) {
      if (list.length === 0) continue
      if (list.length > 1) {
        errors.push(`tool "${tool}" has multiple owners: ${list.join(', ')} (duplicate owner)`)
      } else {
        owners[tool] = list[0]
      }
    }
    return { ok: errors.length === 0, owners, errors }
  }

  // Derive from profile package.json bundles
  const pkgPath = join(profileDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { ok: false, owners, errors: [`profile package.json not found: ${pkgPath}`] }
  }
  let pkg: any
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e: any) {
    return { ok: false, owners, errors: [`failed to parse package.json: ${e?.message}`] }
  }
  const bundles: string[] = pkg?.dsh?.profile?.bundles ?? []
  const deps: Record<string, string> = pkg?.dependencies ?? {}

  // For each compat tool, collect owners from bundles that claim it
  for (const tool of COMPAT_TOOLS) {
    const claimed = bundles.filter((b: string) => {
      const known = KNOWN_OWNERS[tool] ?? []
      return known.includes(b)
    })
    // Also check dependencies that are link: but not in bundles? Bundles is source of truth for loader.
    if (claimed.length === 0) {
      // tool not owned in this fixture — skip (skill_manage may be absent)
      continue
    }
    if (claimed.length > 1) {
      errors.push(`tool "${tool}" has multiple owners: ${claimed.join(', ')}`)
    } else {
      owners[tool] = claimed[0]
      // Verify dependency is link:
      const depVal = deps[claimed[0]]
      if (depVal && !depVal.startsWith('link:')) {
        errors.push(`tool "${tool}" owner ${claimed[0]} dependency is not link: (got ${depVal})`)
      }
    }
  }

  // Additional check: ensure profile does not contain duplicate patch row
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, 'utf8')
    if (text.includes('maestro-memory')) {
      errors.push('profile cordis.patch.yml must not duplicate package patch id maestro-memory')
    }
  }

  // Check that our package link exists
  const ourDep = deps['@ddtcorex/dsh-maestro-memory']
  if (!ourDep) {
    errors.push('profile missing dependency @ddtcorex/dsh-maestro-memory')
  } else if (!ourDep.startsWith('link:')) {
    errors.push(`expected link: dependency for @ddtcorex/dsh-maestro-memory, got ${ourDep}`)
  }

  return { ok: errors.length === 0, owners, errors }
}

// ---------------------------------------------------------------------------
// Copied schema fixture (not live home)
// ---------------------------------------------------------------------------

function writeLegacyMemory(file: string, entries: string[]) {
  const content = entries.length === 0 ? '' : entries.join('\n§\n') + '\n'
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
}

function writeTodoFile(file: string, entriesRaw: string[]) {
  const header = `<!--\nTodo entry format (auto-maintained by the program, do not edit the structure manually):\n- Entries are delimited by §; the comment block before the first § is the format note, not a todo\n- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):\n  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])\n  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool\n  [q1] important & urgent  [q2] important not urgent  [q3] urgent not important  [q4] not important not urgent (default = unclassified)\n  [due: YYYY-MM-DD] due date (default = none)\n  [status: pending|doing|done|blocked|cancelled] status (default pending)\n  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)\n  [cat: category] optional (life/work/study...)\n- Todo content follows the first tag line and may span multiple lines\n-->\n`
  const body = entriesRaw.join('\n§\n')
  const text = `${header}${body.length > 0 ? `\n§\n${body}\n` : ''}`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

/**
 * Populate a temp memory root with synthetic legacy files for rehearsal,
 * mirroring migration.spec's fixture but centralized for reuse.
 * This root is a *copy*, never the live ~/.dsh/memories.
 */
export async function createCopiedMemoryRoot(root: string, opts?: { cwd?: string }) {
  const cwd = opts?.cwd ?? '/tmp/proj-a'
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 12)

  // global memory
  writeLegacyMemory(join(root, 'MEMORY.md'), ['[2026-08-10] global one', '[2026-08-11] global two'])
  writeLegacyMemory(join(root, 'USER.md'), ['[2026-08-10] user one'])
  writeLegacyMemory(join(root, 'MEMORY-archive.md'), ['[2026-08-09] archived global'])
  writeLegacyMemory(join(root, 'USER-archive.md'), ['[2026-08-09] archived user'])
  // queue
  const suggestion = { target: 'memory', content: 'suggest 1', reason: 'r', time: new Date().toISOString() }
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'SUGGESTIONS.jsonl'), JSON.stringify(suggestion) + '\n', 'utf8')
  // project
  writeLegacyMemory(join(root, 'projects', hash, 'MEMORY.md'), ['[2026-08-10 10:00] project log'])
  writeLegacyMemory(join(root, 'projects', hash, 'KEY.md'), ['[2026-08-10] [branch:main] key entry', '[2026-08-10] key two'])
  writeLegacyMemory(join(root, 'projects', hash, 'KEY-archive.md'), ['[2026-08-08] old key'])
  writeFileSync(
    join(root, 'projects', hash, 'TODOS.md'),
    '<!-- header -->\n§\n[2026-08-10 10:00] [id: aabbccdd] [status: pending]\nproj todo\n',
    'utf8',
  )
  // daily
  mkdirSync(join(root, 'daily'), { recursive: true })
  writeFileSync(join(root, 'daily', '2026-08-10.md'), '[08:30] daily entry\n', 'utf8')
  writeFileSync(
    join(root, 'daily', '2026-08-10.todo.md'),
    '<!-- header -->\n§\n[2026-08-10 10:00] [id: deadbeef] [status: pending]\ndaily todo\n',
    'utf8',
  )
  // todos life/work
  writeTodoFile(join(root, 'TODOS-life.md'), ['[2026-08-10 10:00] [id: 11111111] [status: pending]\nlife todo'])
  writeTodoFile(join(root, 'TODOS-work.md'), ['[2026-08-10 10:00] [id: 22222222] [status: doing]\nwork todo'])
  writeFileSync(join(root, 'TODO-archive.md'), 'archived todo\n', 'utf8')
}
