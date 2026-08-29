/**
 * memory/sanitize.ts — desensitize sensitive fragments before persistence.
 * Ported from FuRongJun-1999/dsh-memory src/hooks.ts desensitize().
 * English labels, same 7 patterns, same residue→null semantics.
 */
export declare const SENSITIVE_PATTERNS: Array<{
    re: RegExp;
    label: string;
}>;
/**
 * Replace sensitive fragments with [Filtered:<label>].
 * Returns null when the residue after stripping placeholders is empty
 * (pure-credential message should be skipped, not persisted).
 */
export declare function desensitize(text: string): string | null;
/**
 * Convenience wrapper for store integration: sanitize or return original
 * when disabled. Returns { filtered, sanitized } where filtered indicates
 * the input was pure-sensitive and should be rejected.
 */
export declare function sanitizeInput(text: string, enabled: boolean): {
    filtered: boolean;
    sanitized: string | null;
};
//# sourceMappingURL=sanitize.d.ts.map