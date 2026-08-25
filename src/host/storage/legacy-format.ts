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
 * Behaviour is byte-compatible with legacy memory files
 * (previous store.js + todo.js).
 */

// ---------------------------------------------------------------------------
// § delimiter
// ---------------------------------------------------------------------------

/** Entry delimiter, byte-compatible with MEMORY.md / USER.md. */
export const ENTRY_DELIMITER = '\n§\n'

/**
 * Split raw file text into trimmed, non-empty entries.
 */
export function parseEntries(text: string): string[] {
  return String(text ?? '')
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Serialize entries into canonical file text (entries joined by the
 * delimiter plus a trailing newline).
 */
export function serializeEntries(entries: string[]): string {
  return entries.join(ENTRY_DELIMITER) + '\n'
}

/**
 * Whether raw text is the canonical serialization of its own entries.
 * Blank text counts as canonical (an empty store).
 */
export function isCanonical(text: string): boolean {
  return String(text ?? '').trim() === '' || serializeEntries(parseEntries(text)) === text
}

// ---------------------------------------------------------------------------
// Entry ID helpers (minimal, for header stripping)
// ---------------------------------------------------------------------------

const ENTRY_ID_RE = /^\[id:\s*[0-9a-f]{8}\]\s*/i

function stripEntryId(entry: string): string {
  return String(entry ?? '').replace(ENTRY_ID_RE, '')
}

/** Extract the YYYY-MM-DD date from an entry's stamp prefix; null when absent. */
export function extractEntryDate(entry: string): string | null {
  const match = /^\[(\d{4}-\d{2}-\d{2})/.exec(stripEntryId(String(entry ?? '')))
  return match ? match[1] : null
}

// ---------------------------------------------------------------------------
// Branch tags
// ---------------------------------------------------------------------------

/**
 * Branch-scope tag inside a KEY entry: `[2026-08-06] [branch:main,dev] content`.
 * Absent = visible in EVERY branch ("all").
 */
export const BRANCH_TAG_RE = /(?:^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*)?\[branch:([^\]]*)\]\s*/

/**
 * Parse the branch scope of one KEY entry.
 */
export function parseEntryBranches(entry: string): string[] | null {
  const match = BRANCH_TAG_RE.exec(String(entry ?? ''))
  if (match === null) return null
  const branches = match[1].split(',').map((b) => b.trim()).filter(Boolean)
  return branches.length > 0 ? branches : null
}

// ---------------------------------------------------------------------------
// DSH-only marker
// ---------------------------------------------------------------------------

export const DSH_ONLY_TAG = '[dsh-only]'
export const DSH_ONLY_RE = /\[dsh-only\]\s*/

export function parseEntryDshOnly(entry: string): boolean {
  return DSH_ONLY_RE.test(String(entry ?? ''))
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export const SUMMARY_TAG_RE = /\[summary:([^\]]*)\]/

/**
 * Regex for the entry header (program-metadata prefix): [id:...] -> timestamp
 * -> [git ...] x N -> [branch:...] -> [dsh-only], matched in the known token
 * order of splitEntryHead. Summary parsing and stripping are both anchored
 * to this header.
 */
const ENTRY_HEAD_RE =
  /^(?:\[id:\s*[0-9a-f]{8}\]\s*)?(?:\[\d{4}-\d{2}-\d{2}(?: \d{1,2}:\d{2}(?::\d{2})?)?\]\s*|\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?(?:\[git [^\]]+\]\s*)*(?:\[branch:[^\]]*\]\s*)?(?:\[dsh-only\]\s*)?/i

/**
 * Parse the summary tag of a memory entry (only recognizes [summary:...] at the header position).
 */
export function parseEntrySummary(entry: string): string | null {
  const text = String(entry ?? '')
  const head = ENTRY_HEAD_RE.exec(text)
  if (head === null) return null
  const match = /^\[summary:([^\]]*)\]\s*/.exec(text.slice(head[0].length))
  return match ? match[1] : null
}

