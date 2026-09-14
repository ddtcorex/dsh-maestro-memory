/**
 * repair-runner.ts — enumerate the memory store from disk and repair every
 * track file in one pass.
 *
 * The enumeration is deliberately disk-driven, not a hard-coded key list: the
 * corruption this repairs (glued and duplicated entries) was written by a
 * migration pass, so the repair must cover whatever files that pass could have
 * touched — including projects nobody remembers creating.
 *
 * `dryRun` shares the pure planner instead of `store.repairFile` so a preview
 * never takes the write lock and never mints a backup.
 *
 * @module memory/repair-runner
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MaestroMemoryStore } from './store.ts'
import { planRepair } from '../storage/repair.ts'
import { dailyDir, globalMemoryPath, lifeTodoPath, userMemoryPath, workTodoPath } from '../storage/layout.ts'

export interface RepairDetail {
  path: string
  before: number
  after: number
  split: number
  deduped: number
  relocated: number
}

export interface RepairReport {
  files: number
  changed: number
  before: number
  after: number
  split: number
  deduped: number
  relocated: number
  details: RepairDetail[]
}

const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}(\.todo)?\.md$/

/** Every existing store file the repair pass covers. */
export function collectRepairTargets(root: string): string[] {
  const out: string[] = []
  const push = (p: string) => {
    try {
      if (existsSync(p) && statSync(p).isFile()) out.push(p)
    } catch {}
  }

  push(globalMemoryPath(root))
  push(userMemoryPath(root))
  push(lifeTodoPath(root))
  push(workTodoPath(root))

  const daily = dailyDir(root)
  try {
    for (const name of readdirSync(daily)) if (DAILY_FILE_RE.test(name)) push(join(daily, name))
  } catch {}

  // Project directories are named by sha1(cwd)[:12], which is one-way: a hash
  // read from disk cannot be turned back into a cwd. Repair does not need the
  // cwd — only the directory — so it walks `projects/<hash>/` directly instead
  // of going through the hash-based layout helpers.
  const projects = join(root, 'projects')
  try {
    for (const hash of readdirSync(projects)) {
      const dir = join(projects, hash)
      push(join(dir, 'MEMORY.md'))
      push(join(dir, 'KEY.md'))
      push(join(dir, 'TODOS.md'))
    }
  } catch {}

  return [...new Set(out)]
}

/** Repair every existing store file. `dryRun` plans without writing. */
export function repairAllTracks(root: string, opts: { dryRun?: boolean } = {}): RepairReport {
  const store = new MaestroMemoryStore(root)
  const targets = collectRepairTargets(root)
  const report: RepairReport = { files: 0, changed: 0, before: 0, after: 0, split: 0, deduped: 0, relocated: 0, details: [] }
  for (const path of targets) {
    report.files += 1
    if (opts.dryRun) {
      let raw = ''
      try {
        raw = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      const plan = planRepair(raw)
      report.before += plan.before
      report.after += plan.after
      report.split += plan.split
      report.deduped += plan.deduped
      report.relocated += plan.relocated
      if (plan.changed) {
        report.changed += 1
        report.details.push({ path, before: plan.before, after: plan.after, split: plan.split, deduped: plan.deduped, relocated: plan.relocated })
      }
      continue
    }
    const res = store.repairFile(path)
    if (!res.ok) continue
    report.before += res.before
    report.after += res.after
    report.split += res.split
    report.deduped += res.deduped
    report.relocated += res.relocated
    if (res.changed) {
      report.changed += 1
      report.details.push({ path, before: res.before, after: res.after, split: res.split, deduped: res.deduped, relocated: res.relocated })
    }
  }
  return report
}
