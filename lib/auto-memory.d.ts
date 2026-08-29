/**
 * auto-memory.ts — opt-in automatic session/event → memory persistence.
 * Ported from FuRongJun-1999/dsh-memory hooks.ts (memory hooks) but
 * file-native (MaestroMemoryStore) and English-only.
 */
import type { MaestroMemoryStore } from './memory/store.ts';
export interface AutoMemoryOptions {
    enabled: boolean;
    userMessage: boolean;
    assistantMessage: boolean;
    toolResult: boolean;
    importance: number;
    desensitize: boolean;
}
export declare const DEFAULT_AUTO_MEMORY: AutoMemoryOptions;
/**
 * Install session/event hooks for auto-memory.
 * Returns a disposer (ctx.on returns disposer in Cordis 4).
 */
export declare function installAutoMemoryHooks(ctx: any, store: MaestroMemoryStore, opts: AutoMemoryOptions): () => void;
//# sourceMappingURL=auto-memory.d.ts.map