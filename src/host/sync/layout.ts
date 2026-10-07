import { join } from 'node:path'
import { maestroMetaDir } from '../storage/layout.ts'

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
