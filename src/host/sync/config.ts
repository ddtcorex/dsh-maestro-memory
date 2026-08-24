import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { syncConfigPath, syncDir, syncMetaPath } from './layout.ts'

export interface SyncConfig {
  enabled: boolean
  remoteUrl: string
  branch: string
  // optional override identity not used in MVP
}

export interface SyncMeta {
  hash: string
  cwd: string
  branch: string
  remoteUrl: string
  pushedAt: string
  // snapshot of ids per track at last sync
  entryIds: Record<string, string[]>
  version: number
}

export function readConfig(root: string, hash: string): SyncConfig | null {
  const p = syncConfigPath(root, hash)
  if (!existsSync(p)) return null
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'))
    if (data.enabled !== true) return null
    if (typeof data.remoteUrl !== 'string' || typeof data.branch !== 'string') return null
    return data as SyncConfig
  } catch {
    return null
  }
}

export function isEnabled(root: string, hash: string): boolean {
  const cfg = readConfig(root, hash)
  return cfg !== null && cfg.enabled === true
}

export function writeConfig(root: string, hash: string, cfg: SyncConfig): void {
  const p = syncConfigPath(root, hash)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8')
}

export function clearConfig(root: string, hash: string): void {
  const dir = syncDir(root, hash)
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

export function readMeta(root: string, hash: string): SyncMeta | null {
  const p = syncMetaPath(root, hash)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as SyncMeta } catch { return null }
}

export function writeMeta(root: string, hash: string, meta: SyncMeta): void {
  const p = syncMetaPath(root, hash)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(meta, null, 2), 'utf8')
}

export function baseIdsFromMeta(meta: SyncMeta | null, track: string): Set<string> {
  if (!meta || !meta.entryIds || !meta.entryIds[track]) return new Set()
  return new Set(meta.entryIds[track])
}