/**
 * Return the program-metadata prefix ([id]/timestamp/[git]/[branch]/[dsh-only]) of an entry.
 * Useful for compact renderings that keep the header and drop the body.
 */
export function entryHeadPrefix(entry: string): string {
  const match = ENTRY_HEAD_RE.exec(String(entry ?? ''))
  return match === null ? '' : match[0]
}

/**
 * Strip the "summary" marker for display (only at header position).
 */
export function stripEntrySummary(entry: string): string {
  const match = ENTRY_HEAD_RE.exec(String(entry ?? ''))
  const prefix = match === null ? '' : match[0]
  const rest = String(entry ?? '').slice(prefix.length)
  return prefix + rest.replace(/^\[summary:[^\]]*\]\s*/, '')
}

/**
 * Auto-generate a summary from the entry body (fallback when no explicit [summary:...] exists).
 */
export function autoSummary(entry: string, maxLen = 80): string {
  let rest = String(entry ?? '').trim()
  const head = ENTRY_HEAD_RE.exec(rest)
  if (head !== null) rest = rest.slice(head[0].length)
  rest = rest.replace(/^\[summary:[^\]]*\]\s*/, '')
  const firstLine = rest.split('\n')[0].trim()
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen - 1) + '…'
}

// ---------------------------------------------------------------------------
// splitEntryHead
// ---------------------------------------------------------------------------

/**
 * Strip all prefix markers from an entry: timestamp + `[git ...]` + `[branch:...]` + `[dsh-only]` + `[summary:...]`,
 * returning the prefix head and the body. Keeps same parsing as Memory Tab pretty view.
 */
export function splitEntryHead(
  entry: string,
  target: string,
): { head: string; body: string } {
  let rest = String(entry ?? '').trim()
  const timeRe =
    target === 'project'
      ? /^\[(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(?::\d{2})?)\]\s*/
      : target === 'daily'
        ? /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/
        : /^\[(\d{4}-\d{2}-\d{2})\]\s*/
  const tokens: string[] = []
  const idMatch = /^\[id:\s*([0-9a-f]{8})\]\s*/i.exec(rest)
  if (idMatch !== null) {
    tokens.push(idMatch[0])
    rest = rest.slice(idMatch[0].length)
  }
  const timeMatch = timeRe.exec(rest)
  if (timeMatch !== null) {
    tokens.push(timeMatch[0])
    rest = rest.slice(timeMatch[0].length)
  }
  for (;;) {
    const gitMatch = /^\[git [^\]]+\]\s*/.exec(rest)
    if (gitMatch === null) break
    tokens.push(gitMatch[0])
    rest = rest.slice(gitMatch[0].length)
  }
  const branchMatch = /^\[branch:[^\]]*\]\s*/.exec(rest)
  if (branchMatch !== null) {
    tokens.push(branchMatch[0])
    rest = rest.slice(branchMatch[0].length)
  }
  const dshOnlyMatch = /^\[dsh-only\]\s*/.exec(rest)
  if (dshOnlyMatch !== null) {
    tokens.push(dshOnlyMatch[0])
    rest = rest.slice(dshOnlyMatch[0].length)
  }
  const summaryMatch = /^\[summary:[^\]]*\]\s*/.exec(rest)
  if (summaryMatch !== null) {
    tokens.push(summaryMatch[0])
    rest = rest.slice(summaryMatch[0].length)
  }
  if (target === 'daily') {
    const tagMatch = /^\[([^\]]+)\]\s*/.exec(rest)
    if (tagMatch !== null) {
      tokens.push(tagMatch[0])
      rest = rest.slice(tagMatch[0].length)
    }
  }
  return { head: tokens.join(''), body: rest }
}

// ---------------------------------------------------------------------------
// Legacy todo grammar
// ---------------------------------------------------------------------------

