import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { entryHeadPrefix, parseEntrySummary } from "../storage/legacy-format.js";
import { projectReferencePath, userMemoryPath } from "../storage/layout.js";
import { appendEntryAtomicSync } from "../storage/atomic-store.js";
/** Default per-section byte budgets for the snapshot prompt. */
export const SNAPSHOT_SECTION_CAPS = { memory: 2048, user: 4096, key: 6144, recentDaily: 512, autoRecall: 1024 };
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
 * Bounded snapshot renderer — contract from README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + Project Context (auto-recall top-4, 600 chars each)
 * + Recent Daily + end-of-turn discipline note.
 * Full daily/project logs are query-only; only the bounded recall slices are injected.
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
    let user = fitSection(store.list('user'), caps.user);
    // Bootstrap USER.md from session context when missing/empty (no profile file yet)
    if (user.length === 0 && (ctx.sessionName || ctx.sessionId)) {
        try {
            const userFile = userMemoryPath(store.resolveRoot());
            if (!existsSync(userFile) || readFileSync(userFile, 'utf8').trim() === '') {
                const stamp = new Date().toISOString().slice(0, 10);
                const profileLines = [];
                if (ctx.sessionName)
                    profileLines.push(`Session: ${ctx.sessionName}`);
                if (ctx.sessionId)
                    profileLines.push(`Session ID: ${ctx.sessionId}`);
                if (profileLines.length) {
                    const bootEntry = `[${stamp}] ${profileLines.join('; ')}`;
                    appendEntryAtomicSync(userFile, bootEntry);
                    user = fitSection(store.list('user'), caps.user);
                }
            }
        }
        catch { }
    }
    const key = ctx.cwd
        ? fitSection(store.list('key', ctx.cwd, ctx.branch ? { branch: ctx.branch } : {}), caps.key)
        : [];
    if (mem.length)
        parts.push(`# Global Memory\n${mem.join('\n---\n')}`);
    if (user.length)
        parts.push(`# User Memory\n${user.join('\n---\n')}`);
    if (key.length)
        parts.push(`# Project Key Memory\n${key.join('\n---\n')}`);
    // Auto-recall: newest 4 project entries for current cwd, each truncated to 600 chars
    // Mirrors dsh-memory timeline(limit:4, 600 chars) but file-native, no Python.
    if (ctx.cwd) {
        try {
            const proj = store.list('project', ctx.cwd);
            if (proj.length) {
                const newest4 = proj.slice(-4).map((e) => e.slice(0, 600));
                const fitted = fitSection(newest4, caps.autoRecall ?? 1024);
                if (fitted.length)
                    parts.push(`# Project Context\n${fitted.join('\n---\n')}`);
            }
        }
        catch { }
        // Bounded REFERENCE.md slice — project's curated knowledge (hybrid: invariants in KEY, narrative here)
        // Only injects the top 2048 bytes so large references stay out of context but remain discoverable.
        try {
            const refPath = projectReferencePath(store.resolveRoot(), ctx.cwd);
            if (existsSync(refPath)) {
                const refContent = readFileSync(refPath, 'utf8');
                const slice = refContent.slice(0, 2048);
                if (slice.trim().length > 0)
                    parts.push(`# Project Knowledge\n${slice}`);
            }
        }
        catch { }
    }
    // Recent daily slot (512B) — last 2 days' newest entries
    // Keeps recent context without exceeding cap; full logs remain query-only.
    // Use local calendar (matching store.todayStamp) to avoid UTC/local drift near midnight.
    try {
        const recentDaily = [];
        for (let i = 0; i < 2; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const ds = `${d.getFullYear()}-${mm}-${dd}`;
            try {
                const list = store.list('daily', undefined, { date: ds });
                if (list.length)
                    recentDaily.push(list[list.length - 1]);
            }
            catch { }
        }
        if (recentDaily.length) {
            const fitted = fitSection(recentDaily, caps.recentDaily);
            if (fitted.length)
                parts.push(`# Recent Daily\n${fitted.join('\n---\n')}`);
        }
    }
    catch { }
    // End-of-turn discipline note — verbatim contract (hardened: exactly once, always last)
    // Conditional to avoid idle loops: only when turn produced meaningful progress.
    // Updated 2026-09-05: reality is daily-only (project MEMORY.md stays timeline-log, not entries);
    // durable decisions go through memory_suggest target=key, not memory add.
    const discipline = `---\nEnd of every turn — if this turn produced meaningful progress (code, decisions, learnings, or next steps): 1. Write daily via memory entries (daily in one call, skip if idle/waiting or no new information — never write entries containing only 'Idle' or placeholders). 2. For important project decisions (convention, incident, infra) use memory_suggest target=key with reason, not memory add. 3. Check dtodo list only if relevant (bounded, max 8).`;
    // Defensive: strip any pre-existing discipline entry (should never occur — parts is fresh per call)
    // then append exactly once so the note is guaranteed last even for empty stores or repeated calls.
    const deduped = parts.filter((p) => p !== discipline);
    deduped.push(discipline);
    return deduped.join('\n\n');
}
//# sourceMappingURL=snapshot.js.map