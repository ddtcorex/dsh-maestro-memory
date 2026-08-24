/**
 * storage/layout.ts — path resolution for five memory files, four todo files,
 * archives, metadata, and legacy project hash.
 * Pure, no Cordis import. Uses node:path + node:crypto.
 */

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolve the canonical memories root: config.memoryDir or ~/.dsh/memories */
export function resolveMemoryRoot(memoryDir: string | null | undefined): string {
  if (memoryDir) return memoryDir
  return join(homedir(), '.dsh', 'memories')
}

/** 12-hex project hash for a cwd (sha1(cwd).slice(0,12)) */
export function projectHash(cwd: string): string {
  if (!cwd) throw new Error('projectHash: cwd is required')
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}

/** Legacy alias — same as projectHash, explicit for spec compliance. */
export const legacyProjectHash = projectHash

export function globalMemoryPath(root: string): string {
  return join(root, 'MEMORY.md')
}
export function userMemoryPath(root: string): string {
  return join(root, 'USER.md')
}
export function globalArchivePath(root: string): string {
  return join(root, 'MEMORY-archive.md')
}
export function userArchivePath(root: string): string {
  return join(root, 'USER-archive.md')
}
export function suggestionsPath(root: string): string {
  return join(root, 'SUGGESTIONS.jsonl')
}
export function dailyDir(root: string): string {
  return join(root, 'daily')
}
export function dailyPath(root: string, date: string): string {
  return join(root, 'daily', `${date}.md`)
}
export function dailyTodoPath(root: string, date: string): string {
  return join(root, 'daily', `${date}.todo.md`)
}
export function projectDir(root: string, cwd: string): string {
  return join(root, 'projects', projectHash(cwd))
}
export function projectMemoryPath(root: string, cwd: string): string {
  return join(projectDir(root, cwd), 'MEMORY.md')
}
export function projectKeyPath(root: string, cwd: string): string {
  return join(projectDir(root, cwd), 'KEY.md')
}
export function projectKeyArchivePath(root: string, cwd: string): string {
  return join(projectDir(root, cwd), 'KEY-archive.md')
}
export function projectTodoPath(root: string, cwd: string): string {
  return join(projectDir(root, cwd), 'TODOS.md')
}
export function lifeTodoPath(root: string): string {
  return join(root, 'TODOS-life.md')
}
export function workTodoPath(root: string): string {
  return join(root, 'TODOS-work.md')
}
export function maestroMetaDir(root: string): string {
  return join(root, '.maestro-memory')
}
export function schemaPath(root: string): string {
  return join(maestroMetaDir(root), 'schema.json')
}
export function journalPath(root: string): string {
  return join(maestroMetaDir(root), 'migration-journal.jsonl')
}
export function backupsDir(root: string): string {
  return join(maestroMetaDir(root), 'backups')
}
export function todoArchivePath(root: string): string {
  return join(root, 'TODO-archive.md')
}
export function backupManifestPath(root: string, runId: string): string {
  if (!runId) throw new Error('backupManifestPath: runId is required')
  return join(backupsDir(root), runId, 'manifest.json')
}
export function backupFilesDirPath(root: string, runId: string): string {
  if (!runId) throw new Error('backupFilesDirPath: runId is required')
  return join(backupsDir(root), runId, 'files')
}

// ---------------------------------------------------------------------------
// Aggregated pure resolvers — convenience for inspectors/migration
// ---------------------------------------------------------------------------

/**
 * Resolve all five memory files at once (pure).
 */
export function allMemoryPaths(root: string, cwd: string, date: string): {
  memory: string
  user: string
  daily: string
  project: string
  key: string
} {
  return {
    memory: globalMemoryPath(root),
    user: userMemoryPath(root),
    daily: dailyPath(root, date),
    project: projectMemoryPath(root, cwd),
    key: projectKeyPath(root, cwd),
  }
}

/**
 * Resolve all four todo files at once (pure).
 */
export function allTodoPaths(root: string, cwd: string, date: string): {
  life: string
  work: string
  project: string
  daily: string
} {
  return {
    life: lifeTodoPath(root),
    work: workTodoPath(root),
    project: projectTodoPath(root, cwd),
    daily: dailyTodoPath(root, date),
  }
}

/**
 * Resolve all archive files at once (pure).
 */
export function allArchivePaths(root: string, cwd: string): {
  memory: string
  user: string
  key: string
  todo: string
} {
  return {
    memory: globalArchivePath(root),
    user: userArchivePath(root),
    key: projectKeyArchivePath(root, cwd),
    todo: todoArchivePath(root),
  }
}

/**
 * Resolve metadata files at once (pure).
 */
export function allMetadataPaths(root: string, runId?: string): {
  metaDir: string
  schema: string
  journal: string
  backupsDir: string
  backupManifest: string | undefined
  backupFilesDir: string | undefined
} {
  const meta = maestroMetaDir(root)
  const bDir = backupsDir(root)
  return {
    metaDir: meta,
    schema: schemaPath(root),
    journal: journalPath(root),
    backupsDir: bDir,
    backupManifest: runId ? backupManifestPath(root, runId) : undefined,
    backupFilesDir: runId ? backupFilesDirPath(root, runId) : undefined,
  }
}

// Aliases for spec compatibility (different naming conventions)
export const resolveMemoryFiles = allMemoryPaths
export const resolveTodoFiles = allTodoPaths
export const resolveArchiveFiles = allArchivePaths
export const resolveMetadataFiles = allMetadataPaths
export const getMemoryPaths = allMemoryPaths
export const getTodoPaths = allTodoPaths
export const getArchivePaths = allArchivePaths
export const getMetadataPaths = allMetadataPaths
