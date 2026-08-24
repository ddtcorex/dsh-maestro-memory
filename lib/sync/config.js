import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { syncConfigPath, syncDir, syncMetaPath } from "./layout.js";
export function readConfig(root, hash) {
    const p = syncConfigPath(root, hash);
    if (!existsSync(p))
        return null;
    try {
        const data = JSON.parse(readFileSync(p, 'utf8'));
        if (data.enabled !== true)
            return null;
        if (typeof data.remoteUrl !== 'string' || typeof data.branch !== 'string')
            return null;
        return data;
    }
    catch {
        return null;
    }
}
export function isEnabled(root, hash) {
    const cfg = readConfig(root, hash);
    return cfg !== null && cfg.enabled === true;
}
export function writeConfig(root, hash, cfg) {
    const p = syncConfigPath(root, hash);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
}
export function clearConfig(root, hash) {
    const dir = syncDir(root, hash);
    try {
        rmSync(dir, { recursive: true, force: true });
    }
    catch { }
}
export function readMeta(root, hash) {
    const p = syncMetaPath(root, hash);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
export function writeMeta(root, hash, meta) {
    const p = syncMetaPath(root, hash);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(meta, null, 2), 'utf8');
}
export function baseIdsFromMeta(meta, track) {
    if (!meta || !meta.entryIds || !meta.entryIds[track])
        return new Set();
    return new Set(meta.entryIds[track]);
}
//# sourceMappingURL=config.js.map