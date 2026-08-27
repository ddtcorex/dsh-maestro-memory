/**
 * host/skills-browser.ts — M6 read-first skills browser
 *
 * Goal: expose existing Maestro skills without taking ownership.
 * - Confirm boundary with maestro-skills and list metadata/origin only.
 * - Read-only: no mutation, no write API.
 * - Model suggestions cannot change skills.
 * - Browser cannot alter maestro-skills discovery behavior (no provider registration, no writes).
 *
 * If later approved to edit, mutation must require explicit user action and
 * symlink/path containment tests before any write support. This file prepares
 * the containment helper (isPathContained) and documents the guard, but does
 * not implement mutation in M6.
 *
 * NOTE for future mutation (NOT implemented in M6):
 * Any future mutation endpoint must require an explicit user action
 * (UI click with confirmation) and must verify path containment via
 * isPathContained(targetPath, allowedRoot) including realpath resolution
 * for symlinks, rejecting any traversal or symlink escape. Tests for
 * symlink/path containment must pass before mutation is enabled.
 */
import { existsSync, readdirSync, statSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative } from 'node:path';
/**
 * Whether child is contained inside parent (no traversal escape).
 * Uses resolved absolute paths and checks relative path does not start with "..".
 * This helper prepares symlink/path containment tests required before any
 * future mutation support — explicit user action + containment check.
 */
export function isPathContained(child, parent) {
    const resolvedChild = resolve(child);
    const resolvedParent = resolve(parent);
    if (resolvedChild === resolvedParent)
        return true;
    const rel = relative(resolvedParent, resolvedChild);
    // contained if rel does not start with ".." and is not absolute
    return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
}
function parseFrontmatter(rawContent) {
    if (!rawContent.startsWith('---'))
        return { metadata: {}, body: rawContent };
    const endIdx = rawContent.indexOf('\n---', 3);
    if (endIdx === -1)
        return { metadata: {}, body: rawContent };
    const yamlLines = rawContent.slice(3, endIdx).split('\n');
    const body = rawContent.slice(endIdx + 4).trim();
    const metadata = {};
    let blockKey;
    for (const line of yamlLines) {
        const trimmed = line.trim();
        const indent = line.length - trimmed.length;
        if (blockKey !== undefined) {
            if (trimmed === '') {
                blockKey = undefined;
                continue;
            }
            if (indent > 0) {
                metadata[blockKey] = (metadata[blockKey] + ' ' + trimmed).replace(/\s+/g, ' ').trim();
                continue;
            }
            blockKey = undefined;
        }
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        if (val.startsWith('|') || val.startsWith('>')) {
            metadata[key] = '';
            blockKey = key;
            continue;
        }
        metadata[key] = val.startsWith('"') && val.endsWith('"') ? val.slice(1, -1) : val;
    }
    return { metadata, body };
}
/**
 * List skills from a single directory, read-only.
 * - Scans <skillsDir>/* /SKILL.md
 * - Parses frontmatter for name/description
 * - Returns metadata/origin only, does not return body/content
 * - Does not follow symlink escapes for future mutation; for listing we
 *   report the logical path, but future mutation will verify containment via
 *   isPathContained + realpath.
 */
export function listSkillsSync(skillsDir, origin = 'custom') {
    if (!skillsDir)
        return [];
    let entries = [];
    try {
        entries = readdirSync(skillsDir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const entry of entries) {
        const skillFolder = join(skillsDir, entry);
        let st = null;
        try {
            st = lstatSync(skillFolder);
        }
        catch {
            continue;
        }
        // allow directory or symlink to directory
        const isDir = st.isDirectory() || st.isSymbolicLink();
        if (!isDir)
            continue;
        // verify it is a directory (follow symlink)
        try {
            const follow = statSync(skillFolder);
            if (!follow.isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const skillFilePath = join(skillFolder, 'SKILL.md');
        try {
            const fileSt = statSync(skillFilePath);
            if (!fileSt.isFile())
                continue;
        }
        catch {
            continue;
        }
        let rawContent = '';
        try {
            rawContent = readFileSync(skillFilePath, 'utf8');
        }
        catch {
            continue;
        }
        const { metadata } = parseFrontmatter(rawContent);
        const skillName = metadata.name || entry;
        const description = metadata.description || `Skill for ${skillName}`;
        out.push({
            name: skillName,
            description,
            origin,
            path: skillFilePath,
            locator: skillFilePath,
            metadata,
        });
    }
    return out;
}
/**
 * Async variant aggregating multiple roots.
 * Each root is { dir, origin }. If only skillsDir is supplied, use that.
 */
export async function listSkills(opts = {}) {
    if (opts.roots && opts.roots.length > 0) {
        const all = [];
        for (const r of opts.roots) {
            const entries = listSkillsSync(r.dir, r.origin);
            all.push(...entries);
        }
        return all;
    }
    if (opts.skillsDir) {
        return listSkillsSync(opts.skillsDir, opts.origin ?? 'custom');
    }
    // default: no dir => empty (caller should supply maestro-skills dir explicitly)
    return [];
}
/**
 * Resolve default maestro-skills directory for browser (read-only).
 * Tries well-known checkout location; returns null if not present.
 * This does NOT alter maestro-skills discovery — it only reads the directory
 * if it exists, for metadata/origin listing.
 */
export function resolveDefaultMaestroSkillsDir() {
    const candidates = [
        process.env.MAESTRO_HARNESS_ROOT ? join(process.env.MAESTRO_HARNESS_ROOT, 'maestro-skills/skills') : null,
        join(process.cwd(), '../maestro-skills/skills'),
        join(homedir(), 'Work/htdocs/maestro-harness/maestro-skills/skills'),
    ].filter((v) => Boolean(v));
    for (const c of candidates) {
        if (existsSync(c))
            return c;
    }
    return null;
}
//# sourceMappingURL=skills-browser.js.map