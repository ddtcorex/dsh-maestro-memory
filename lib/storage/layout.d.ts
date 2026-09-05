/**
 * storage/layout.ts — path resolution for five memory files, four todo files,
 * archives, metadata, and legacy project hash.
 * Pure, no Cordis import. Uses node:path + node:crypto.
 */
/** Resolve the canonical memories root: config.memoryDir or ~/.dsh/memories */
export declare function resolveMemoryRoot(memoryDir: string | null | undefined): string;
/** 12-hex project hash for a cwd (sha1(cwd).slice(0,12)) */
export declare function projectHash(cwd: string): string;
/** Legacy alias — same as projectHash, explicit for spec compliance. */
export declare const legacyProjectHash: typeof projectHash;
export declare function globalMemoryPath(root: string): string;
export declare function userMemoryPath(root: string): string;
export declare function globalArchivePath(root: string): string;
export declare function userArchivePath(root: string): string;
export declare function suggestionsPath(root: string): string;
export declare function dailyDir(root: string): string;
export declare function dailyPath(root: string, date: string): string;
export declare function dailyTodoPath(root: string, date: string): string;
export declare function projectDir(root: string, cwd: string): string;
export declare function projectMemoryPath(root: string, cwd: string): string;
export declare function projectKeyPath(root: string, cwd: string): string;
export declare function projectReferencePath(root: string, cwd: string): string;
export declare function projectKeyArchivePath(root: string, cwd: string): string;
export declare function projectArchivePath(root: string, cwd: string): string;
export declare function projectArchiveDir(root: string, cwd: string): string;
export declare function projectTodoPath(root: string, cwd: string): string;
export declare function lifeTodoPath(root: string): string;
export declare function workTodoPath(root: string): string;
export declare function maestroMetaDir(root: string): string;
export declare function schemaPath(root: string): string;
export declare function journalPath(root: string): string;
export declare function backupsDir(root: string): string;
export declare function todoArchivePath(root: string): string;
export declare function backupManifestPath(root: string, runId: string): string;
export declare function backupFilesDirPath(root: string, runId: string): string;
/**
 * Resolve all five memory files at once (pure).
 */
export declare function allMemoryPaths(root: string, cwd: string, date: string): {
    memory: string;
    user: string;
    daily: string;
    project: string;
    key: string;
};
/**
 * Resolve all four todo files at once (pure).
 */
export declare function allTodoPaths(root: string, cwd: string, date: string): {
    life: string;
    work: string;
    project: string;
    daily: string;
};
/**
 * Resolve all archive files at once (pure).
 */
export declare function allArchivePaths(root: string, cwd: string): {
    memory: string;
    user: string;
    key: string;
    todo: string;
    projectMemoryArchive: string;
};
/**
 * Resolve metadata files at once (pure).
 */
export declare function allMetadataPaths(root: string, runId?: string): {
    metaDir: string;
    schema: string;
    journal: string;
    backupsDir: string;
    backupManifest: string | undefined;
    backupFilesDir: string | undefined;
};
export declare const resolveMemoryFiles: typeof allMemoryPaths;
export declare const resolveTodoFiles: typeof allTodoPaths;
export declare const resolveArchiveFiles: typeof allArchivePaths;
export declare const resolveMetadataFiles: typeof allMetadataPaths;
export declare const getMemoryPaths: typeof allMemoryPaths;
export declare const getTodoPaths: typeof allTodoPaths;
export declare const getArchivePaths: typeof allArchivePaths;
export declare const getMetadataPaths: typeof allMetadataPaths;
//# sourceMappingURL=layout.d.ts.map