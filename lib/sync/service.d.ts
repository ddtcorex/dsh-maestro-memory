import { SyncMeta } from './config.ts';
import type { GitAdapter } from './git.ts';
export declare class SyncService {
    private readonly memoryDir;
    private readonly git;
    constructor(memoryDir?: string | null, git?: GitAdapter);
    private root;
    private hashFor;
    enable(cwd: string, remoteUrl: string, branch?: string): {
        ok: true;
        hash: string;
    } | {
        ok: false;
        error: string;
    };
    disable(cwd: string): {
        ok: true;
    } | {
        ok: false;
        error: string;
    };
    isEnabled(cwd: string): boolean;
    status(cwd: string, reveal?: boolean): {
        enabled: boolean;
        branch?: string;
        remoteUrl?: string;
        remoteRedacted?: string;
        lastSync?: SyncMeta | null;
        conflicts: any[];
    };
    listConflicts(cwd: string): any[];
    private writeConflicts;
    private appendConflict;
    private localFiles;
    private writeLocalFiles;
    fetch(cwd: string): Promise<{
        ok: true;
        conflicts: any[];
        remoteFiles: Record<string, string>;
        status: string;
    } | {
        ok: false;
        error: string;
    }>;
    push(cwd: string, message?: string): Promise<{
        ok: true;
        pushed: boolean;
        conflicts: any[];
    } | {
        ok: false;
        error: string;
        conflicts?: any[];
    }>;
    pull(cwd: string): Promise<{
        ok: true;
        merged: boolean;
        conflicts: any[];
    } | {
        ok: false;
        error: string;
        conflicts?: any[];
    }>;
    resolve(cwd: string, id: string, choice: 'local' | 'remote' | 'both'): {
        ok: true;
    } | {
        ok: false;
        error: string;
    };
}
//# sourceMappingURL=service.d.ts.map