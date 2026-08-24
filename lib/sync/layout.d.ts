export declare function syncDir(root: string, hash: string): string;
export declare function syncConfigPath(root: string, hash: string): string;
export declare function syncMetaPath(root: string, hash: string): string;
export declare function syncConflictsPath(root: string, hash: string): string;
export declare function syncBranchName(hash: string): string;
export declare function resolveSyncHash(cwd: string): string;
export declare function allSyncPaths(root: string, cwd: string): {
    dir: string;
    config: string;
    meta: string;
    conflicts: string;
    branch: string;
    hash: string;
};
//# sourceMappingURL=layout.d.ts.map