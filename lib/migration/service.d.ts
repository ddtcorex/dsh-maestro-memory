/**
 * migration/service.ts — inspect/dryRun/run/verify, backup manifest, journal, write-block on mismatch
 *
 * Implements M3-PR-B migration engine: in-place adoption, byte-preserving backup,
 * SHA-256 verified, parser inventory, malformed JSONL tolerant, missing optional files tolerant,
 * noncanonical/lock warnings, and write-block on verify mismatch.
 */
export interface FileInfo {
    path: string;
    relative: string;
    exists: boolean;
    bytes: number;
    sha256: string | null;
    kind: string;
    entries?: number;
    ids?: string[];
    malformedLines?: number;
    valid?: number;
    warning?: string | null;
}
export interface InspectResult {
    ok: boolean;
    root: string;
    files: FileInfo[];
    inventory: {
        memoryEntries: number;
        todoIds: string[];
        todoIdsCount: number;
        todoCount: number;
        queueValid: number;
        queueMalformed: number;
        dailyFiles: number;
        projectDirs: number;
    } & Record<string, any>;
    warnings: string[];
    errors: string[];
}
export declare function inspect(memoryDir?: string | null | undefined): Promise<InspectResult>;
export declare function dryRun(memoryDir?: string | null | undefined): Promise<InspectResult>;
export interface RunResult {
    ok: boolean;
    runId: string;
    manifestPath: string;
    backupFilesDir: string;
    warnings: string[];
    errors: string[];
    files: FileInfo[];
}
export declare function run(memoryDir?: string | null | undefined): Promise<RunResult>;
export interface VerifyResult {
    ok: boolean;
    runId: string;
    manifestPath: string;
    mismatches: string[];
    warnings: string[];
}
export declare function verify(memoryDir?: string | null | undefined, runId?: string): Promise<VerifyResult>;
export declare function isWriteBlocked(memoryDir?: string | null | undefined): boolean;
export declare function clearWriteBlock(memoryDir?: string | null | undefined): void;
export interface RollbackResult {
    ok: boolean;
    runId: string;
    manifestPath: string;
    restored: number;
    errors: string[];
}
/**
 * Restore files from a backup manifest byte-identical.
 * Used for M4-PR-A rehearsal: exercise and test rollback against copied schema.
 * - Restores each existing file from backupFilesDir/<relative> to its original path.
 * - Removes files that appeared after backup if they were absent at backup time.
 * - Clears write-block and appends journal entry on success.
 */
export declare function rollback(memoryDir?: string | null | undefined, runId?: string): Promise<RollbackResult>;
//# sourceMappingURL=service.d.ts.map