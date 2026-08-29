import { type AutoMemoryOptions } from './auto-memory.ts';
export declare const inject: readonly ["tools", "systemPrompt", "connection"];
export interface MaestroMemoryConfig {
    memoryDir?: string | null;
    snapshotOrder?: number;
    autoMemory?: Partial<AutoMemoryOptions>;
}
export declare const DEFAULTS: Required<MaestroMemoryConfig>;
export declare const READ_ACTIONS: Set<string>;
export declare function isMemoryConcurrencySafe(args: any): boolean;
export type MemoryTarget = 'memory' | 'user' | 'project' | 'key' | 'daily';
export type MemoryAction = 'add' | 'list' | 'replace' | 'remove' | 'archive' | 'expand';
export declare function apply(ctx: any, config?: MaestroMemoryConfig): void;
//# sourceMappingURL=index.d.ts.map