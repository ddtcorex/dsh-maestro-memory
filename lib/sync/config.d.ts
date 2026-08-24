export interface SyncConfig {
    enabled: boolean;
    remoteUrl: string;
    branch: string;
}
export interface SyncMeta {
    hash: string;
    cwd: string;
    branch: string;
    remoteUrl: string;
    pushedAt: string;
    entryIds: Record<string, string[]>;
    version: number;
}
export declare function readConfig(root: string, hash: string): SyncConfig | null;
export declare function isEnabled(root: string, hash: string): boolean;
export declare function writeConfig(root: string, hash: string, cfg: SyncConfig): void;
export declare function clearConfig(root: string, hash: string): void;
export declare function readMeta(root: string, hash: string): SyncMeta | null;
export declare function writeMeta(root: string, hash: string, meta: SyncMeta): void;
export declare function baseIdsFromMeta(meta: SyncMeta | null, track: string): Set<string>;
//# sourceMappingURL=config.d.ts.map