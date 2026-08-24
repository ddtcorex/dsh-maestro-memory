import { join } from 'node:path';
import { maestroMetaDir, projectHash } from "../storage/layout.js";
export function syncDir(root, hash) {
    return join(maestroMetaDir(root), 'sync', hash);
}
export function syncConfigPath(root, hash) {
    return join(syncDir(root, hash), 'config.json');
}
export function syncMetaPath(root, hash) {
    return join(syncDir(root, hash), 'lastSync.json');
}
export function syncConflictsPath(root, hash) {
    return join(syncDir(root, hash), 'conflicts.jsonl');
}
export function syncBranchName(hash) {
    return `maestro-memory/${hash}`;
}
export function resolveSyncHash(cwd) {
    return projectHash(cwd);
}
// aggregated for tests
export function allSyncPaths(root, cwd) {
    const hash = projectHash(cwd);
    return {
        dir: syncDir(root, hash),
        config: syncConfigPath(root, hash),
        meta: syncMetaPath(root, hash),
        conflicts: syncConflictsPath(root, hash),
        branch: syncBranchName(hash),
        hash,
    };
}
//# sourceMappingURL=layout.js.map