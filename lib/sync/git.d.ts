/**
 * git.ts — Git adapter abstraction. Disabled => zero spawn.
 * Real adapter uses child_process git with file:// remotes via --git-dir show.
 * Mock adapter is in-memory for tests.
 */
export interface GitAdapter {
    /** Fetch remote branch, return ok/error */
    fetch(remoteUrl: string, branch: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** Push files to remote branch (commit & push). files keys are branch-root paths e.g. KEY.md */
    push(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** Get remote branch files (read). */
    getRemoteFiles(remoteUrl: string, branch: string): Promise<{
        ok: true;
        files: Record<string, string>;
    } | {
        ok: false;
        error: string;
    }>;
}
/**
 * MockGitAdapter — in-memory remote, tracks calls for disabled assertions.
 */
export declare class MockGitAdapter implements GitAdapter {
    remotes: Map<string, Map<string, Record<string, string>>>;
    calls: Array<{
        method: string;
        remoteUrl: string;
        branch: string;
    }>;
    failNextFetch: string | null;
    failNextPush: string | null;
    failNextGet: string | null;
    fetch(remoteUrl: string, branch: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    push(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    getRemoteFiles(remoteUrl: string, branch: string): Promise<{
        ok: true;
        files: Record<string, string>;
    } | {
        ok: false;
        error: string;
    }>;
    setRemoteFiles(remoteUrl: string, branch: string, files: Record<string, string>): void;
    getRemoteFilesSync(remoteUrl: string, branch: string): Record<string, string> | undefined;
    reset(): void;
}
/**
 * RealGitAdapter — uses git CLI for file:// remotes.
 * For http/ssh remotes it delegates to git fetch/push via temp clone.
 * Minimal implementation sufficient for integration tests with file:// bare remotes.
 */
export declare class RealGitAdapter implements GitAdapter {
    fetch(remoteUrl: string, branch: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    getRemoteFiles(remoteUrl: string, branch: string): Promise<{
        ok: true;
        files: Record<string, string>;
    } | {
        ok: false;
        error: string;
    }>;
    push(remoteUrl: string, branch: string, files: Record<string, string>, message: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    private resolveFileUrl;
    private getFilesFromBare;
    private pushToBare;
    private getFilesViaClone;
    private pushViaClone;
}
//# sourceMappingURL=git.d.ts.map