export const TODO_HEADER = `<!--
Todo entry format (auto-maintained by the program, do not edit the structure manually):
- Entries are delimited by §; the comment block before the first § is the format note, not a todo
- The first line of each todo is the metadata tag line (fixed order, optional parts may be omitted):
  [created time] auto-stamped by the program (e.g. [2026-08-06 21:30])
  [id: 8-hex] unique identifier for the entry, operated by the dtodo tool
  [q1] important & urgent  [q2] important not urgent  [q3] urgent not important  [q4] not important not urgent (default = unclassified)
  [due: YYYY-MM-DD] due date (default = none)
  [status: pending|doing|done|blocked|cancelled] status (default pending)
  [done: YYYY-MM-DD HH:MM] completion time (auto-stamped, only for done status)
  [cat: category] optional (life/work/study...)
- Todo content follows the first tag line and may span multiple lines
-->
`

export const TODO_TARGETS = ['life', 'work', 'project', 'daily'] as const
export const TODO_STATUSES = ['pending', 'doing', 'done', 'blocked', 'cancelled'] as const

const TODO_TIME_RE = /^\[(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\]\s*/
const TODO_ID_RE = /\[id:\s*([0-9a-f]{8})\]/i
const TODO_QUAD_RE = /\[q([1-4])\]/i
const TODO_DUE_RE = /\[due:\s*(\d{4}-\d{2}-\d{2})\]/i
const TODO_STATUS_RE = /\[status:\s*(pending|doing|done|blocked|cancelled)\]/i
const TODO_DONE_RE = /\[done:\s*(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\]/i
const TODO_CAT_RE = /\[cat:\s*([^\]]+)\]/i

export interface TodoEntry {
  id: string | null
  time: string
  quadrant: string | null
  due: string | null
  status: string
  doneAt: string | null
  cat: string | null
  text: string
  raw: string
}

export interface TodoMeta {
  time: string
  id: string
  quadrant: string | null
  due: string | null
  status: string
  cat: string | null
  doneAt: string | null
}

/**
 * Parse one raw todo entry into its structured form. The first line is the
 * tag line (time stamp + tags); the rest is the todo's text (may be empty).
 * Returns null when it has no timestamp (not a valid entry).
 */
export function parseTodoEntry(raw: string): TodoEntry | null {
  const text = String(raw ?? '')
  const first = text.split('\n', 1)[0]
  const time = TODO_TIME_RE.exec(first)
  if (time === null) return null
  const idMatch = TODO_ID_RE.exec(first)
  const quadMatch = TODO_QUAD_RE.exec(first)
  const dueMatch = TODO_DUE_RE.exec(first)
  const statusMatch = TODO_STATUS_RE.exec(first)
  const doneMatch = TODO_DONE_RE.exec(first)
  const catMatch = TODO_CAT_RE.exec(first)
  const body = text.slice(first.length).trim()
  return {
    id: idMatch?.[1]?.toLowerCase() ?? null,
    time: time[1],
    quadrant: quadMatch?.[1] ? `q${quadMatch[1].toLowerCase()}` : null,
    due: dueMatch?.[1] ?? null,
    status: statusMatch?.[1]?.toLowerCase() ?? 'pending',
    doneAt: doneMatch?.[1] ?? null,
    cat: catMatch?.[1]?.trim() || null,
    text: body,
    raw: text,
  }
}

/**
 * Build one entry's tag line + content.
 */
export function stampTodoLine(meta: TodoMeta, content: string): string {
  const parts: string[] = [`[${meta.time}]`, `[id: ${meta.id}]`]
  if (meta.quadrant) parts.push(`[${meta.quadrant}]`)
  if (meta.due) parts.push(`[due: ${meta.due}]`)
  parts.push(`[status: ${meta.status ?? 'pending'}]`)
  if (meta.cat) parts.push(`[cat: ${meta.cat}]`)
  if (meta.doneAt) parts.push(`[done: ${meta.doneAt}]`)
  return `${parts.join(' ')}\n${String(content).trim()}`
}
