export declare const inject: readonly ["tools", "systemPrompt", "workspaceRegistry", "connection"];
export interface MaestroMemoryConfig {
    memoryDir?: string | null;
    snapshotOrder?: number;
}
export declare const DEFAULTS: Required<MaestroMemoryConfig>;
export type MemoryTarget = 'memory' | 'user' | 'project' | 'key' | 'daily';
export type MemoryAction = 'add' | 'list' | 'replace' | 'remove' | 'archive' | 'expand';
export declare function apply(ctx: any, config?: MaestroMemoryConfig): void;
//# sourceMappingURL=index.d.ts.map