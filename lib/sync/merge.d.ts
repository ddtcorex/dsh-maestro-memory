/**
 * merge.ts — union merge by id, never drops either version.
 * Pure functions, no I/O.
 */
export interface ConflictRecord {
    id: string;
    track: string;
    localEntry: string | null;
    remoteEntry: string | null;
    reason: string;
}
export interface MergeResult {
    merged: string[];
    conflicts: ConflictRecord[];
    addedLocal: string[];
    addedRemote: string[];
}
/**
 * Parse entries into map id => entry. Entries without id are assigned a synthetic
 * id derived from content hash (for safety) but flagged as missing.
 */
export declare function mapById(entries: string[]): Map<string, string>;
export declare function idsOf(entries: string[]): Set<string>;
/**
 * Union merge for memory-style entries (KEY, MEMORY, archive).
 * - local + remote entries with distinct ids => union (both present)
 * - same id, same content => one entry
 * - same id, different content => conflict (neither applied, keep local)
 */
export declare function mergeMemoryEntries(opts: {
    track: string;
    local: string[];
    remote: string[];
    baseIds?: Set<string>;
}): MergeResult;
export declare function mergeTodoEntries(opts: {
    local: string[];
    remote: string[];
    baseIds?: Set<string>;
}): MergeResult;
export declare function snapshotIds(entriesByTrack: Record<string, string[]>): Record<string, string[]>;
//# sourceMappingURL=merge.d.ts.map