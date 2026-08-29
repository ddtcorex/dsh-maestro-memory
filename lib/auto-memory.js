/**
 * auto-memory.ts — opt-in automatic session/event → memory persistence.
 * Ported from FuRongJun-1999/dsh-memory hooks.ts (memory hooks) but
 * file-native (MaestroMemoryStore) and English-only.
 */
import { desensitize } from "./memory/sanitize.js";
export const DEFAULT_AUTO_MEMORY = {
    enabled: false,
    userMessage: true,
    assistantMessage: false,
    toolResult: false,
    importance: 0.6,
    desensitize: true,
};
function extractText(blocks) {
    if (!Array.isArray(blocks))
        return '';
    const parts = [];
    for (const b of blocks) {
        if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
            parts.push(b.text);
    }
    return parts.join('\n').trim();
}
function sanitize(text, doDesensitize) {
    if (!doDesensitize)
        return text;
    return desensitize(text);
}
/**
 * Install session/event hooks for auto-memory.
 * Returns a disposer (ctx.on returns disposer in Cordis 4).
 */
export function installAutoMemoryHooks(ctx, store, opts) {
    if (!opts.enabled)
        return () => { };
    const disposers = [];
    const onEvent = (_session, event) => {
        try {
            const cwd = _session?.header?.cwd ?? _session?.cwd ?? undefined;
            if (event?.type === 'user/message' && opts.userMessage) {
                if (event?.data?.source?.kind !== undefined && event.data.source.kind !== 'user')
                    return;
                const text = extractText(event?.data?.content ?? []);
                if (!text)
                    return;
                const safe = sanitize(text, opts.desensitize);
                if (safe === null)
                    return;
                // Prefer project track when cwd present, else daily
                if (cwd)
                    store.add('project', safe, cwd, { desensitize: false });
                else
                    store.add('daily', safe, undefined, { desensitize: false });
            }
            else if (event?.type === 'assistant/message' && opts.assistantMessage) {
                const text = extractText(event?.data?.message?.content ?? event?.data?.content ?? []);
                if (!text)
                    return;
                const safe = sanitize(text, opts.desensitize);
                if (safe === null)
                    return;
                if (cwd)
                    store.add('project', safe, cwd, { desensitize: false });
                else
                    store.add('daily', safe, undefined, { desensitize: false });
            }
            else if (event?.type === 'tool/result' && opts.toolResult) {
                if (event?.data?.error)
                    return;
                const text = extractText(event?.data?.message?.content ?? []);
                if (!text)
                    return;
                const safe = sanitize(text, opts.desensitize);
                if (safe === null)
                    return;
                if (cwd)
                    store.add('project', safe, cwd, { desensitize: false });
                else
                    store.add('daily', safe, undefined, { desensitize: false });
            }
        }
        catch {
            // auto-memory is best-effort, never throw
        }
    };
    // Cordis: ctx.on returns a disposer; wrap in effect-style
    try {
        const d = ctx.on('session/event', onEvent);
        if (typeof d === 'function')
            disposers.push(d);
    }
    catch {
        // host without session service (tests) — no-op
    }
    return () => {
        for (const d of disposers) {
            try {
                d();
            }
            catch { }
        }
    };
}
//# sourceMappingURL=auto-memory.js.map