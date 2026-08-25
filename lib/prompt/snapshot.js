import { Buffer } from 'node:buffer';
import { entryHeadPrefix, parseEntrySummary } from "../storage/legacy-format.js";
/** Default per-section byte budgets for the snapshot prompt. */
export const SNAPSHOT_SECTION_CAPS = { memory: 2048, user: 4096, key: 6144 };
const SECTION_SEP = '\n---\n';
/** Compact an oversize entry to `head + [summary:…]` when it carries a summary tag; otherwise keep whole. */
function compactToHead(entry) {
    const summary = parseEntrySummary(entry);
    if (summary === null)
        return entry;
    return `${entryHeadPrefix(entry)}[summary:${summary}]`;
}
/**
 * Keep the newest entries whose combined UTF-8 size (with separators) fits `cap`.
 * The newest entry is always kept — compacted to its summary head when oversized
 * and tagged; untagged oversize entries stay whole rather than vanishing.
 */
function fitSection(entries, cap) {
    if (entries.length === 0)
        return [];
    const keptDesc = [];
    let used = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
        const isNewest = keptDesc.length === 0;
        let candidate = entries[i];
        if (isNewest && Buffer.byteLength(candidate, 'utf8') > cap)
            candidate = compactToHead(candidate);
        const cost = Buffer.byteLength(candidate, 'utf8') + (keptDesc.length ? SECTION_SEP.length : 0);
        if (!isNewest && used + cost > cap)
            break;
        keptDesc.push(candidate);
        used += cost;
    }
    return keptDesc.reverse();
}
/**
 * Bounded snapshot renderer — contract từ README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + end-of-turn discipline note.
 * daily và project KHÔNG inject.
 */
export function renderSnapshot(store, ctx, opts = {}) {
    const caps = { ...SNAPSHOT_SECTION_CAPS, ...opts.caps };
    const parts = [];
    // Header
    if (ctx.sessionId || ctx.sessionName) {
        const header = [
            ctx.sessionId ? `sessionId: ${ctx.sessionId}` : null,
            ctx.sessionName ? `sessionName: ${ctx.sessionName}` : null,
        ].filter(Boolean).join(' | ');
        if (header)
            parts.push(`# Session\n${header}`);
    }
    // Bounded memory sections — delegate branch filtering to store.list, then enforce byte caps
    const mem = fitSection(store.list('memory'), caps.memory);
    const user = fitSection(store.list('user'), caps.user);
    const key = ctx.cwd
        ? fitSection(store.list('key', ctx.cwd, ctx.branch ? { branch: ctx.branch } : {}), caps.key)
        : [];
    if (mem.length)
        parts.push(`# Global Memory\n${mem.join('\n---\n')}`);
    if (user.length)
        parts.push(`# User Memory\n${user.join('\n---\n')}`);
    if (key.length)
        parts.push(`# Project Key Memory\n${key.join('\n---\n')}`);
    // End-of-turn discipline note — verbatim contract (hardened: exactly once, always last)
    const discipline = `---\nEnd of every turn you must: 1. Write daily+project via memory entries (daily+project in one call) 2. Check dtodo list (bounded, max 8)`;
    // Defensive: strip any pre-existing discipline entry (should never occur — parts is fresh per call)
    // then append exactly once so the note is guaranteed last even for empty stores or repeated calls.
    const deduped = parts.filter((p) => p !== discipline);
    deduped.push(discipline);
    return deduped.join('\n\n');
}
//# sourceMappingURL=snapshot.js.map