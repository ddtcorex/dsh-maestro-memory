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
export interface SkillBrowseEntry {
    name: string;
    description: string;
    origin: string;
    path: string;
    locator: string;
    metadata: Record<string, string>;
}
export interface ListSkillsOpts {
    roots?: Array<{
        dir: string;
        origin: string;
    }>;
    skillsDir?: string;
    origin?: string;
}
/**
 * Whether child is contained inside parent (no traversal escape).
 * Uses resolved absolute paths and checks relative path does not start with "..".
 * This helper prepares symlink/path containment tests required before any
 * future mutation support — explicit user action + containment check.
 */
export declare function isPathContained(child: string, parent: string): boolean;
/**
 * List skills from a single directory, read-only.
 * - Scans <skillsDir>/* /SKILL.md
 * - Parses frontmatter for name/description
 * - Returns metadata/origin only, does not return body/content
 * - Does not follow symlink escapes for future mutation; for listing we
 *   report the logical path, but future mutation will verify containment via
 *   isPathContained + realpath.
 */
export declare function listSkillsSync(skillsDir: string, origin?: string): SkillBrowseEntry[];
/**
 * Async variant aggregating multiple roots.
 * Each root is { dir, origin }. If only skillsDir is supplied, use that.
 */
export declare function listSkills(opts?: ListSkillsOpts): Promise<SkillBrowseEntry[]>;
/**
 * Resolve default maestro-skills directory for browser (read-only).
 * Tries well-known checkout location; returns null if not present.
 * This does NOT alter maestro-skills discovery — it only reads the directory
 * if it exists, for metadata/origin listing.
 */
export declare function resolveDefaultMaestroSkillsDir(): string | null;
//# sourceMappingURL=skills-browser.d.ts.map