import { join } from 'node:path'
import { maestroMetaDir, projectHash } from '../storage/layout.ts'

export function syncDir(root: string, hash: string): string {
  return join(maestroMetaDir(root), 'sync', hash)
}

export function syncConfigPath(root: string, hash: string): string {
  return join(syncDir(root, hash), 'config.json')
}

export function syncMetaPath(root: string, hash: string): string {
  return join(syncDir(root, hash), 'lastSync.json')
}

export function syncConflictsPath(root: string, hash: string): string {
  return join(syncDir(root, hash), 'conflicts.jsonl')
}

export function syncBranchName(hash: string): string {
  return `maestro-memory/${hash}`
}

export function resolveSyncHash(cwd: string): string {
  return projectHash(cwd)
}

// aggregated for tests
export function allSyncPaths(root: string, cwd: string) {
  const hash = projectHash(cwd)
  return {
    dir: syncDir(root, hash),
    config: syncConfigPath(root, hash),
    meta: syncMetaPath(root, hash),
    conflicts: syncConflictsPath(root, hash),
    branch: syncBranchName(hash),
    hash,
  }
}
