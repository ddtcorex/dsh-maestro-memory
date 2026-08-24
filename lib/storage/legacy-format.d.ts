/**
 * storage/legacy-format.ts — Pure §-entry and legacy todo-tag parsing/serialization.
 *
 * Pure module — no framework imports. All functions are deterministic and side-effect free.
 * Covers:
 *  - § delimiter (ENTRY_DELIMITER) parse/serialize/canonical
 *  - branch tags [branch:...]
 *  - summaries [summary:...] (header-anchored)
 *  - DSH-only marker
 *  - legacy todo-tag grammar (first-line tags + multiline content)
 *
 * Behaviour is byte-compatible with dsh-memory-evolve legacy files
 * (lib/store.js + lib/todo.js).
 */
/** Entry delimiter, byte-compatible with MEMORY.md / USER.md. */
export declare const ENTRY_DELIMITER = "\n\u00A7\n";
/**
 * Split raw file text into trimmed, non-empty entries.
 */
export declare function parseEntries(text: string): string[];
/**
 * Serialize entries into canonical file text (entries joined by the
 * delimiter plus a trailing newline).
 */
export declare function serializeEntries(entries: string[]): string;
/**
 * Whether raw text is the canonical serialization of its own entries.
 * Blank text counts as canonical (an empty store).
 */
export declare function isCanonical(text: string): boolean;
/** Extract the YYYY-MM-DD date from an entry's stamp prefix; null when absent. */
export declare function extractEntryDate(entry: string): string | null;
/**
 * Branch-scope tag inside a KEY entry: `[2026-08-06] [branch:main,dev] content`.
 * Absent = visible in EVERY branch ("all").
 */
export declare const BRANCH_TAG_RE: RegExp;
/**
 * Parse the branch scope of one KEY entry.
 */
export declare function parseEntryBranches(entry: string): string[] | null;
export declare const DSH_ONLY_TAG = "[dsh-only]";
export declare const DSH_ONLY_RE: RegExp;
export declare function parseEntryDshOnly(entry: string): boolean;
export declare const SUMMARY_TAG_RE: RegExp;
/**
 * Parse the summary tag of a memory entry (only recognizes [summary:...] at the header position).
 */
export declare function parseEntrySummary(entry: string): string | null;
/**
 * Strip the "summary" marker for display (only at header position).
 */
export declare function stripEntrySummary(entry: string): string;
/**
 * Auto-generate a summary from the entry body (fallback when no explicit [summary:...] exists).
 */
export declare function autoSummary(entry: string, maxLen?: number): string;
/**
 * Strip all prefix markers from an entry: timestamp + `[git ...]` + `[branch:...]` + `[dsh-only]` + `[summary:...]`,
 * returning the prefix head and the body. Keeps same parsing as Memory Tab pretty view.
 */
export declare function splitEntryHead(entry: string, target: string): {
    head: string;
    body: string;
};
export declare const TODO_HEADER = "<!--\nTodo entry format (auto-maintained by the program, do not edit the structure manually):\n- Entries are delimited by \u00A7; the comment block before the first \u00A7 is the format note, not a todo\n- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):\n  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])\n  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool\n  [q1] important & urgent  [q2] important not urgent  [q3] urgent not important  [q4] not important not urgent (default = unclassified)\n  [due: YYYY-MM-DD] due date (default = none)\n  [status: pending|doing|done|blocked|cancelled] status (default pending)\n  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)\n  [cat: category] optional (life/work/study...)\n- Todo content follows the first tag line and may span multiple lines\n-->\n";
export declare const TODO_TARGETS: readonly ["life", "work", "project", "daily"];
export declare const TODO_STATUSES: readonly ["pending", "doing", "done", "blocked", "cancelled"];
export interface TodoEntry {
    id: string | null;
    time: string;
    quadrant: string | null;
    due: string | null;
    status: string;
    doneAt: string | null;
    cat: string | null;
    text: string;
    raw: string;
}
export interface TodoMeta {
    time: string;
    id: string;
    quadrant: string | null;
    due: string | null;
    status: string;
    cat: string | null;
    doneAt: string | null;
}
/**
 * Parse one raw todo entry into its structured form. The first line is the
 * tag line (time stamp + tags); the rest is the todo's text (may be empty).
 * Returns null when it has no timestamp (not a valid entry).
 */
export declare function parseTodoEntry(raw: string): TodoEntry | null;
/**
 * Build one entry's tag line + content.
 */
export declare function stampTodoLine(meta: TodoMeta, content: string): string;
//# sourceMappingURL=legacy-format.d.ts.map