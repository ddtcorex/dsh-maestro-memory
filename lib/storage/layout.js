/**
 * storage/layout.ts — path resolution for five memory files, four todo files,
 * archives, metadata, and legacy project hash.
 * Pure, no Cordis import. Uses node:path + node:crypto.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** Resolve the canonical memories root: config.memoryDir or ~/.dsh/memories */
export function resolveMemoryRoot(memoryDir) {
    if (memoryDir)
        return memoryDir;
    return join(homedir(), '.dsh', 'memories');
}
/** 12-hex project hash for a cwd (sha1(cwd).slice(0,12)) */
export function projectHash(cwd) {
    if (!cwd)
        throw new Error('projectHash: cwd is required');
    return createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}
/** Legacy alias — same as projectHash, explicit for spec compliance. */
export const legacyProjectHash = projectHash;
export function globalMemoryPath(root) {
    return join(root, 'MEMORY.md');
}
export function userMemoryPath(root) {
    return join(root, 'USER.md');
}
export function globalArchivePath(root) {
    return join(root, 'MEMORY-archive.md');
}
export function userArchivePath(root) {
    return join(root, 'USER-archive.md');
}
export function suggestionsPath(root) {
    return join(root, 'SUGGESTIONS.jsonl');
}
export function dailyDir(root) {
    return join(root, 'daily');
}
/** Reject non-YYYY-MM-DD values before they are interpolated into a path (path-traversal guard). */
function assertDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`invalid date "${date}" (expected YYYY-MM-DD)`);
    }
}
export function dailyPath(root, date) {
    assertDate(date);
    return join(root, 'daily', `${date}.md`);
}
export function dailyTodoPath(root, date) {
    assertDate(date);
    return join(root, 'daily', `${date}.todo.md`);
}
export function projectDir(root, cwd) {
    return join(root, 'projects', projectHash(cwd));
}
export function projectMemoryPath(root, cwd) {
    return join(projectDir(root, cwd), 'MEMORY.md');
}
export function projectKeyPath(root, cwd) {
    return join(projectDir(root, cwd), 'KEY.md');
}
export function projectReferencePath(root, cwd) {
    return join(projectDir(root, cwd), 'REFERENCE.md');
}
export function projectKeyArchivePath(root, cwd) {
    return join(projectDir(root, cwd), 'KEY-archive.md');
}
export function projectArchivePath(root, cwd) {
    if (!cwd)
        throw new Error('projectArchivePath: cwd is required');
    return join(projectDir(root, cwd), 'MEMORY-archive.md');
}
export function projectArchiveDir(root, cwd) {
    if (!cwd)
        throw new Error('projectArchiveDir: cwd is required');
    return projectDir(root, cwd);
}
export function projectTodoPath(root, cwd) {
    return join(projectDir(root, cwd), 'TODOS.md');
}
export function lifeTodoPath(root) {
    return join(root, 'TODOS-life.md');
}
export function workTodoPath(root) {
    return join(root, 'TODOS-work.md');
}
export function maestroMetaDir(root) {
    return join(root, '.maestro-memory');
}
export function schemaPath(root) {
    return join(maestroMetaDir(root), 'schema.json');
}
export function journalPath(root) {
    return join(maestroMetaDir(root), 'migration-journal.jsonl');
}
export function backupsDir(root) {
    return join(maestroMetaDir(root), 'backups');
}
export function todoArchivePath(root) {
    return join(root, 'TODO-archive.md');
}
export function backupManifestPath(root, runId) {
    if (!runId)
        throw new Error('backupManifestPath: runId is required');
    return join(backupsDir(root), runId, 'manifest.json');
}
export function backupFilesDirPath(root, runId) {
    if (!runId)
        throw new Error('backupFilesDirPath: runId is required');
    return join(backupsDir(root), runId, 'files');
}
// ---------------------------------------------------------------------------
// Aggregated pure resolvers — convenience for inspectors/migration
// ---------------------------------------------------------------------------
/**
 * Resolve all five memory files at once (pure).
 */
export function allMemoryPaths(root, cwd, date) {
    return {
        memory: globalMemoryPath(root),
        user: userMemoryPath(root),
        daily: dailyPath(root, date),
        project: projectMemoryPath(root, cwd),
        key: projectKeyPath(root, cwd),
    };
}
/**
 * Resolve all four todo files at once (pure).
 */
export function allTodoPaths(root, cwd, date) {
    return {
        life: lifeTodoPath(root),
        work: workTodoPath(root),
        project: projectTodoPath(root, cwd),
        daily: dailyTodoPath(root, date),
    };
}
/**
 * Resolve all archive files at once (pure).
 */
export function allArchivePaths(root, cwd) {
    return {
        memory: globalArchivePath(root),
        user: userArchivePath(root),
        key: projectKeyArchivePath(root, cwd),
        todo: todoArchivePath(root),
        projectMemoryArchive: projectArchivePath(root, cwd),
    };
}
/**
 * Resolve metadata files at once (pure).
 */
export function allMetadataPaths(root, runId) {
    const meta = maestroMetaDir(root);
    const bDir = backupsDir(root);
    return {
        metaDir: meta,
        schema: schemaPath(root),
        journal: journalPath(root),
        backupsDir: bDir,
        backupManifest: runId ? backupManifestPath(root, runId) : undefined,
        backupFilesDir: runId ? backupFilesDirPath(root, runId) : undefined,
    };
}
// Aliases for spec compatibility (different naming conventions)
export const resolveMemoryFiles = allMemoryPaths;
export const resolveTodoFiles = allTodoPaths;
export const resolveArchiveFiles = allArchivePaths;
export const resolveMetadataFiles = allMetadataPaths;
export const getMemoryPaths = allMemoryPaths;
export const getTodoPaths = allTodoPaths;
export const getArchivePaths = allArchivePaths;
export const getMetadataPaths = allMetadataPaths;
//# sourceMappingURL=layout.js.map