/**
 * maestro-memory — host-side i18n runtime (English support, 2026-08-25).
 *
 * One source of truth for which language the HOST side (model-facing tool
 * descriptions, injected snapshot duties, feedback lines, tool result
 * messages) speaks:
 *
 *   resolveLocale():
 *     1. DSH Settings → General → Language preference (namespace 'locale',
 *        field 'preference') when the user picked one explicitly ('zh'|'en');
 *     2. otherwise default 'zh'.
 *
 * 2026-08-25 self-implemented fix (decided when absorbing external PR #27): default language is Chinese —
 * unset / 'auto' / unknown values all fall back to 'zh' (preserving the plugin's historical behavior and
 * Chinese user base); only an explicit user choice of 'en' switches to English. The original PR defaulted to
 * 'en' which contradicted its "zh stays default" claim and was a breaking change, so it was corrected.
 *
 * The DSH locale plugin registers the namespace read-only from our side: we
 * never call settings.update/replace — we only .get() the resolved section
 * and listen to the 'settings/updated' commit event. When the user flips
 * Language mid-session, `setLocale` re-resolves and every getter-based tool
 * description + next-built snapshot/message follows immediately (no restart,
 * no re-registration — the tools registry reads `definition.description` at
 * projection time, so plain JS getters are enough).
 *
 * Dictionary shape: per-domain flat key → { zh, en } pairs, translated via
 * t(domain, key, params) with {name} placeholder substitution. Keeping both
 * languages in one table makes key-parity testable in one pass.
 *
 * @module maestro-memory/i18n
 */

/** Active host locale. Module-level singleton: one process speaks one language.
 *  Default 'zh' (2026-08-25 decision): keeps historical Chinese behavior; switches to English only when DSH
 *  Language preference is explicitly 'en'. apply() re-resolves at startup and on every locale
 *  change event; the running process always follows the setting. */
let active = 'zh'

/** Valid locale ids (mirrors DSH's LOCALE_IDS). */
export const LOCALES = ['zh', 'en']

/**
 * Resolve the effective locale from a Cordis context. Reads the DSH locale
 * settings section when the settings service exists. Default is 'zh': switches to English only when
 * DSH Language preference is explicitly 'en'; unset / 'auto' / unknown values stay Chinese
 * (historical behavior compatibility). Never throws.
 * @param {object|undefined} ctx - plugin context with an optional settings service.
 * @returns {'zh'|'en'} the resolved locale id.
 */
export function resolveLocale(ctx) {
  // Child-process override (spawnWorker passes the host locale down so the
  // memory-sync worker speaks the same language as its parent).
  const fromEnv = typeof process !== 'undefined' && process.env?.DSH_LOCALE
  if (fromEnv === 'zh') return 'zh'
  if (fromEnv === 'en') return 'en'
  try {
    const settings = ctx?.get?.('settings')
    if (!settings || typeof settings.get !== 'function') return 'zh'
    const section = settings.get('locale')
    const pref = section && typeof section === 'object' ? section.preference : undefined
    return pref === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** The module-level active locale (for passing to child processes). */
export function getActiveLocale() {
  return active
}

/**
 * Set the active locale (validated). The apply() wiring calls this at boot
 * and on every 'settings/updated' event for the 'locale' namespace.
 * @param {'zh'|'en'} locale - the new active locale.
 */
export function setLocale(locale) {
  if (LOCALES.includes(locale)) active = locale
}

/** Read the active locale (mainly for tests). */
export function getLocale() {
  return active
}

/**
 * Translate one key in the active locale with {name} placeholder params.
 * Unknown keys fall back to the key itself so missing translations surface
 * visibly instead of crashing a tool call.
 * @param {Record<string, [string, string]>} dict - flat map key → [zh, en].
 * @param {string} key - dictionary key.
 * @param {object} [params] - placeholder values ({name} style).
 * @param {'zh'|'en'} [locale] - override the active locale (tests).
 * @returns {string} the translated string.
 */
export function translate(dict, key, params, locale = undefined) {
  const pair = dict[key]
  const lang = locale ?? active
  let text = pair ? (lang === 'zh' ? pair[0] : pair[1]) : key
  if (params && typeof params === 'object') {
    text = text.replace(/\{(\w+)\}/g, (m, name) => {
      const v = params[name]
      return v === undefined || v === null ? m : String(v)
    })
  }
  return text
}

/* ------------------------------------------------------------------ */
/* dictionaries                                                        */
/* ------------------------------------------------------------------ */

/**
 * Core memory-tool strings: descriptions, parameters, result messages.
 * Format: KEY: [zh, en]. Keep both cells non-empty (key-parity test).
 */
export const MEMORY_DICT = {
  // ── tool description ──
  'memory.desc': [
    'Read/write long-term memory (persists across sessions; visible to the model through context snapshots). target=memory stores global environment/project facts, target=user stores user facts, target=project stores the current working directory\'s project log (visible only to sessions of this project), target=key stores the current project\'s critical long-term memory (auto-injected into context, visible only to this project\'s sessions; supports branches to limit git-branch visibility, default=all; **writes require user confirmation**: add enters a pending-confirmation queue and takes effect after approval; add accepts an optional summary parameter — a one-line abstract for progressive disclosure), target=daily appends today\'s log (read on demand, not injected). add appends an entry; replace rewrites an entire entry matched by a unique substring; remove deletes an entry matched by a unique substring; **archive moves an entry into the archive (memory/user/key tracks only)**: matched by a unique substring, removed from the main track and appended verbatim into the archive file (MEMORY-archive.md / USER-archive.md / project KEY-archive.md; reversible — the Memory tab archive page can move entries back); good for low-frequency items "no longer worth injecting but too valuable to drop". list queries entries — main track by default (unarchived; everything returned, time ascending), supporting filter (keyword), since/until (date range YYYY-MM-DD; daily may query across historical files), limit (max entries, combine with recent to fetch the latest N), recent (newest first), branch (key track: only entries visible to that branch), **archived=true (query the archive files MEMORY-archive.md / USER-archive.md / project KEY-archive.md instead — memory/user/key tracks only; key needs the session working directory; archives are not injected and can be moved back to the main track)**; when nothing matches or dates fail to parse, retry without filters. **expand loads full text on demand (progressive disclosure)**: when the key track runs in summary mode the system prompt injects only summaries; use expand+id to load the full entry. **End-of-turn batch write**: write the daily log + project log in ONE call (action=add with an entries array containing target=daily and target=project items; entries supports these two tracks only) instead of two calls. **Sentiment feedback**: when the human user\'s input this turn carries clear emotion (positive e.g. "great/thanks", negative e.g. "still wrong/try again"), attach the feedback parameter (sentiment/category/quote/note; the program renders the [Feedback] line and strips special characters) to BOTH daily and project items; daily categories use generic layering (e.g. Coding/Backend/Databases — category describes the kind of work like Coding→Frontend→JavaScript, never the feature/module name), project categories use this project\'s own layering (e.g. Memory module/write path, following actual project structure); do not attach feedback for neutral task instructions or messages from other session AIs. Writes persist immediately; model context refreshes on the next turn.',
    'Read/write long-term memory (persists across sessions; visible to the model through context snapshots). target=memory stores global environment/project facts, target=user stores user facts, target=project stores the current working directory\'s project log (visible only to sessions of this project), target=key stores the current project\'s critical long-term memory (auto-injected into context, visible only to this project\'s sessions; supports branches to limit git-branch visibility, default=all; **writes require user confirmation**: add enters a pending-confirmation queue and takes effect after approval; add accepts an optional summary parameter — a one-line abstract for progressive disclosure), target=daily appends today\'s log (read on demand, not injected). add appends an entry; replace rewrites an entire entry matched by a unique substring; remove deletes an entry matched by a unique substring; **archive moves an entry into the archive (memory/user/key tracks only)**: matched by a unique substring, removed from the main track and appended verbatim into the archive file (MEMORY-archive.md / USER-archive.md / project KEY-archive.md; reversible — the Memory tab archive page can move entries back); good for low-frequency items "no longer worth injecting but too valuable to drop". list queries entries — main track by default (unarchived; everything returned, time ascending), supporting filter (keyword), since/until (date range YYYY-MM-DD; daily may query across historical files), limit (max entries, combine with recent to fetch the latest N), recent (newest first), branch (key track: only entries visible to that branch), **archived=true (query the archive files MEMORY-archive.md / USER-archive.md / project KEY-archive.md instead — memory/user/key tracks only; key needs the session working directory; archives are not injected and can be moved back to the main track)**; when nothing matches or dates fail to parse, retry without filters. **expand loads full text on demand (progressive disclosure)**: when the key track runs in summary mode the system prompt injects only summaries; use expand+id to load the full entry. **End-of-turn batch write**: write the daily log + project log in ONE call (action=add with an entries array containing target=daily and target=project items; entries supports these two tracks only) instead of two calls. **Sentiment feedback**: when the human user\'s input this turn carries clear emotion (positive e.g. "great/thanks", negative e.g. "still wrong/try again"), attach the feedback parameter (sentiment/category/quote/note; the program renders the [Feedback] line and strips special characters) to BOTH daily and project items; daily categories use generic layering (e.g. Coding/Backend/Databases — category describes the kind of work like Coding→Frontend→JavaScript, never the feature/module name), project categories use this project\'s own layering (e.g. Memory module/write path, following actual project structure); do not attach feedback for neutral task instructions or messages from other session AIs. Writes persist immediately; model context refreshes on the next turn.',
  ],
  // ── parameter descriptions ──
  'param.action': ['The action to perform', 'The action to perform'],
  'param.target': [
    'Memory track: memory=global environment/project facts, user=user profile facts, project=current project log, key=current project critical long-term memory (auto-injected), daily=today\'s log; archive and archived queries support memory/user/key only',
    'Memory track: memory=global environment/project facts, user=user profile facts, project=current project log, key=current project critical long-term memory (auto-injected), daily=today\'s log; archive and archived queries support memory/user/key only',
  ],
  'param.content': [
    'New entry content for add/replace (multi-line allowed)',
    'New entry content for add/replace (multi-line allowed)',
  ],
  'param.entries': [
    'Optional for add: batch-write multiple tracks in ONE call (the end-of-turn combined daily+project write saves a round trip). Each item is {target, content, feedback?}; **daily/project tracks only** (use single-track parameters for other tracks to respect global-track gating); when entries is given the top-level target/content are ignored, each item executes and returns its own result',
    'Optional for add: batch-write multiple tracks in ONE call (the end-of-turn combined daily+project write saves a round trip). Each item is {target, content, feedback?}; **daily/project tracks only** (use single-track parameters for other tracks to respect global-track gating); when entries is given the top-level target/content are ignored, each item executes and returns its own result',
  ],
  'param.entriesTarget': [
    'Memory track: daily (today\'s log) or project (current project log) only',
    'Memory track: daily (today\'s log) or project (current project log) only',
  ],
  'param.entriesContent': ['Entry content (same as top-level content)', 'Entry content (same as top-level content)'],
  'param.feedback': [
    'Optional for add (daily/project tracks only): attach when the human user\'s input this turn carries clear emotion; the program appends a [Feedback] line to the entry (fixed searchable format, special characters sanitized); skip it for neutral task instructions or messages from other session AIs',
    'Optional for add (daily/project tracks only): attach when the human user\'s input this turn carries clear emotion; the program appends a [Feedback] line to the entry (fixed searchable format, special characters sanitized); skip it for neutral task instructions or messages from other session AIs',
  ],
  'param.sentiment': [
    'Sentiment: positive (great/thanks/nice), negative (still wrong/wrong again/try again); provide only for explicit human-user evaluations; special characters are sanitized',
    'Sentiment: positive (great/thanks/nice), negative (still wrong/wrong again/try again); provide only for explicit human-user evaluations; special characters are sanitized',
  ],
  'param.category': [
    'Task category: daily track uses generic layering (e.g. Coding/Backend/Databases, one to three levels; top-level references: Coding/Docs/Ops/Data analysis/Design/General; category means the KIND of work like Coding→Frontend→JavaScript, never the feature/module name); project track uses this project\'s own layering (e.g. Memory module/write path, following actual structure; depth not enforced)',
    'Task category: daily track uses generic layering (e.g. Coding/Backend/Databases, one to three levels; top-level references: Coding/Docs/Ops/Data analysis/Design/General; category means the KIND of work like Coding→Frontend→JavaScript, never the feature/module name); project track uses this project\'s own layering (e.g. Memory module/write path, following actual structure; depth not enforced)',
  ],
  'param.quote': [
    'Verbatim user quote (truncated to 20 chars and sanitized; traceable evidence for the sentiment call)',
    'Verbatim user quote (truncated to 20 chars and sanitized; traceable evidence for the sentiment call)',
  ],
  'param.note': [
    'One-line performance note (good/bad + reason, e.g. two fix rounds still failing)',
    'One-line performance note (good/bad + reason, e.g. two fix rounds still failing)',
  ],
  'param.manual': [
    'true=user explicitly asked to record (renders the [Feedback·manual] prefix); default=false (automatic capture)',
    'true=user explicitly asked to record (renders the [Feedback·manual] prefix); default=false (automatic capture)',
  ],
  'param.match': [
    'Substring for replace/remove/archive; must match exactly one entry',
    'Substring for replace/remove/archive; must match exactly one entry',
  ],
  'param.archived': [
    'Optional for list: true queries the archive files (MEMORY-archive.md / USER-archive.md / project KEY-archive.md) instead; memory/user/key tracks only; key needs the session working directory',
    'Optional for list: true queries the archive files (MEMORY-archive.md / USER-archive.md / project KEY-archive.md) instead; memory/user/key tracks only; key needs the session working directory',
  ],
  'param.branches': [
    'Optional for add (key track only): branch scope, comma-separated (e.g. main,dev); default=all branches visible; empty string=all',
    'Optional for add (key track only): branch scope, comma-separated (e.g. main,dev); default=all branches visible; empty string=all',
  ],
  'param.branch': [
    'Optional for list (key track only): return only entries visible to that branch (untagged entries + entries tagged with it)',
    'Optional for list (key track only): return only entries visible to that branch (untagged entries + entries tagged with it)',
  ],
  'param.filter': [
    'Optional for list: return only entries containing this keyword (case-insensitive)',
    'Optional for list: return only entries containing this keyword (case-insensitive)',
  ],
  'param.since': [
    'Optional for list: start date YYYY-MM-DD; the daily track may query across historical files',
    'Optional for list: start date YYYY-MM-DD; the daily track may query across historical files',
  ],
  'param.until': ['Optional for list: end date YYYY-MM-DD', 'Optional for list: end date YYYY-MM-DD'],
  'param.limit': [
    'Optional for list: maximum entries to return (combine with recent to fetch the latest N)',
    'Optional for list: maximum entries to return (combine with recent to fetch the latest N)',
  ],
  'param.recent': [
    'Optional for list: return newest first (reverse chronological)',
    'Optional for list: return newest first (reverse chronological)',
  ],
  'param.id': [
    'Required for expand: the entry identity ID (the xxxxxxxx part of a [mem-xxxxxxxx] id shown in summary-mode injections)',
    'Required for expand: the entry identity ID (the xxxxxxxx part of a [mem-xxxxxxxx] id shown in summary-mode injections)',
  ],
  'param.summary': [
    'Optional for add (key track only): a one-line summary (≤120 chars) injected by progressive disclosure; default=first line of the body',
    'Optional for add (key track only): a one-line summary (≤120 chars) injected by progressive disclosure; default=first line of the body',
  ],
  // ── execute-time messages ──
  'msg.emptyContent': ['Content must not be empty', 'Content must not be empty'],
  'msg.emptyMatch': ['match must not be empty', 'match must not be empty'],
  'msg.emptyEntry': ['Entry must not be empty', 'Entry must not be empty'],
  'msg.missingTarget': [
    'Missing target (a memory track is required; use add + the entries array for the end-of-turn batch write)',
    'Missing target (a memory track is required; use add + the entries array for the end-of-turn batch write)',
  ],
  'msg.fileUnreadableWrite': [
    'Memory file exists but cannot be read; write refused (protecting existing memories from being wiped)',
    'Memory file exists but cannot be read; write refused (protecting existing memories from being wiped)',
  ],
  'msg.fileUnreadableOp': [
    'Memory file exists but cannot be read; operation refused (avoiding entry misjudgment)',
    'Memory file exists but cannot be read; operation refused (avoiding entry misjudgment)',
  ],
  'msg.driftGuardWrite': [
    'Write refused: {file} does not round-trip through the memory tool parser (hand-edited or modified by another process?). A backup was saved to {backup}. Re-format the file into canonical §-delimited entries first, then retry.',
    'Write refused: {file} does not round-trip through the memory tool parser (hand-edited or modified by another process?). A backup was saved to {backup}. Re-format the file into canonical §-delimited entries first, then retry.',
  ],
  'msg.driftGuardOp': [
    'Operation refused: {file} does not round-trip through the memory tool parser. A backup was saved to {backup}. Reformat the file first, then retry.',
    'Operation refused: {file} does not round-trip through the memory tool parser. A backup was saved to {backup}. Reformat the file first, then retry.',
  ],
  'msg.added': ['Added ({target}: {before} → {after} entries)', 'Added ({target}: {before} → {after} entries)'],
  'msg.duplicate': ['Entry already exists; not added again', 'Entry already exists; not added again'],
  'msg.replaced': ['Entry replaced ({target}: {count} entries unchanged)', 'Entry replaced ({target}: {count} entries unchanged)'],
  'msg.removedEntry': ['Entry deleted ({target}: {before} → {after} entries)', 'Entry deleted ({target}: {before} → {after} entries)'],
  'msg.noMatchEntries': ['No entry contains the substring "{match}"', 'No entry contains the substring "{match}"'],
  'msg.multiMatch': [
    'The substring "{match}" matches {count} entries; use a more precise substring',
    'The substring "{match}" matches {count} entries; use a more precise substring',
  ],
  'msg.archivedQueryOnly': [
    'archived queries support memory / user / key only (project/daily are never archived)',
    'archived queries support memory / user / key only (project/daily are never archived)',
  ],
  'msg.keyArchiveNeedsCwd': ['key archive queries need the session working directory', 'key archive queries need the session working directory'],
  'msg.archiveList': [
    '{target} archive: {count} entries (archives are not injected; entries can be moved back to the main track when needed)',
    '{target} archive: {count} entries (archives are not injected; entries can be moved back to the main track when needed)',
  ],
  'msg.listMatched': ['{target}: {count} entries matched', '{target}: {count} entries matched'],
  'msg.protectedView': [
    '(this track holds {total} entries spanning {earliest} ~ {latest}; by default only the latest 50 return — add since/until (e.g. since={sample}) or raise limit to reach older records)',
    '(this track holds {total} entries spanning {earliest} ~ {latest}; by default only the latest 50 return — add since/until (e.g. since={sample}) or raise limit to reach older records)',
  ],
  'msg.noMatchesRetry': [
    '(no matching entries — retry list without filters to scan the full text)',
    '(no matching entries — retry list without filters to scan the full text)',
  ],
  'msg.undatedSkipped': [
    '({count} additional entries have unparsable dates and were skipped by the date filter — retry without since/until to scan the full text)',
    '({count} additional entries have unparsable dates and were skipped by the date filter — retry without since/until to scan the full text)',
  ],
  'msg.subagentGlobalDenied': [
    'Subagent writes to global memory are refused: propose via {suggestTool} instead (project memory and today\'s log stay directly writable)',
    'Subagent writes to global memory are refused: propose via {suggestTool} instead (project memory and today\'s log stay directly writable)',
  ],
  'msg.approvalUnavailable': [
    'This memory write needs user approval but no approval channel is available',
    'This memory write needs user approval but no approval channel is available',
  ],
  'msg.approvalReason': ['Review suggestion writing into long-term memory', 'Review suggestion writing into long-term memory'],
  'msg.notApproved': ['Memory write was not approved ({outcome})', 'Memory write was not approved ({outcome})'],
  'msg.keySuggestionQueued': [
    'Submitted a pending project-key-memory suggestion (queue now holds {queued}) — it is written and injected only after user confirmation',
    'Submitted a pending project-key-memory suggestion (queue now holds {queued}) — it is written and injected only after user confirmation',
  ],
  'msg.keySuggestReason': ['Project key-memory suggestion auto-submitted at end of turn', 'Project key-memory suggestion auto-submitted at end of turn'],
  'msg.writeError': [
    'Write failed: {detail}',
    'Write failed: {detail}',
  ],
  'msg.batchUnsupportedTrack': [
    'entries supports daily/project tracks only (use single-track parameters for other tracks)',
    'entries supports daily/project tracks only (use single-track parameters for other tracks)',
  ],
  'msg.batchSummary': [
    'Batch-wrote {count} tracks: ',
    'Batch-wrote {count} tracks: ',
  ],
  'msg.ok': ['ok', 'ok'],
  'msg.failed': ['failed', 'failed'],
  'msg.archiveTracksOnly': [
    'archive supports the three archive tracks memory / user / key only (project/daily are never archived)',
    'archive supports the three archive tracks memory / user / key only (project/daily are never archived)',
  ],
  'msg.archiveEmptyMatch': [
    'match must not be empty (a unique substring of the entry to archive)',
    'match must not be empty (a unique substring of the entry to archive)',
  ],
  'msg.archiveKeyNeedsCwd': ['key-track archiving needs the session working directory', 'key-track archiving needs the session working directory'],
  'msg.archiveAppendFailed': [
    'Archive write failed: {detail} (the main-track entry is untouched; retry is safe)',
    'Archive write failed: {detail} (the main-track entry is untouched; retry is safe)',
  ],
  'msg.archivePartial': [
    'Archived ({total} entries now in the archive) but main-track deletion failed: {detail} — clean up the extra archive copy on the Memory tab archive page',
    'Archived ({total} entries now in the archive) but main-track deletion failed: {detail} — clean up the extra archive copy on the Memory tab archive page',
  ],
  'msg.archivedDone': [
    'Archived ({target}: the archive file now holds {total}; the original entry left the main track and can move back any time from the Memory tab archive page)',
    'Archived ({target}: the archive file now holds {total}; the original entry left the main track and can move back any time from the Memory tab archive page)',
  ],
  'msg.expandKeyOnly': ['expand supports target=key only', 'expand supports target=key only'],
  'msg.expandNeedsId': ['expand needs the id parameter', 'expand needs the id parameter'],
  'msg.expandNeedsCwd': ['expand needs the session working directory', 'expand needs the session working directory'],
  'msg.expandNotFound': ['No key entry with id={id} found', 'No key entry with id={id} found'],
  'msg.expandFullText': ['Entry full text', 'Entry full text'],
  'msg.unknownAction': [
    'Unknown action "{action}" (supported: add / replace / remove / archive / list / expand)',
    'Unknown action "{action}" (supported: add / replace / remove / archive / list / expand)',
  ],
  'msg.branchWarningUnknown': [
    '(warning: branch(es) {branches} do not exist yet; entries become visible only after those branches are created)',
    '(warning: branch(es) {branches} do not exist yet; entries become visible only after those branches are created)',
  ],
  'msg.sectionContainsDelimiter': [
    'Content must not contain the entry delimiter § (it would corrupt the memory file format)',
    'Content must not contain the entry delimiter § (it would corrupt the memory file format)',
  ],
  // ── renderMemoryResult ──
  'render.currentEntries': ['Current entries ({count}):', 'Current entries ({count}):'],
  'render.matches': ['Matched entries:', 'Matched entries:'],
  'render.batchResults': ['Batch write results:', 'Batch write results:'],
  // ── feedback line ──
  'feedback.tag': ['[Feedback]', '[Feedback]'],
  'feedback.tagManual': ['[Feedback·manual]', '[Feedback·manual]'],
  'feedback.positive': ['positive', 'positive'],
  'feedback.negative': ['negative', 'negative'],
  'feedback.uncategorized': ['Uncategorized', 'Uncategorized'],
  'feedback.sentiment': ['sentiment', 'sentiment'],
  'feedback.category': ['category', 'category'],
  'feedback.quote': ['quote', 'quote'],
  'feedback.note': ['note', 'note'],
}

/** Suggest/review-status tool strings (lib/review.js). */
export const REVIEW_DICT = {
  'reviewStatus.desc': [
    'Completes the automatic memory review due every N user turns. **Do NOT call it every turn**: the due reminder is injected into the snapshot dynamically (run a review only when the "memory review is due" reminder appears); complete: call after finishing the whole review to reset the counter (skipping keeps the reminder coming next turn); check: call only to manually confirm current progress (returns due and turns since the last review).',
    'Completes the automatic memory review due every N user turns. **Do NOT call it every turn**: the due reminder is injected into the snapshot dynamically (run a review only when the "memory review is due" reminder appears); complete: call after finishing the whole review to reset the counter (skipping keeps the reminder coming next turn); check: call only to manually confirm current progress (returns due and turns since the last review).',
  ],
  'reviewStatus.action': [
    'check=query whether a review is due; complete=reset the counter after finishing a review',
    'check=query whether a review is due; complete=reset the counter after finishing a review',
  ],
  'reviewStatus.notDue': [
    'No review is due yet ({turns}/{interval}); no reset needed and the counter stays unchanged.',
    'No review is due yet ({turns}/{interval}); no reset needed and the counter stays unchanged.',
  ],
  'reviewStatus.reset': [
    'Review counter reset (the next due date counts against the new interval).',
    'Review counter reset (the next due date counts against the new interval).',
  ],
  'reviewStatus.due': [
    'A memory review is due ({turns} turns since the last one, interval {interval}): run the review, then call complete to reset.',
    'A memory review is due ({turns} turns since the last one, interval {interval}): run the review, then call complete to reset.',
  ],
  'reviewStatus.notDueYet': [
    'No memory review is due ({turns}/{interval} turns since the last one); skip reviewing this turn (and do not call complete).',
    'No memory review is due ({turns}/{interval} turns since the last one); skip reviewing this turn (and do not call complete).',
  ],
  'suggest.desc': [
    'Propose one long-term-memory suggestion (used by the review flow). It never modifies memory directly — the proposal joins a queue awaiting user confirmation; repeated content accumulates a hit count.',
    'Propose one long-term-memory suggestion (used by the review flow). It never modifies memory directly — the proposal joins a queue awaiting user confirmation; repeated content accumulates a hit count.',
  ],
  'suggest.target': [
    'Track: memory=environment/project facts, user=user facts; todo-life/todo-work/todo-project/todo-daily=todo suggestions (written into the matching todo track after confirmation)',
    'Track: memory=environment/project facts, user=user facts; todo-life/todo-work/todo-project/todo-daily=todo suggestions (written into the matching todo track after confirmation)',
  ],
  'suggest.content': ['Suggested memory entry content (multi-line allowed)', 'Suggested memory entry content (multi-line allowed)'],
  'suggest.reason': ['Why this is worth remembering (cite evidence from the session)', 'Why this is worth remembering (cite evidence from the session)'],
  'suggest.invalidTarget': [
    'Invalid target "{target}" (expected one of {valid})',
    'Invalid target "{target}" (expected one of {valid})',
  ],
  'suggest.emptyContent': ['content must not be empty', 'content must not be empty'],
  'suggest.emptyReason': ['reason must not be empty (cite evidence from the session)', 'reason must not be empty (cite evidence from the session)'],
  'suggest.queued': [
    'Suggestion queued for confirmation (queue now holds {queued}) — written only after user approval',
    'Suggestion queued for confirmation (queue now holds {queued}) — written only after user approval',
  ],
}

/** Todo tool strings (lib/todo.js). */
export const TODO_DICT = {
  'todo.desc': [
    'Todo management (four tracks: life / work / project (isolated per working directory) / daily). When the user says "remember / I need to do X", write it directly with add — **the add target follows the category the user names** ("work thing"→work, "personal"→life, "for this project"→project, "today"→daily); fall back to defaults only when unspecified (project when a working directory exists, otherwise work). **list defaults to a smart view**: only unfinished items needing attention (overdue/due today/current project/important-urgent, max 8); pass all=true or filters to see everything. **Querying the past (yesterday and older daily todos) needs one precise call: list with past=true AND expired=true** — daily todos expire the same day, so past unfinished ones are almost certainly expired already; past=true alone hides expired leftovers (showing only completed history); with both parameters you see "what yesterday\'s todos were and what went undone". **Cross-project queries**: inspect another project\'s todos with list + target=project + cwd=<that project\'s working directory>. done/update/remove operate precisely by id (list output includes ids; past daily-entry ids work the same way). For model-authored todos use memory_suggest target=todo-* (enters the confirmation queue); never add directly.',
    'Todo management (four tracks: life / work / project (isolated per working directory) / daily). When the user says "remember / I need to do X", write it directly with add — **the add target follows the category the user names** ("work thing"→work, "personal"→life, "for this project"→project, "today"→daily); fall back to defaults only when unspecified (project when a working directory exists, otherwise work). **list defaults to a smart view**: only unfinished items needing attention (overdue/due today/current project/important-urgent, max 8); pass all=true or filters to see everything. **Querying the past (yesterday and older daily todos) needs one precise call: list with past=true AND expired=true** — daily todos expire the same day, so past unfinished ones are almost certainly expired already; past=true alone hides expired leftovers (showing only completed history); with both parameters you see "what yesterday\'s todos were and what went undone". **Cross-project queries**: inspect another project\'s todos with list + target=project + cwd=<that project\'s working directory>. done/update/remove operate precisely by id (list output includes ids; past daily-entry ids work the same way). For model-authored todos use memory_suggest target=todo-* (enters the confirmation queue); never add directly.',
  ],
  'todo.action': [
    'add=create; list=view (smart view by default); done=complete; update=modify; remove=delete',
    'add=create; list=view (smart view by default); done=complete; update=modify; remove=delete',
  ],
  'todo.target': [
    'add: follow the category the user names (work→work, personal→life, project→project, today→daily), fall back to defaults only when unspecified (project with a working directory, else work); list default=composite of all four tracks; done/update/remove default=search all tracks by id',
    'add: follow the category the user names (work→work, personal→life, project→project, today→daily), fall back to defaults only when unspecified (project with a working directory, else work); list default=composite of all four tracks; done/update/remove default=search all tracks by id',
  ],
  'todo.content': [
    'Required for add: todo content (first line is the title; details may follow on more lines); for update=replacement content',
    'Required for add: todo content (first line is the title; details may follow on more lines); for update=replacement content',
  ],
  'todo.important': ['Whether important (combines with urgent into the four quadrants)', 'Whether important (combines with urgent into the four quadrants)'],
  'todo.urgent': ['Whether urgent', 'Whether urgent'],
  'todo.quadrant': [
    'Set the quadrant directly (overrides important/urgent): q1 important+urgent / q2 important+not urgent / q3 urgent+not important / q4 neither',
    'Set the quadrant directly (overrides important/urgent): q1 important+urgent / q2 important+not urgent / q3 urgent+not important / q4 neither',
  ],
  'todo.due': [
    'For add/update: due date YYYY-MM-DD; for list: today=due today or overdue, overdue=overdue only, all=any due date',
    'For add/update: due date YYYY-MM-DD; for list: today=due today or overdue, overdue=overdue only, all=any due date',
  ],
  'todo.cat': ['Category (life/work/study…)', 'Category (life/work/study…)'],
  'todo.status': [
    'list filter (default=smart view); update sets the new status',
    'list filter (default=smart view); update sets the new status',
  ],
  'todo.id': [
    'Item id as returned by list (e.g. a1b2c3d4); required for done/update/remove',
    'Item id as returned by list (e.g. a1b2c3d4); required for done/update/remove',
  ],
  'todo.date': [
    'Date for the daily track YYYY-MM-DD (default=today)',
    'Date for the daily track YYYY-MM-DD (default=today)',
  ],
  'todo.all': [
    'For list: true shows everything unfiltered (smart view is the default)',
    'For list: true shows everything unfiltered (smart view is the default)',
  ],
  'todo.past': [
    'For list: true also queries past daily todos (yesterday and older, with dates); **pair it with expired=true** — daily todos expire same-day, so unfinished past ones are always expired and hidden by default',
    'For list: true also queries past daily todos (yesterday and older, with dates); **pair it with expired=true** — daily todos expire same-day, so unfinished past ones are always expired and hidden by default',
  ],
  'todo.expired': [
    'For list: true includes expired leftover entries among the past (only takes effect with past=true; expired items without a future due date are hidden by default)',
    'For list: true includes expired leftover entries among the past (only takes effect with past=true; expired items without a future due date are hidden by default)',
  ],
  'todo.cwd': [
    'Working directory path for list (cross-project queries: inspect another project\'s target=project todos; the project track locates data by this path; default=current session working directory)',
    'Working directory path for list (cross-project queries: inspect another project\'s target=project todos; the project track locates data by this path; default=current session working directory)',
  ],
}

/** Skill-management tool strings (lib/skills.js). */
export const SKILL_DICT = {
  'skill.listHeader': ['Existing skills ({count}):', 'Existing skills ({count}):'],
  'skill.desc': [
    'Manage the skill library (default directory ~/.agents/skills, the DSH skill store): create adds a new skill (body is a full SKILL.md including --- frontmatter with single-line name and description); patch updates an existing skill (read it first; body is the full revised version); read returns a skill\'s full text; list enumerates skills. Skill names must be kebab-case class-like names (e.g. systematic-debugging); one-off task names are rejected.',
    'Manage the skill library (default directory ~/.agents/skills, the DSH skill store): create adds a new skill (body is a full SKILL.md including --- frontmatter with single-line name and description); patch updates an existing skill (read it first; body is the full revised version); read returns a skill\'s full text; list enumerates skills. Skill names must be kebab-case class-like names (e.g. systematic-debugging); one-off task names are rejected.',
  ],
  'skill.action': ['The action to perform', 'The action to perform'],
  'skill.name': ['Skill name (lowercase kebab-case)', 'Skill name (lowercase kebab-case)'],
  'skill.description': ['One-sentence description for create (when to use the skill; written into frontmatter)', 'One-sentence description for create (when to use the skill; written into frontmatter)'],
  'skill.body': [
    'Full SKILL.md content for create/patch (--- frontmatter + body: overview/steps/commands/pitfalls/verification)',
    'Full SKILL.md content for create/patch (--- frontmatter + body: overview/steps/commands/pitfalls/verification)',
  ],
  'skill.invalidName': [
    'Invalid skill name "{name}" (must be lowercase kebab-case, e.g. systematic-debugging)',
    'Invalid skill name "{name}" (must be lowercase kebab-case, e.g. systematic-debugging)',
  ],
  'skill.emptyDescription': ['description must not be empty', 'description must not be empty'],
  'skill.emptyBody': ['body must not be empty (full SKILL.md content including frontmatter)', 'body must not be empty (full SKILL.md content including frontmatter)'],
  'skill.tooLarge': ['SKILL.md exceeds the size cap of {limit} bytes', 'SKILL.md exceeds the size cap of {limit} bytes'],
  'skill.badFrontmatter': [
    'body is not a valid SKILL.md: it must start with a --- frontmatter block (single-line name and description) followed by the body. Quote the description value with double quotes (description: "..."); unquoted values containing colon+space get rejected by YAML',
    'body is not a valid SKILL.md: it must start with a --- frontmatter block (single-line name and description) followed by the body. Quote the description value with double quotes (description: "..."); unquoted values containing colon+space get rejected by YAML',
  ],
  'skill.nameMismatch': [
    'frontmatter name ({parsed}) must equal the skill name ({name})',
    'frontmatter name ({parsed}) must equal the skill name ({name})',
  ],
  'skill.descriptionMismatch': [
    'frontmatter description differs from the description argument',
    'frontmatter description differs from the description argument',
  ],
  'skill.disabledShadow': [
    'Skill "{name}" is disabled (modelInvocable: false); no write performed',
    'Skill "{name}" is disabled (modelInvocable: false); no write performed',
  ],
}

/** Snapshot injection strings (renderSnapshot / buildMemoryContext in lib/index.js). */
export const SNAPSHOT_DICT = {
  'snap.sessionNamed': [
    '## Your session (match the name/alias/ID against session ids inside module messages to tell who is who; when replying, tell the other party the name/alias and ID)',
    '## Your session (match the name/alias/ID against session ids inside module messages to tell who is who; when replying, tell the other party the name/alias and ID)',
  ],
  'snap.yourName': ['- Your session name: {title}', '- Your session name: {title}'],
  'snap.yourAlias': ['- Your session alias: {alias}', '- Your session alias: {alias}'],
  'snap.yourId': ['- Your session ID: {id}', '- Your session ID: {id}'],
  'snap.sessionPlain': [
    '## Your session ID (remember it: match it against session ids inside module messages to tell who is who; you may also give this ID to the other party when replying)',
    '## Your session ID (remember it: match it against session ids inside module messages to tell who is who; you may also give this ID to the other party when replying)',
  ],
  'snap.memoryHead': [
    '## Long-term memory (every project and session must follow this)',
    '## Long-term memory (every project and session must follow this)',
  ],
  'snap.userHead': ['## User profile', '## User profile'],
  'snap.keyHead': ['## This project\'s key memories (memory tool target=key)', '## This project\'s key memories (memory tool target=key)'],
  'snap.keyBranchHead': [
    '## This project\'s key memories (memory tool target=key; current branch: {branch}; only branch-matching entries injected)',
    '## This project\'s key memories (memory tool target=key; current branch: {branch}; only branch-matching entries injected)',
  ],
  'snap.keySummaryHead': [
    '## This project\'s key memories (memory tool target=key; summary mode — use memory action=expand+id to load full text)',
    '## This project\'s key memories (memory tool target=key; summary mode — use memory action=expand+id to load full text)',
  ],
  'snap.keySummaryBranchHead': [
    '## This project\'s key memories (memory tool target=key; summary mode, current branch: {branch}; use memory action=expand+id to load full text)',
    '## This project\'s key memories (memory tool target=key; summary mode, current branch: {branch}; use memory action=expand+id to load full text)',
  ],
  'snap.section': [
    '## Memory memory-evolve (provides the memory tool, dtodo todo tool, and skill_manage skill tool)',
    '## Memory memory-evolve (provides the memory tool, dtodo todo tool, and skill_manage skill tool)',
  ],
  'snap.sectionNoTodo': [
    '## Memory memory-evolve (provides the memory tool and skill_manage skill tool)',
    '## Memory memory-evolve (provides the memory tool and skill_manage skill tool)',
  ],
  'snap.readHint': [
    '- Reading: when needed use the memory tool to read target=project (project conventions/progress) and target=daily (today\'s log); never answer from guesswork. This project\'s key memories (target=key) are already injected into context — no need to re-read.',
    '- Reading: when needed use the memory tool to read target=project (project conventions/progress) and target=daily (today\'s log); never answer from guesswork. This project\'s key memories (target=key) are already injected into context — no need to re-read.',
  ],
  'snap.branchHint': [
    '\n- Current git branch: **{branch}** (target=key memories are filtered by branch on injection; when writing key entries you may scope them with branches=<branch name>; default=all)',
    '\n- Current git branch: **{branch}** (target=key memories are filtered by branch on injection; when writing key entries you may scope them with branches=<branch name>; default=all)',
  ],
  'snap.todoHint': [
    '- Todos (dtodo): at turn end call dtodo list to check what is due (default view: due-today/overdue first, max 8 items) — if unfinished due items exist, remind the user at the end of your reply; never expand the whole todo list unprompted; usage details (target categories, past/expired queries) live in the dtodo tool description.',
    '- Todos (dtodo): at turn end call dtodo list to check what is due (default view: due-today/overdue first, max 8 items) — if unfinished due items exist, remind the user at the end of your reply; never expand the whole todo list unprompted; usage details (target categories, past/expired queries) live in the dtodo tool description.',
  ],
  'snap.turnEndHead': [
    '- End of every turn (output your complete reply text FIRST, then attach tool calls AFTER it; calling tools first is strictly forbidden), you must:',
    '- End of every turn (output your complete reply text FIRST, then attach tool calls AFTER it; calling tools first is strictly forbidden), you must:',
  ],
  'snap.subagentTurnEndHead': [
    '- Turn end (output your complete reply text FIRST, then attach tool calls AFTER it; calling tools first is strictly forbidden):',
    '- Turn end (output your complete reply text FIRST, then attach tool calls AFTER it; calling tools first is strictly forbidden):',
  ],
  'snap.subagentWrite': [
    'Only after completing an **independent achievement** (a substantive deliverable, a key decision, or a pitfall conclusion), write ONE concise entry to {targets} with a single memory call (entries array)',
    'Only after completing an **independent achievement** (a substantive deliverable, a key decision, or a pitfall conclusion), write ONE concise entry to {targets} with a single memory call (entries array)',
  ],
  'snap.subagentKeyTail': [
    '; for important conclusions you may additionally submit a suggestion to target=key (takes effect after user confirmation); skip entirely when there is no independent achievement — do not write for writing\'s sake.',
    '; for important conclusions you may additionally submit a suggestion to target=key (takes effect after user confirmation); skip entirely when there is no independent achievement — do not write for writing\'s sake.',
  ],
  'snap.subagentSkipTail': [
    '; skip entirely when there is no independent achievement — do not write for writing\'s sake.',
    '; skip entirely when there is no independent achievement — do not write for writing\'s sake.',
  ],
  'snap.batchWriteDuty': [
    'In ONE memory call (action=add with an entries array containing one item each for {targets}) write one entry of this turn\'s progress (1-2 concrete lines)',
    'In ONE memory call (action=add with an entries array containing one item each for {targets}) write one entry of this turn\'s progress (1-2 concrete lines)',
  ],
  'snap.and': [' and ', ' and '],
  'snap.keyDuty': [
    'when durable project facts appear this turn (long-lived conventions/decisions/architecture/pitfalls), additionally submit one suggestion to target=key (written and injected after user confirmation); skip when there are none',
    'when durable project facts appear this turn (long-lived conventions/decisions/architecture/pitfalls), additionally submit one suggestion to target=key (written and injected after user confirmation); skip when there are none',
  ],
  'snap.feedbackDuty': [
    'when the human user\'s input this turn carries clear emotion (positive/negative), attach the feedback parameter to both entries (sentiment/category/quote/note; the program renders a [Feedback] line) — daily categories use generic layering (e.g. Coding/Backend/Databases, one to three levels; category means the kind of work like Coding→Frontend→JavaScript, never the feature/module name), project categories use this project\'s own layering (e.g. Memory module/write path, following actual structure); no feedback for neutral task instructions or messages from other session AIs',
    'when the human user\'s input this turn carries clear emotion (positive/negative), attach the feedback parameter to both entries (sentiment/category/quote/note; the program renders a [Feedback] line) — daily categories use generic layering (e.g. Coding/Backend/Databases, one to three levels; category means the kind of work like Coding→Frontend→JavaScript, never the feature/module name), project categories use this project\'s own layering (e.g. Memory module/write path, following actual structure); no feedback for neutral task instructions or messages from other session AIs',
  ],
  'snap.writeStep': ['1. Write: {duties};', '1. Write: {duties};'],
  'snap.reviewStep': [
    '{n}. Review: only when the snapshot shows the "memory review is due" reminder run a review (global memory via memory_suggest suggestions / direct memory writes in mode=auto; skills via skill_manage create/patch), then call memory_review_status (action=complete) to reset; with no reminder skip — do not call check.',
    '{n}. Review: only when the snapshot shows the "memory review is due" reminder run a review (global memory via memory_suggest suggestions / direct memory writes in mode=auto; skills via skill_manage create/patch), then call memory_review_status (action=complete) to reset; with no reminder skip — do not call check.',
  ],
  'snap.noTimestampTail': [
    '- Do not prefix entry content with your own time/date stamps (the program timestamps automatically).',
    '- Do not prefix entry content with your own time/date stamps (the program timestamps automatically).',
  ],
  'snap.dueWarning': [
    '\n\n⚠️ **A memory review is DUE** (interval {interval} turns, mode={mode}): finish this turn by running the review — global memory via memory_suggest suggestions (direct memory writes in mode=auto), skills via skill_manage create/patch; then call memory_review_status (action=complete) to reset.',
    '\n\n⚠️ **A memory review is DUE** (interval {interval} turns, mode={mode}): finish this turn by running the review — global memory via memory_suggest suggestions (direct memory writes in mode=auto), skills via skill_manage create/patch; then call memory_review_status (action=complete) to reset.',
  ],
  // buildMemoryContext (external-executor injections)
  'ctx.memoryGlobal': ['[Long-term memory (global)]', '[Long-term memory (global)]'],
  'ctx.userProfile': ['[User profile]', '[User profile]'],
  'ctx.keyWithBranch': ['【本项目关键记忆（分支 {branch}）】', "[This project's key memories (branch {branch})]"],
  'ctx.keyPlain': ["【本项目关键记忆】", "[This project's key memories]"],
}

/** MemoryStore user-facing result messages (lib/store.js). */
export const STORE_DICT = {
  'store.emptyContent': ['Content must not be empty', 'Content must not be empty'],
  'store.emptyMatch': ['match must not be empty', 'match must not be empty'],
  'store.fileUnreadableWrite': [
    'Memory file exists but cannot be read; write refused (protecting existing memories from being wiped)',
    'Memory file exists but cannot be read; write refused (protecting existing memories from being wiped)',
  ],
  'store.duplicate': ['Entry already exists; not added again', 'Entry already exists; not added again'],
  'store.added': ['Added ({target}: {before} → {after} entries)', 'Added ({target}: {before} → {after} entries)'],
  'store.emptyNewContent': [
    'content must not be empty (use remove to delete an entry)',
    'content must not be empty (use remove to delete an entry)',
  ],
  'store.driftGuardWrite': [
    'Write refused: {file} does not round-trip through the memory tool parser (hand-edited or modified by another process?). A backup was saved to {backup}. Re-format the file into canonical §-delimited entries first, then retry.',
    'Write refused: {file} does not round-trip through the memory tool parser (hand-edited or modified by another process?). A backup was saved to {backup}. Re-format the file into canonical §-delimited entries first, then retry.',
  ],
  'store.noMatch': ['No entry contains the substring "{match}"', 'No entry contains the substring "{match}"'],
  'store.multiMatch': [
    'The substring "{match}" matches {count} entries; use a more precise substring',
    'The substring "{match}" matches {count} entries; use a more precise substring',
  ],
  'store.replaced': ['Entry replaced ({target}: {count} entries unchanged)', 'Entry replaced ({target}: {count} entries unchanged)'],
  'store.driftGuardOp': [
    'Operation refused: {file} does not round-trip through the memory tool parser. A backup was saved to {backup}. Reformat the file first, then retry.',
    'Operation refused: {file} does not round-trip through the memory tool parser. A backup was saved to {backup}. Reformat the file first, then retry.',
  ],
  'store.fileUnreadableOp': [
    'Memory file exists but cannot be read; operation refused (avoiding entry misjudgment)',
    'Memory file exists but cannot be read; operation refused (avoiding entry misjudgment)',
  ],
  'store.removed': ['Entry deleted ({target}: {before} → {after} entries)', 'Entry deleted ({target}: {before} → {after} entries)'],
  'store.emptyEntry': ['Entry must not be empty', 'Entry must not be empty'],
  'store.sectionDelimiter': [
    'Content must not contain the entry delimiter § (it would corrupt the memory file format)',
    'Content must not contain the entry delimiter § (it would corrupt the memory file format)',
  ],
}

/** Store tail messages (archive helpers / manual edit paths, lib/store.js). */
export const STORE_TAIL_DICT = {
  'storetail.mainMissing': [
    'The main track no longer has this entry (already deleted?) — nothing was archived',
    'The main track no longer has this entry (already deleted?) — nothing was archived',
  ],
  'storetail.entryMissing': [
    'Entry not found (deleted, or the file changed externally) — refresh the list and retry',
    'Entry not found (deleted, or the file changed externally) — refresh the list and retry',
  ],
  'storetail.branchKeyOnly': ['Branch scoping applies to the key track only', 'Branch scoping applies to the key track only'],
  'storetail.dshOnlyTrackLimit': [
    'The [dsh-only] marker applies to memory / user / key tracks only',
    'The [dsh-only] marker applies to memory / user / key tracks only',
  ],
  'storetail.emptyContentTab': [
    'Content must not be empty (use the delete button to remove an entry)',
    'Content must not be empty (use the delete button to remove an entry)',
  ],
  'storetail.sectionDelimiter': [
    'Content must not contain the entry delimiter § (it would corrupt the memory file format)',
    'Content must not contain the entry delimiter § (it would corrupt the memory file format)',
  ],
  'storetail.unrecognizedPrefix': [
    'This entry lacks a recognizable tag prefix (timestamp/tag); it cannot be edited safely — open the file with a system tool and edit it manually',
    'This entry lacks a recognizable tag prefix (timestamp/tag); it cannot be edited safely — open the file with a system tool and edit it manually',
  ],
  'storetail.updated': ['Entry updated ({target})', 'Entry updated ({target})'],
  'storetail.archiveNoMatch': ['No archive entry contains the substring "{match}"', 'No archive entry contains the substring "{match}"'],
  'storetail.archiveMultiMatch': [
    'The substring "{match}" matches {count} archive entries; use a more precise substring',
    'The substring "{match}" matches {count} archive entries; use a more precise substring',
  ],
  'storetail.archiveEntryMissing': [
    'Archive entry not found (already deleted?) — refresh the list and retry',
    'Archive entry not found (already deleted?) — refresh the list and retry',
  ],
}

/** Suggestion queue / review command strings (lib/review.js). */
export const REVIEW_CMD_DICT = {
  'reviewcmd.dedup': [
    'This content was proposed before (hit #{hits}); evidence updated, awaiting user confirmation',
    'This content was proposed before (hit #{hits}); evidence updated, awaiting user confirmation',
  ],
  'reviewcmd.writtenMemory': ['✓ #{n} [{target}] written into memory', '✓ #{n} [{target}] written into memory'],
  'reviewcmd.writtenTodo': ['✓ #{n} [{target}] written into todos', '✓ #{n} [{target}] written into todos'],
  'reviewcmd.existsSkip': ['- #{n} [{target}] already exists; skipped', '- #{n} [{target}] already exists; skipped'],
  'reviewcmd.failed': ['✗ #{n} [{target}] {detail}', '✗ #{n} [{target}] {detail}'],
  'reviewcmd.remaining': ['{count} suggestion(s) pending confirmation', '{count} suggestion(s) pending confirmation'],
  'reviewcmd.emptyQueue': ['No memory suggestions are pending confirmation.', 'No memory suggestions are pending confirmation.'],
  'reviewcmd.listHead': ['Memory suggestions pending confirmation ({count}):', 'Memory suggestions pending confirmation ({count}):'],
  'reviewcmd.entryLine': [
    '{i}. [{target}] {content} (reason: {reason})',
    '{i}. [{target}] {content} (reason: {reason})',
  ],
  'reviewcmd.noReason': ['none', 'none'],
  'reviewcmd.usageApprove': ['Usage: approve <index>… (indices come from list)', 'Usage: approve <index>… (indices come from list)'],
  'reviewcmd.usageArchive': ['Usage: archive <index>… (indices come from list)', 'Usage: archive <index>… (indices come from list)'],
  'reviewcmd.usageReject': ['Usage: reject <index>… (indices come from list)', 'Usage: reject <index>… (indices come from list)'],
  'reviewcmd.rejectedSome': [
    'Rejected {count} suggestion(s). {remaining} still pending confirmation',
    'Rejected {count} suggestion(s). {remaining} still pending confirmation',
  ],
  'reviewcmd.rejectedAll': ['Rejected all {count} suggestion(s).', 'Rejected all {count} suggestion(s).'],
}

/** Misc host strings: sync stub commands, archive promotion, review command ops. */
export const MISC_DICT = {
  'misc.syncNotReady': ['Memory sync is not initialized', 'Memory sync is not initialized'],
  'misc.archiveNoMatch': [
    'No archive entry contains the substring "{match}"',
    'No archive entry contains the substring "{match}"',
  ],
  'misc.archiveMultiMatch': [
    'The substring "{match}" matches {count} archive entries; use a more precise substring',
    'The substring "{match}" matches {count} archive entries; use a more precise substring',
  ],
  'misc.promoteEmpty': ['Archive entry content is empty; cannot promote it', 'Archive entry content is empty; cannot promote it'],
  'misc.promoted': [
    'Promoted into {target} ({chars} chars); the archive entry was removed',
    'Promoted into {target} ({chars} chars); the archive entry was removed',
  ],
  'misc.unknownOp': [
    'Unknown operation "{op}" (supported: list / approve / archive / reject / approve-all / reject-all)',
    'Unknown operation "{op}" (supported: list / approve / archive / reject / approve-all / reject-all)',
  ],
}

/** Todo execute-time messages (lib/todo.js). */
export const TODO_MSG_DICT = {
  'todomsg.emptyContent': ['Todo content must not be empty', 'Todo content must not be empty'],
  'todomsg.added': ['Todo added ({target}: {count} item(s))', 'Todo added ({target}: {count} item(s))'],
  'todomsg.notFoundTrack': [
    'No todo with id "{id}" ({target} track)',
    'No todo with id "{id}" ({target} track)',
  ],
  'todomsg.notFound': ['No todo with id "{id}"', 'No todo with id "{id}"'],
  'todomsg.gone': [
    'This todo was already deleted (edited in another window?) — refresh and retry',
    'This todo was already deleted (edited in another window?) — refresh and retry',
  ],
  'todomsg.updated': ['Todo updated ({target})', 'Todo updated ({target})'],
  'todomsg.deleted': ['Todo deleted ({target})', 'Todo deleted ({target})'],
  'todomsg.invalidTarget': [
    'Invalid target "{target}" (expected one of {valid})',
    'Invalid target "{target}" (expected one of {valid})',
  ],
  'todomsg.unknownAction': ['Unknown action "{action}"', 'Unknown action "{action}"'],
}

/** Skill execute-time messages (lib/skills.js). */
export const SKILL_MSG_DICT = {
  'skillmsg.invalidNameShort': ['Invalid skill name "{name}"', 'Invalid skill name "{name}"'],
  'skillmsg.pendingMissing': ['Pending skill "{name}" does not exist', 'Pending skill "{name}" does not exist'],
  'skillmsg.alreadyInLib': [
    'Skill "{name}" already exists in the library; resolve it before adopting',
    'Skill "{name}" already exists in the library; resolve it before adopting',
  ],
  'skillmsg.listHead': ['Skill library ({count}):', 'Skill library ({count}):'],
  'skillmsg.invalidNameCase': [
    'Invalid skill name "{name}" (must be lowercase kebab-case)',
    'Invalid skill name "{name}" (must be lowercase kebab-case)',
  ],
  'skillmsg.missing': ['Skill "{name}" does not exist', 'Skill "{name}" does not exist'],
  'skillmsg.read': ['Read skill "{name}" ({bytes} bytes)', 'Read skill "{name}" ({bytes} bytes)'],
  'skillmsg.existsUsePatch': [
    'Skill "{name}" exists; use patch to update it',
    'Skill "{name}" exists; use patch to update it',
  ],
  'skillmsg.pendingDuplicate': [
    'The pending queue already holds "{name}"; do not create it twice (handle it in the settings panel)',
    'The pending queue already holds "{name}"; do not create it twice (handle it in the settings panel)',
  ],
  'skillmsg.createdPending': [
    'Skill "{name}" entered the pending queue (it joins the library only after the user adopts it in the settings panel)',
    'Skill "{name}" entered the pending queue (it joins the library only after the user adopts it in the settings panel)',
  ],
  'skillmsg.created': ['Skill "{name}" created ({bytes} bytes)', 'Skill "{name}" created ({bytes} bytes)'],
  'skillmsg.missingUseCreate': [
    'Skill "{name}" does not exist; use create first',
    'Skill "{name}" does not exist; use create first',
  ],
  'skillmsg.readFirst': [
    'Read skill "{name}" before updating it: call {tool} action=read name={name} first',
    'Read skill "{name}" before updating it: call {tool} action=read name={name} first',
  ],
  'skillmsg.updated': ['Skill "{name}" updated ({bytes} bytes)', 'Skill "{name}" updated ({bytes} bytes)'],
  'skillmsg.unknownAction': [
    'Unknown action "{action}" (supported: create / patch / read / list)',
    'Unknown action "{action}" (supported: create / patch / read / list)',
  ],
}

/** Prompt tool messages (lib/prompts.js). */
export const PROMPT_DICT = {
  'promptmsg.injectedOnce': [
    '[Injected now] Prompt "{name}" took effect (this turn only) — see the "User rules" snapshot section and follow it immediately.',
    '[Injected now] Prompt "{name}" took effect (this turn only) — see the "User rules" snapshot section and follow it immediately.',
  ],
  'promptmsg.getNeedsId': ['get needs an id (as returned by list)', 'get needs an id (as returned by list)'],
  'promptmsg.missingGet': ['Prompt not found: {id} (run list to see available prompts)', 'Prompt not found: {id} (run list to see available prompts)'],
  'promptmsg.detail': [
    '"{name}" details ({status}, injected {count} time(s))',
    '"{name}" details ({status}, injected {count} time(s))',
  ],
  'promptmsg.enabled': ['enabled', 'enabled'],
  'promptmsg.disabled': ['disabled', 'disabled'],
  'promptmsg.created': [
    'Prompt "{name}" created (category: {category}, id={id}) — inject it into the current session, or update <id> to keep editing',
    'Prompt "{name}" created (category: {category}, id={id}) — inject it into the current session, or update <id> to keep editing',
  ],
  'promptmsg.updateNeedsId': [
    'update needs an id (from list output or the create result)',
    'update needs an id (from list output or the create result)',
  ],
  'promptmsg.updateNoFields': [
    'update must change at least one field (name/content/description/category/tags/enabled)',
    'update must change at least one field (name/content/description/category/tags/enabled)',
  ],
  'promptmsg.updated': [
    'Prompt "{name}" updated (category: {category}, enabled={enabled})',
    'Prompt "{name}" updated (category: {category}, enabled={enabled})',
  ],
  'promptmsg.injectNeedsId': ['inject needs an id (as returned by list)', 'inject needs an id (as returned by list)'],
  'promptmsg.missingInject': ['Prompt not found: {id} (run list to see available prompts)', 'Prompt not found: {id} (run list to see available prompts)'],
  'promptmsg.cannotInjectDisabled': [
    '"{name}" is disabled and cannot be injected (re-enable it in the GUI prompt library)',
    '"{name}" is disabled and cannot be injected (re-enable it in the GUI prompt library)',
  ],
  'promptmsg.alreadyInjecting': [
    '"{name}" is already injecting (remove it from the GUI "Injecting" list, then inject again)',
    '"{name}" is already injecting (remove it from the GUI "Injecting" list, then inject again)',
  ],
  'promptmsg.injectNow': [
    'Injected "{name}" now: takes effect this turn, once only (ignores count/interval){tail}',
    'Injected "{name}" now: takes effect this turn, once only (ignores count/interval){tail}',
  ],
  'promptmsg.steerMissed': ['(the interjection was not delivered — it applies next turn instead)', '(the interjection was not delivered — it applies next turn instead)'],
  'promptmsg.roundsInvalid': ['rounds must be an integer ≥1, or 0 for unlimited', 'rounds must be an integer ≥1, or 0 for unlimited'],
  'promptmsg.everyInvalid': ['every must be an integer ≥0 (0 = inject once)', 'every must be an integer ≥0 (0 = inject once)'],
  'promptmsg.injectScheduled': [
    'Injected "{name}": {times}{cadence}; the model picks it up next turn{ending}',
    'Injected "{name}": {times}{cadence}; the model picks it up next turn{ending}',
  ],
  'promptmsg.unknownAction': [
    'Unknown action {action} (supported: list / get / inject)',
    'Unknown action {action} (supported: list / get / inject)',
  ],
}

/** de_session (session-orch) messages (lib/session-orch.js). */
export const SESSION_DICT = {
  'ses.msg.renameNeedsSid': ['rename needs sessionId (the session to rename)', 'rename needs sessionId (the session to rename)'],
  'ses.msg.renameNeedsOne': [
    'rename needs at least one of title (session name) or alias (session alias)',
    'rename needs at least one of title (session name) or alias (session alias)',
  ],
  'ses.msg.notLoadedRename': [
    'Session {sid} is not loaded in this process; cannot rename it (wake it first, or confirm the ID with list)',
    'Session {sid} is not loaded in this process; cannot rename it (wake it first, or confirm the ID with list)',
  ],
  'ses.msg.renameFailed': ['Renaming failed: {detail}', 'Renaming failed: {detail}'],
  'ses.msg.aliasStoreMissing': ['Alias storage unavailable (aliases.json)', 'Alias storage unavailable (aliases.json)'],
  'ses.msg.noRequester': ['Cannot resolve the current session (call context lacks an agent)', 'Cannot resolve the current session (call context lacks an agent)'],
  'ses.msg.noSelfId': ['Cannot resolve the current session ID', 'Cannot resolve the current session ID'],
  'ses.msg.spawnNeedsPrompt': [
    'spawn needs prompt (the new session\'s full brief — role/task/requirements may be one long free-form text)',
    'spawn needs prompt (the new session\'s full brief — role/task/requirements may be one long free-form text)',
  ],
  'ses.msg.badPreset': [
    'Invalid agentPreset "{preset}" (must match [a-z0-9][a-z0-9-]*, e.g. code/cordis/minimal/standard)',
    'Invalid agentPreset "{preset}" (must match [a-z0-9][a-z0-9-]*, e.g. code/cordis/minimal/standard)',
  ],
  'ses.msg.spawnFailed': ['Session creation failed: {detail}', 'Session creation failed: {detail}'],
  'ses.msg.dispatchFailed': [
    'Session {sid} was created but dispatching its initial task failed: {detail}',
    'Session {sid} was created but dispatching its initial task failed: {detail}',
  ],
  'ses.msg.spawned': [
    'Session {sid} created and task started{notes}',
    'Session {sid} created and task started{notes}',
  ],
  'ses.msg.wakeNeedsSid': ['wake needs sessionId (the session to wake)', 'wake needs sessionId (the session to wake)'],
  'ses.msg.wakeNeedsPrompt': [
    'wake needs prompt (what the other session should do, e.g. "start now: …")',
    'wake needs prompt (what the other session should do, e.g. "start now: …")',
  ],
  'ses.msg.wakeRestoreFailed': [
    'Session {sid} is not in this process and auto-restore failed (missing? cross-instance? persistence unavailable?): {detail}',
    'Session {sid} is not in this process and auto-restore failed (missing? cross-instance? persistence unavailable?): {detail}',
  ],
  'ses.msg.wakeFailed': ['Waking session {sid} failed: {detail}', 'Waking session {sid} failed: {detail}'],
  'ses.msg.wakeQueued': [
    'Delivered to session {sid} (queued). ⚠️ Delivered ≠ succeeded: confirm later that it actually runs — a restored offline session or a missing model config can fail the turn. Check de_session status after a few seconds; do not re-dispatch while it is busy',
    'Delivered to session {sid} (queued). ⚠️ Delivered ≠ succeeded: confirm later that it actually runs — a restored offline session or a missing model config can fail the turn. Check de_session status after a few seconds; do not re-dispatch while it is busy',
  ],
  'ses.msg.statusNeedsSid': ['status needs a sessionId', 'status needs a sessionId'],
  'ses.msg.statusOffline': [
    'Session is not loaded in this process (offline or nonexistent; same-instance sessions restore automatically after a restart)',
    'Session is not loaded in this process (offline or nonexistent; same-instance sessions restore automatically after a restart)',
  ],
  'ses.msg.statusLine': [
    'Session {sid} status: {status} ({detail})',
    'Session {sid} status: {status} ({detail})',
  ],
  'ses.msg.statusRunning': ['generating', 'generating'],
  'ses.msg.statusIdle': ['idle, awaiting instructions', 'idle, awaiting instructions'],
  'ses.msg.findNeedsQuery': [
    'find needs query (a name/alias/ID keyword to search for)',
    'find needs query (a name/alias/ID keyword to search for)',
  ],
  'ses.msg.broadcastDisabled': [
    'The broadcast module is disabled (turn on "session broadcast" in the runtime configuration)',
    'The broadcast module is disabled (turn on "session broadcast" in the runtime configuration)',
  ],
  'ses.msg.orchNotReady': ['Session orchestration not ready (the DSH agents service is unavailable)', 'Session orchestration not ready (the DSH agents service is unavailable)'],
  'ses.msg.unknownAction': ['Unknown action "{action}"', 'Unknown action "{action}"'],
  'ses.msg.actionFailed': ['de_session {action} failed: {detail}', 'de_session {action} failed: {detail}'],
}

/** Small-module messages: search-docs, advisor, aliases, api, canvas, update, notify. */
export const MISC2_DICT = {
  'sd.badExts': ['Invalid exts parameter (expected an array or comma-separated string of extensions)', 'Invalid exts parameter (expected an array or comma-separated string of extensions)'],
  'sd.contentNeedsQuery': ['Content search needs keywords: provide contentQuery, or supply query too (content=true reuses query)', 'Content search needs keywords: provide contentQuery, or supply query too (content=true reuses query)'],
  'sd.enabled': ['Local docs search enabled ({tool}). Provider chain: {chain}', 'Local docs search enabled ({tool}). Provider chain: {chain}'],
  'sd.disabled': ['Local docs search disabled: the tool was removed from the model-visible list', 'Local docs search disabled: the tool was removed from the model-visible list'],
  'sd.status': ['Local docs search: {state}\nTool name: {tool}\nProvider chain: {chain}\nDefault extensions: {exts}\nUsage: /memory_evolve_search_docs on|off', 'Local docs search: {state}\nTool name: {tool}\nProvider chain: {chain}\nDefault extensions: {exts}\nUsage: /memory_evolve_search_docs on|off'],
  'sd.on': ['enabled', 'enabled'],
  'sd.off': ['disabled (default)', 'disabled (default)'],
  'adv.noSession': ['Cannot identify the current session', 'Cannot identify the current session'],
  'adv.globalOff': ['The Advisor global switch is off: enable "Session review (Advisor)" under Settings → Configuration first, then toggle this session {verb}', 'The Advisor global switch is off: enable "Session review (Advisor)" under Settings → Configuration first, then toggle this session {verb}'],
  'adv.cannotReset': ['Cannot reset: Advisor is not enabled for this session or its runtime is unavailable', 'Cannot reset: Advisor is not enabled for this session or its runtime is unavailable'],
  'adv.resetDone': ['Review session restarted (#{epoch}) — the reviewer context is clear; you may provide background in your first instruction.', 'Review session restarted (#{epoch}) — the reviewer context is clear; you may provide background in your first instruction.'],
  'adv.tellEmpty': ['Instruction must not be empty: /advisor tell <instruction>', 'Instruction must not be empty: /advisor tell <instruction>'],
  'adv.tellQueued': ['Instruction queued: {text}', 'Instruction queued: {text}'],
  'adv.rateLimited': ['Review call rate-limited: {detail}', 'Review call rate-limited: {detail}'],
  'adv.droppedAfterRetries': ['Review call failed repeatedly; dropped for this turn', 'Review call failed repeatedly; dropped for this turn'],
  'adv.aborted': ['Review aborted (session destroyed or disabled)', 'Review aborted (session destroyed or disabled)'],
  'adv.deliveryFailed': ['Delivery failed (missing agent or steer threw)', 'Delivery failed (missing agent or steer threw)'],
  'adv.emptyAnswer': ['The advisor Q&A returned an empty answer', 'The advisor Q&A returned an empty answer'],
  'adv.recordTooLarge': ['Review record exceeds the size limit ({bytes} bytes); not persisted', 'Review record exceeds the size limit ({bytes} bytes); not persisted'],
  'adv.recordWriteFailed': ['Persisting the review record failed: {detail}', 'Persisting the review record failed: {detail}'],
  'adv.lineCorrupt': ['records.jsonl line {line} is corrupt and was skipped: {detail}', 'records.jsonl line {line} is corrupt and was skipped: {detail}'],
  'alias.needsSid': ['Session id must not be empty', 'Session id must not be empty'],
  'alias.cleared': ['Session alias cleared', 'Session alias cleared'],
  'alias.tooLong': ['Alias is limited to {max} chars (got {len})', 'Alias is limited to {max} chars (got {len})'],
  'alias.set': ['Session alias set to "{alias}"', 'Session alias set to "{alias}"'],
  'api.syncNotAssembled': ['Sync module is not assembled', 'Sync module is not assembled'],
  'api.archivedOk': ['Archived ({target}: the archive file now holds {count} entries; {detail})', 'Archived ({target}: the archive file now holds {count} entries; {detail})'],
  'canvas.failed': ['Canvas operation failed: {detail}', 'Canvas operation failed: {detail}'],
  'canvas.unknownError': ['unknown error', 'unknown error'],
  'upd.notGitRepo': ['The plugin directory is not a git repo or git is unavailable (install via git clone)', 'The plugin directory is not a git repo or git is unavailable (install via git clone)'],
  'upd.remoteCheckFailed': ['Remote check failed ({kind})', 'Remote check failed ({kind})'],
  'notify.missing': ['Notification {id} does not exist', 'Notification {id} does not exist'],
}

/** COI broadcast messages (lib/coi/broadcast.js). */
export const BROADCAST_DICT = {
  'bc.attachLimit': ['Too many image attachments: at most {max} (got {count})', 'Too many image attachments: at most {max} (got {count})'],
  'bc.needsCreator': ['Creator session id must not be empty', 'Creator session id must not be empty'],
  'bc.roomCreated': ['Room "{name}" created (you are a member; share room id {id} so others can room-join)', 'Room "{name}" created (you are a member; share room id {id} so others can room-join)'],
  'bc.roomMissingJoin': ['Room {id} does not exist (confirm the room id with its creator)', 'Room {id} does not exist (confirm the room id with its creator)'],
  'bc.roomDissolved': ['Room "{name}" was dissolved; cannot join', 'Room "{name}" was dissolved; cannot join'],
  'bc.joined': ['Joined room "{name}" ({count} member(s))', 'Joined room "{name}" ({count} member(s))'],
  'bc.roomMissing': ['Room {id} does not exist', 'Room {id} does not exist'],
  'bc.leftAutoDissolved': ['Left; room {id} had no members and was dissolved (records kept for traceability)', 'Left; room {id} had no members and was dissolved (records kept for traceability)'],
  'bc.left': ['Left room "{name}" ({count} member(s) remain)', 'Left room "{name}" ({count} member(s) remain)'],
  'bc.onlyCreatorDissolve': ['Only the creator can dissolve the room', 'Only the creator can dissolve the room'],
  'bc.alreadyDissolved': ['Room "{name}" is already dissolved', 'Room "{name}" is already dissolved'],
  'bc.dissolved': ['Room "{name}" dissolved', 'Room "{name}" dissolved'],
  'bc.memberNotInRoom': ['Member {member} is not in the room', 'Member {member} is not in the room'],
  'bc.kickedAutoDissolved': ['Kicked {member}; the room has no members and was dissolved', 'Kicked {member}; the room has no members and was dissolved'],
  'bc.kicked': ['Member {member} kicked ({count} member(s) remain)', 'Member {member} kicked ({count} member(s) remain)'],
  'bc.needsSender': ['Sender session id must not be empty', 'Sender session id must not be empty'],
  'bc.badRecipients': ['recipients must be a non-empty array (session IDs or room:/project: pseudo-recipients)', 'recipients must be a non-empty array (session IDs or room:/project: pseudo-recipients)'],
  'bc.sendRoomMissing': ['Room {id} does not exist (room-create first, or confirm the id with the creator and room-join)', 'Room {id} does not exist (room-create first, or confirm the id with the creator and room-join)'],
  'bc.sendRoomDissolved': ['Room "{name}" was dissolved; cannot send messages', 'Room "{name}" was dissolved; cannot send messages'],
  'bc.notMember': ['You are not a member of room "{name}" (room-join first)', 'You are not a member of room "{name}" (room-join first)'],
  'bc.projectNeedsPath': ['project: must be followed by an absolute working-directory path, e.g. project:/Volumes/data/proj', 'project: must be followed by an absolute working-directory path, e.g. project:/Volumes/data/proj'],
  'bc.emptyContent': ['Message content must not be empty', 'Message content must not be empty'],
  'bc.sent': ['Broadcast sent ({count} recipient(s){tail})', 'Broadcast sent ({count} recipient(s){tail})'],
  'bc.sentImages': [', {count} image(s)', ', {count} image(s)'],
  'bc.msgMissing': ['Message {id} does not exist', 'Message {id} does not exist'],
  'bc.msgInvisible': ['This message is not visible to the current session and cannot be read', 'This message is not visible to the current session and cannot be read'],
  'bc.msgDetail': ['Message {id} ({sender} → {recipients})', 'Message {id} ({sender} → {recipients})'],
  'bc.onlySenderOrRecipient': ['Only the sender or a recipient can delete this message', 'Only the sender or a recipient can delete this message'],
  'bc.deleted': ['Message {id} deleted', 'Message {id} deleted'],
  'bc.imagesDisabled': ['Image attachments are disabled (config broadcastImageEnabled=false; enable it to send images)', 'Image attachments are disabled (config broadcastImageEnabled=false; enable it to send images)'],
  'bc.attachFailed': ['Attachment processing failed: {detail}', 'Attachment processing failed: {detail}'],
  'bc.listHead': ['Messages ({label}: {count})', 'Messages ({label}: {count})'],
  'bc.readNeedsIds': ['read needs id or ids (message ids)', 'read needs id or ids (message ids)'],
  'bc.readDone': ['{count} message(s) read{tail}', '{count} message(s) read{tail}'],
  'bc.readSkipped': [', skipped {count} (invisible/missing)', ', skipped {count} (invisible/missing)'],
  'bc.kickRoomMissing': ['Room {id} does not exist', 'Room {id} does not exist'],
  'bc.onlyCreatorKick': ['Only the creator can kick members', 'Only the creator can kick members'],
  'bc.presenceDisabled': ['Presence tracking is not enabled', 'Presence tracking is not enabled'],
  'bc.presenceOne': ['Session {sid} presence', 'Session {sid} presence'],
  'bc.presenceList': ['Room "{name}" member presence ({online}/{total} online)', 'Room "{name}" member presence ({online}/{total} online)'],
  'bc.unknownAction': ['Unknown action "{action}"', 'Unknown action "{action}"'],
}

/** COI scheduler + command messages (lib/coi/scheduler.js, lib/coi/commands.js). */
export const COI_DICT = {
  'coi.template.name.review-code': ['Code review', 'Code review'],
  'coi.template.name.fix-tests': ['Fix tests', 'Fix tests'],
  'coi.template.name.summarize-logs': ['Summarize logs', 'Summarize logs'],
  'coi.template.name.architecture-analysis': ['Architecture analysis', 'Architecture analysis'],
  'coi.disposed': ['The scheduler has been disposed', 'The scheduler has been disposed'],
  'coi.adapterUnknownHint': ['Unknown adapter "{id}" (run de_coi_adapters to list adapters and their use cases)', 'Unknown adapter "{id}" (run de_coi_adapters to list adapters and their use cases)'],
  'coi.adapterDisabled': ['Adapter {id} ({name}) is disabled. Available adapters: {available} (see de_coi_adapters for use cases)', 'Adapter {id} ({name}) is disabled. Available adapters: {available} (see de_coi_adapters for use cases)'],
  'coi.emptyPrompt': ['Task prompt must not be empty', 'Task prompt must not be empty'],
  'coi.badScope': ['scope must be one of {valid}', 'scope must be one of {valid}'],
  'coi.noImageSupport': [
    'Adapter {id} ({name}) does not support image attachments. Image-capable adapters: codex (-i flag) / hermes (--image flag) / kimi (attach the image path in the prompt) / grok (same as kimi; unverified); zcode is text-only and cannot read images',
    'Adapter {id} ({name}) does not support image attachments. Image-capable adapters: codex (-i flag) / hermes (--image flag) / kimi (attach the image path in the prompt) / grok (same as kimi; unverified); zcode is text-only and cannot read images',
  ],
  'coi.refMissing': ['Referenced task {id} does not exist', 'Referenced task {id} does not exist'],
  'coi.dispatched': ['Dispatched {name} task {taskId} (scope={scope})', 'Dispatched {name} task {taskId} (scope={scope})'],
  'coi.taskMissing': ['Task {id} does not exist', 'Task {id} does not exist'],
  'coi.stopConfirm': ['Confirm stopping task {id} ({adapter}: {preview})? Call again with force=true to proceed', 'Confirm stopping task {id} ({adapter}: {preview})? Call again with force=true to proceed'],
  'coi.stopped': ['Task {id} stopped', 'Task {id} stopped'],
  'coi.waitAborted': ['Wait cancelled (the session was stopped)', 'Wait cancelled (the session was stopped)'],
  'coi.waitTimeout': ['Wait timed out after {timeout}ms; the task is still running — check again with de_coi_status', 'Wait timed out after {timeout}ms; the task is still running — check again with de_coi_status'],
  'coi.testAdapterUnknown': ['Unknown adapter "{id}"', 'Unknown adapter "{id}"'],
  'coi.testAdapterDisabled': ['Adapter {id} is disabled and cannot be tested', 'Adapter {id} is disabled and cannot be tested'],
  'coi.testNoCmd': ['Adapter {id} has no testCmd configured', 'Adapter {id} has no testCmd configured'],
  'coi.startFailed': ['Start failed: {detail}', 'Start failed: {detail}'],
  'coi.testStarted': ['Test task {id} started', 'Test task {id} started'],
  'coicmd.runUsage': ['Usage: /de_coi run "<task>" [--coi kimi] [--scope session] [--session <id>] [--branch <b>] [--model <m>] [--ref <taskId>] [--template <id>] [--continue] [--inject-tracks memory,user,key] [--context-text <text>]', 'Usage: /de_coi run "<task>" [--coi kimi] [--scope session] [--session <id>] [--branch <b>] [--model <m>] [--ref <taskId>] [--template <id>] [--continue] [--inject-tracks memory,user,key] [--context-text <text>]'],
  'coicmd.dispatched': ['✅ {message}\nTrack progress: /de_coi log {taskId}', '✅ {message}\nTrack progress: /de_coi log {taskId}'],
  'coicmd.noTasks': ['(no tasks yet)', '(no tasks yet)'],
  'coicmd.taskList': ['Tasks ({count}):\n{lines}', 'Tasks ({count}):\n{lines}'],
  'coicmd.logUsage': ['Usage: /de_coi log <taskId> [--tail <chars>]', 'Usage: /de_coi log <taskId> [--tail <chars>]'],
  'coicmd.stopUsage': ['Usage: /de_coi stop <taskId> [--force] (stopping needs a second confirmation; --all additionally requires --force)', 'Usage: /de_coi stop <taskId> [--force] (stopping needs a second confirmation; --all additionally requires --force)'],
  'coicmd.stopAllConfirm': ['⚠️ Stopping every task needs a second confirmation: /de_coi stop --all --force', '⚠️ Stopping every task needs a second confirmation: /de_coi stop --all --force'],
  'coicmd.stoppedMany': ['{count} task(s) stopped', '{count} task(s) stopped'],
  'coicmd.stopOneConfirm': ['⚠️ Confirm stopping task {id} ({adapter}: {preview})? Run /de_coi stop {id} --force again to confirm', '⚠️ Confirm stopping task {id} ({adapter}: {preview})? Run /de_coi stop {id} --force again to confirm'],
  'coicmd.noSessions': ['(no session records yet)', '(no session records yet)'],
  'coicmd.sessionList': ['Sessions ({count}):\n{lines}', 'Sessions ({count}):\n{lines}'],
  'coicmd.noteUsage': ['Usage: /de_coi sessions note <sessionId> <note>', 'Usage: /de_coi sessions note <sessionId> <note>'],
  'coicmd.rmUsage': ['Usage: /de_coi sessions rm <sessionId>', 'Usage: /de_coi sessions rm <sessionId>'],
  'coicmd.sessionsSubs': ['sessions subcommands: list / note <id> <note> / rm <id>', 'sessions subcommands: list / note <id> <note> / rm <id>'],
  'coicmd.adapterUnknown': ['Unknown adapter {id}', 'Unknown adapter {id}'],
  'coicmd.adapterShow': ['{id} — {name}\nType: {type}\nCommand: {cmd}\n{guide}', '{id} — {name}\nType: {type}\nCommand: {cmd}\n{guide}'],
  'coicmd.adapterGuide': ['Guide:\n{guide}', 'Guide:\n{guide}'],
  'coicmd.adaptersSubs': ['adapters subcommands: list / show <id> / test <id> / enable <id> / disable <id>', 'adapters subcommands: list / show <id> / test <id> / enable <id> / disable <id>'],
  'coicmd.templatesSubs': ['templates subcommands: list', 'templates subcommands: list'],
  'coicmd.exportUsage': ['Usage: /de_coi export <sessionId> [--coi kimi]', 'Usage: /de_coi export <sessionId> [--coi kimi]'],
  'coicmd.exportUnsupported': ['Adapter {id} does not support session export', 'Adapter {id} does not support session export'],
  'coicmd.exportStarted': ['Export task started ({cmd}); output will land in {outFile}', 'Export task started ({cmd}); output will land in {outFile}'],
}
export const HELP_EXTRA = {
  'coicmd.help': [
    `de_coi — COI 调度命令族
  /de_coi run "<任务>" [--coi kimi|codex|grok|hermes] [--scope temporary|session|project|global] [--session <id>] [--branch <b>] [--model <m>] [--ref <taskId>] [--template <id>] [--continue] [--inject-context] [--context-text <文本>]
  /de_coi list [--coi <id>] [--status <s>] [--limit <n>] [--q <关键词>]
  /de_coi log <taskId> [--tail <字符数>]
  /de_coi stop <taskId> [--force]（终止需二次确认；--all 需 --force --all）
  /de_coi sessions [list|note <id> <备注>|rm <id>] [--scope] [--branch] [--q]
  /de_coi adapters [list|show <id>|test <id>|enable <id>|disable <id>]
  /de_coi stats
  /de_coi templates list
  /de_coi export <sessionId> [--coi <id>]`,
    `de_coi — COI dispatch command family
  /de_coi run "<task>" [--coi kimi|codex|grok|hermes] [--scope temporary|session|project|global] [--session <id>] [--branch <b>] [--model <m>] [--ref <taskId>] [--template <id>] [--continue] [--inject-context] [--context-text <text>]
  /de_coi list [--coi <id>] [--status <s>] [--limit <n>] [--q <keyword>]
  /de_coi log <taskId> [--tail <chars>]
  /de_coi stop <taskId> [--force] (stopping needs a second confirmation; --all requires --force --all)
  /de_coi sessions [list|note <id> <note>|rm <id>] [--scope] [--branch] [--q]
  /de_coi adapters [list|show <id>|test <id>|enable <id>|disable <id>]
  /de_coi stats
  /de_coi templates list
  /de_coi export <sessionId> [--coi <id>]`,
  ],
}

/** COI adapters/api/index/session/tasks/tools/ws-coord messages. */
export const COI2_DICT = {
  'coi2.adapterUnknown': ['Unknown adapter "{id}"', 'Unknown adapter "{id}"'],
  'coi2.enabledMustBeBool': ['enabled must be a boolean', 'enabled must be a boolean'],
  'coi2.adapterToggled': ['{name} {state}', '{name} {state}'],
  'coi2.stateOn': ['enabled', 'enabled'],
  'coi2.stateOff': ['disabled', 'disabled'],
  'coi2.builtinUndeletable': ['Built-in adapters cannot be deleted', 'Built-in adapters cannot be deleted'],
  'coi2.skillIoUnavailable': ['Skill read/write is unavailable', 'Skill read/write is unavailable'],
  'coi2.skillExistsUnchanged': ['Skill {skill} already exists; content unchanged (edit it via the "Skill" button on the adapter page)', 'Skill {skill} already exists; content unchanged (edit it via the "Skill" button on the adapter page)'],
  'coi2.skillAutoCreated': ['Skill {skill} created automatically (visible to AI; disable it from the Skill Management tab)', 'Skill {skill} created automatically (visible to AI; disable it from the Skill Management tab)'],
  'coi2.skillCreateFailed': ['Creating the skill failed: {detail}', 'Creating the skill failed: {detail}'],
  'coi2.sessionIdEmpty': ['sessionId must not be empty', 'sessionId must not be empty'],
  'coi2.exportUnsupportedApi': ['Adapter {id} does not support session export', 'Adapter {id} does not support session export'],
  'coi2.exportStartedApi': ['Export task started; output will be written to {outFile}', 'Export task started; output will be written to {outFile}'],
  'coi2.unknownRoute': ['Unknown route {path}', 'Unknown route {path}'],
  'coi2.attachMustBeArray': ['attachments must be an array', 'attachments must be an array'],
  'coi2.attachLimit': ['At most {max} image attachments (got {count})', 'At most {max} image attachments (got {count})'],
  'coi2.attachNotObject': ['Attachment #{n} must be an object', 'Attachment #{n} must be an object'],
  'coi2.attachKindUnsupported': ['Attachment #{n}: kind "{kind}" is not supported yet (only images are supported)', 'Attachment #{n}: kind "{kind}" is not supported yet (only images are supported)'],
  'coi2.attachNoSource': ['Attachment #{n} has no source (one of path / url / attachmentId)', 'Attachment #{n} has no source (one of path / url / attachmentId)'],
  'coi2.attachMultiSource': ['Attachment #{n}: pick exactly one source (path / url / attachmentId)', 'Attachment #{n}: pick exactly one source (path / url / attachmentId)'],
  'coi2.attachFileMissing': ['Attachment #{n}: local file does not exist: {path}', 'Attachment #{n}: local file does not exist: {path}'],
  'coi2.attachNotImage': ['Attachment #{n} is not an image file (png/jpg/jpeg/webp/gif only): {path}', 'Attachment #{n} is not an image file (png/jpg/jpeg/webp/gif only): {path}'],
  'coi2.attachBadUrl': ['Attachment #{n}: url must be an http(s) address', 'Attachment #{n}: url must be an http(s) address'],
  'coi2.attachDownloadHttpFail': ['Attachment #{n}: download failed (HTTP {status}): {url}', 'Attachment #{n}: download failed (HTTP {status}): {url}'],
  'coi2.attachDownloadFail': ['Attachment #{n}: download failed: {detail}', 'Attachment #{n}: download failed: {detail}'],
  'coi2.attachSessionNeedsRuntime': [
    'Attachment #{n}: session-image references need the attachments service from a newer DSH snapshot (this process lacks it); use a path/url source instead, or restart DSH and retry',
    'Attachment #{n}: session-image references need the attachments service from a newer DSH snapshot (this process lacks it); use a path/url source instead, or restart DSH and retry',
  ],
  'coi2.attachSessionNotFound': [
    'Attachment #{n}: no matching image in the originating session (attachmentId={id}) — the image must come from a message in the current session (pasted in the browser input box)',
    'Attachment #{n}: no matching image in the originating session (attachmentId={id}) — the image must come from a message in the current session (pasted in the browser input box)',
  ],
  'coi2.attachSessionReadFail': ['Attachment #{n}: reading the session image failed: {detail}', 'Attachment #{n}: reading the session image failed: {detail}'],
  'coi2.attachSessionNoData': ['Attachment #{n}: reading the session image failed (no data returned)', 'Attachment #{n}: reading the session image failed (no data returned)'],
  'coi2.attMissingInMsg': ['Attachment not found (message {id}, image #{index})', 'Attachment not found (message {id}, image #{index})'],
  'coi2.attFileMissing': ['Attachment file missing ({name})', 'Attachment file missing ({name})'],
  'coi2.msgMissing': ['Message {id} does not exist', 'Message {id} does not exist'],
  'coi2.roomMissing': ['Room {id} does not exist', 'Room {id} does not exist'],
  'coi2.unknownRouteB': ['Unknown route {path}', 'Unknown route {path}'],
  'coi2.adapterNoSkill': ['Adapter {id} has no skill associated', 'Adapter {id} has no skill associated'],
  'coi2.skillReadFailed': ['Reading the skill failed: {detail}', 'Reading the skill failed: {detail}'],
  'coi2.skillSaved': ['Skill {skill} saved (it originates from the plugin; on restart an unchanged version will not overwrite your edit)', 'Skill {skill} saved (it originates from the plugin; on restart an unchanged version will not overwrite your edit)'],
  'coi2.skillSaveFailed': ['Saving the skill failed: {detail}', 'Saving the skill failed: {detail}'],
  'coi2.sessNeedsId': ['session id must not be empty', 'session id must not be empty'],
  'coi2.badScope': ['scope must be one of {valid}', 'scope must be one of {valid}'],
  'coi2.temporaryNotStored': ['Temporary-scope sessions are not persisted', 'Temporary-scope sessions are not persisted'],
  'coi2.sessUpdated': ['Session updated', 'Session updated'],
  'coi2.sessRegistered': ['Session registered', 'Session registered'],
  'coi2.sessMissing': ['Session {id} does not exist', 'Session {id} does not exist'],
  'coi2.noteUpdated': ['Note updated', 'Note updated'],
  'coi2.sessDeleted': ['Session {id} deleted', 'Session {id} deleted'],
  'coi2.sessNotRegistered': ['Session {id} is not registered', 'Session {id} is not registered'],
  'coi2.sessBusy': ['Session {id} is occupied by task {task} (a session cannot run multiple tasks concurrently)', 'Session {id} is occupied by task {task} (a session cannot run multiple tasks concurrently)'],
  'coi2.sessLocked': ['Session locked', 'Session locked'],
  'coi2.taskMissing': ['Task {id} does not exist', 'Task {id} does not exist'],
  'coi2.taskRunningDelete': ['Task {id} is running — stop it before deleting', 'Task {id} is running — stop it before deleting'],
  'coi2.taskDeleted': ['Task {id} deleted', 'Task {id} deleted'],
  'coi2.templateMissing': ['Template {id} does not exist', 'Template {id} does not exist'],
  'coi2.emptyPromptTemplate': ['Task prompt must not be empty (or pass templateId)', 'Task prompt must not be empty (or pass templateId)'],
  'coi2.taskStatus': ['Task {id} ({adapter}): {status}', 'Task {id} ({adapter}): {status}'],
  'coi2.taskLog': ['{logHint}\nTask {id}: {status}\n{summary}', '{logHint}\nTask {id}: {status}\n{summary}'],
  'coi2.taskSummaryHead': ['Output summary:\n{summary}', 'Output summary:\n{summary}'],
  'coi2.waitAborted': ['Wait cancelled (the session was stopped)', 'Wait cancelled (the session was stopped)'],
  'coi2.wsNoCtxDeclare': ['Cannot identify the calling session (not an agent context); skipping declaration', 'Cannot identify the calling session (not an agent context); skipping declaration'],
  'coi2.declareFailed': ['Declaration failed: {detail}', 'Declaration failed: {detail}'],
  'coi2.queryDone': ['Query complete: {locks} lock(s) held, {active} active session(s)', 'Query complete: {locks} lock(s) held, {active} active session(s)'],
  'coi2.queryFailed': ['Query failed: {detail}', 'Query failed: {detail}'],
  'coi2.wsNoCtxRelease': ['Cannot identify the calling session (not an agent context); skipping release', 'Cannot identify the calling session (not an agent context); skipping release'],
  'coi2.released': ['{count} lock(s) released', '{count} lock(s) released'],
  'coi2.releaseFailed': ['Release failed: {detail}', 'Release failed: {detail}'],
}

/** Memory-sync messages (lib/sync/index.js). */
export const SYNC_DICT = {
  'sync.workerNoOutput': ['The worker produced no output{tail}', 'The worker produced no output{tail}'],
  'sync.workerParen': [' ({detail})', ' ({detail})'],
  'sync.workerUnparseable': ['Worker output could not be parsed: {line}', 'Worker output could not be parsed: {line}'],
  'sync.projectOn': ['Sync is enabled for this project', 'Sync is enabled for this project'],
  'sync.projectOff': ['Sync is disabled for this project (memory fully retained; re-enable any time)', 'Sync is disabled for this project (memory fully retained; re-enable any time)'],
  'sync.notInitialized': ['The project is not initialized — enable sync for this project first', 'The project is not initialized — enable sync for this project first'],
  'sync.badGlobalTrack': ['Unknown global track "{track}" (expected memory/user/daily/todo)', 'Unknown global track "{track}" (expected memory/user/daily/todo)'],
  'sync.globalToggled': ['Global {track} sync {state}', 'Global {track} sync {state}'],
  'sync.stateOn': ['enabled', 'enabled'],
  'sync.stateOff': ['disabled', 'disabled'],
  'sync.globalRepoMissing': ['The global memory repo is not initialized — fill in the shared-memory repo URL below first', 'The global memory repo is not initialized — fill in the shared-memory repo URL below first'],
  'sync.noGlobalTracks': ['No global track is enabled — turn on the tracks to sync (global memory / user profile / daily log / todos)', 'No global track is enabled — turn on the tracks to sync (global memory / user profile / daily log / todos)'],
  'sync.noGlobalTracksSwitches': ['No global track is enabled — flip on the switches of the tracks to sync', 'No global track is enabled — flip on the switches of the tracks to sync'],
  'sync.sharedDisabled': ['Shared memory disabled (data and the repo URL are kept; re-enable any time)', 'Shared memory disabled (data and the repo URL are kept; re-enable any time)'],
  'sync.emptyRepoUrl': ['The shared-memory repo URL must not be empty', 'The shared-memory repo URL must not be empty'],
  'sync.sharedNotInit': ['Shared memory is not initialized — save the repo URL first', 'Shared memory is not initialized — save the repo URL first'],
  'sync.noGitRemote': ['This project has no shareable git remote — configure a remote on the main repo first (or fill in the shared-memory repo URL below)', 'This project has no shareable git remote — configure a remote on the main repo first (or fill in the shared-memory repo URL below)'],
  'sync.switchRemoteFailed': ['Switching the memory remote failed: remote set-url did not succeed (local memory unaffected)', 'Switching the memory remote failed: remote set-url did not succeed (local memory unaffected)'],
  'sync.remoteSwitched': [
    'Memory remote switched ({url}, branch {branch}). Local memory fully retained — press "Sync" for the first reconciliation (pushing needs "Sync & Push"){note}',
    'Memory remote switched ({url}, branch {branch}). Local memory fully retained — press "Sync" for the first reconciliation (pushing needs "Sync & Push"){note}',
  ],
  'sync.connected': [
    'Connected to the remote memory (branch {branch}): {message}. Press "Sync" to fetch and merge{tail}',
    'Connected to the remote memory (branch {branch}): {message}. Press "Sync" to fetch and merge{tail}',
  ],
  'sync.setupDone': [
    'Memory-sync initialization complete (branch {branch}): {message}. {pushHint}{note}',
    'Memory-sync initialization complete (branch {branch}): {message}. {pushHint}{note}',
  ],
  'sync.needSetupFirst': ['This project has not initialized sync — press "Start Sync" first', 'This project has not initialized sync — press "Start Sync" first'],
  'sync.offNeedReenable': ['Sync is disabled for this project (memory kept locally) — re-enable it in the Memory Sync tab', 'Sync is disabled for this project (memory kept locally) — re-enable it in the Memory Sync tab'],
  'sync.globalUsage': ['Usage: global on|off <memory|user|daily|todo>', 'Usage: global on|off <memory|user|daily|todo>'],
  'sync.globalStatusToggled': [
    'Global {track} sync {state} ({tracks})',
    'Global {track} sync {state} ({tracks})',
  ],
  'sync.globalNotInitShort': ['Global memory sync is not initialized — global tracks (user profile / daily log / todos) require a shared-memory repo: fill in its URL first', 'Global memory sync is not initialized — global tracks (user profile / daily log / todos) require a shared-memory repo: fill in its URL first'],
  'sync.globalUsageLong': ['Usage: global status | global on|off <memory|user|daily|todo> | global sync [--push]', 'Usage: global status | global on|off <memory|user|daily|todo> | global sync [--push]'],
  'sync.nothingToDisable': ['This project never initialized sync (nothing to disable)', 'This project never initialized sync (nothing to disable)'],
  'sync.disabledLong': ['Sync disabled for this project: memory stays fully on this machine and will no longer reconcile; re-enable any time from the Memory Sync tab', 'Sync disabled for this project: memory stays fully on this machine and will no longer reconcile; re-enable any time from the Memory Sync tab'],
  'sync.moduleDisabled': ['The memory-sync module is disabled — enable it under "Memory Evolve Settings → Configuration"', 'The memory-sync module is disabled — enable it under "Memory Evolve Settings → Configuration"'],
  'sync.moduleOnProjectNotInit': ['The module is enabled, but this project is not initialized — press "Start Sync" below', 'The module is enabled, but this project is not initialized — press "Start Sync" below'],
  'sync.resolveUsageHint': ['Usage: conflict resolve <number> ours | theirs | both [fileset] (numbers come from conflict list)', 'Usage: conflict resolve <number> ours | theirs | both [fileset] (numbers come from conflict list)'],
  'sync.resolveUsage': ['Usage: conflict resolve <number> ours | theirs | both [fileset]', 'Usage: conflict resolve <number> ours | theirs | both [fileset]'],
  'sync.conflictUsage': ['Usage: conflict list [fileset] | conflict resolve <number> ours | theirs | both [fileset]', 'Usage: conflict list [fileset] | conflict resolve <number> ours | theirs | both [fileset]'],
  'sync.noConflicts': ['No pending sync conflicts.', 'No pending sync conflicts.'],
  'sync.noLegacyDir': ['No legacy memory directory found to migrate (current identity matches the history).', 'No legacy memory directory found to migrate (current identity matches the history).'],
  'sync.legacyFound': ['Legacy memory directory found: {legacy}\n→ "Start Sync" migrates it into the new directory {dir} automatically (recorded in the migration log).', 'Legacy memory directory found: {legacy}\n→ "Start Sync" migrates it into the new directory {dir} automatically (recorded in the migration log).'],
  'sync.unknownSub': ['Unknown subcommand "{op}". Usage: setup [url] | sync [--push] | off | status | conflict list | migrate', 'Unknown subcommand "{op}". Usage: setup [url] | sync [--push] | off | status | conflict list | migrate'],
}

/** Memory-sync repo plumbing messages (lib/sync/repo.js). */
export const SYNC_REPO_DICT = {
  'syncr.probeFailed': ['Cannot reach the memory remote ({reason}): {detail}. Check network/credentials and retry', 'Cannot reach the memory remote ({reason}): {detail}. Check network/credentials and retry'],
  'syncr.adoptShared': ['The remote already has this project\'s dedicated branch {branch}; adopting it directly', 'The remote already has this project\'s dedicated branch {branch}; adopting it directly'],
  'syncr.fetchLegacyFail': ['Cannot read the content of remote branch {branch} ({detail}) — initialization stopped; check the remote and retry', 'Cannot read the content of remote branch {branch} ({detail}) — initialization stopped; check the remote and retry'],
  'syncr.gitInitFail': ['git init failed: {detail}', 'git init failed: {detail}'],
  'syncr.legacyContinue': ['Remote branch {branch} holds this project\'s memory (legacy layout) — continuing with it, zero migration', 'Remote branch {branch} holds this project\'s memory (legacy layout) — continuing with it, zero migration'],
  'syncr.freshBranch': ['{others}This project uses dedicated branch {branch}', '{others}This project uses dedicated branch {branch}'],
  'syncr.othersPresent': ['The remote already hosts other projects\' branches — ', 'The remote already hosts other projects\' branches — '],
  'syncr.freshRemote': ['Fresh memory remote — ', 'Fresh memory remote — '],
  'syncr.migrateFail': ['Memory directory migration failed: {detail}. Manually check for two same-project directories under {memoryDir}/projects/ and retry.', 'Memory directory migration failed: {detail}. Manually check for two same-project directories under {memoryDir}/projects/ and retry.'],
  'syncr.initFail': ['git init failed ({detail}) — check that git is available', 'git init failed ({detail}) — check that git is available'],
  'syncr.mainBranchFail': ['Cannot set the default branch to main ({detail})', 'Cannot set the default branch to main ({detail})'],
  'syncr.provenanceCorrupt': ['PROVENANCE exists but cannot be parsed (corrupt JSON) — inspect it manually and retry', 'PROVENANCE exists but cannot be parsed (corrupt JSON) — inspect it manually and retry'],
  'syncr.identityMismatch': [
    'Directory identity mismatch: the existing PROVENANCE belongs to project {existing} ({displayName}), but this resolves to {current}. The directory may be misused or miswired; initialization stopped',
    'Directory identity mismatch: the existing PROVENANCE belongs to project {existing} ({displayName}), but this resolves to {current}. The directory may be misused or miswired; initialization stopped',
  ],
  'syncr.commitFail': ['The initial commit failed: {detail}', 'The initial commit failed: {detail}'],
  'syncr.remoteAddFail': ['Attaching the remote failed: {detail}', 'Attaching the remote failed: {detail}'],
  'syncr.remoteUnreachable': [
    'Cannot reach the remote memory repo ({reason}): {detail}. Initialization skipped; local memory unaffected. Check network/credentials and retry.',
    'Cannot reach the remote memory repo ({reason}): {detail}. Initialization skipped; local memory unaffected. Check network/credentials and retry.',
  ],
  'syncr.bootstrapNeeded': ['Remote branch {branch} does not exist yet; initializing as a new device', 'Remote branch {branch} does not exist yet; initializing as a new device'],
  'syncr.idempotentAdopt': ['This project is already connected (setup is idempotent; no re-initialization needed)', 'This project is already connected (setup is idempotent; no re-initialization needed)'],
  'syncr.dirNotEmpty': [
    'Target directory {dir} already holds memory content ({files}) — to avoid overwriting local memory, empty the directory or handle it manually before connecting',
    'Target directory {dir} already holds memory content ({files}) — to avoid overwriting local memory, empty the directory or handle it manually before connecting',
  ],
  'syncr.gitInitFailShort': ['git init failed: {detail}', 'git init failed: {detail}'],
  'syncr.remoteAddFailShort': ['Attaching the remote failed: {detail}', 'Attaching the remote failed: {detail}'],
  'syncr.fetchFail': ['Fetching the remote memory failed: {detail}', 'Fetching the remote memory failed: {detail}'],
  'syncr.noProvenance': ['Remote branch {branch} has no PROVENANCE (identity missing) — cannot confirm it belongs to this project; connection refused (cross-project guard). Inspect the remote branch manually and retry', 'Remote branch {branch} has no PROVENANCE (identity missing) — cannot confirm it belongs to this project; connection refused (cross-project guard). Inspect the remote branch manually and retry'],
  'syncr.provenanceBroken': ['Remote branch {branch} has a corrupt PROVENANCE (unparseable JSON) — connection refused (cross-project guard). Inspect the remote branch manually and retry', 'Remote branch {branch} has a corrupt PROVENANCE (unparseable JSON) — connection refused (cross-project guard). Inspect the remote branch manually and retry'],
  'syncr.identityMismatchRemote': ['The remote memory belongs to project {projectId} ({displayName}), which does not match the current project {expected} — likely the wrong branch/repo; connection refused', 'The remote memory belongs to project {projectId} ({displayName}), which does not match the current project {expected} — likely the wrong branch/repo; connection refused'],
  'syncr.checkoutFail': ['Checking out the remote memory failed: {detail}', 'Checking out the remote memory failed: {detail}'],
  'syncr.adopted': ['Connected to the remote memory (branch {branch})', 'Connected to the remote memory (branch {branch})'],
  'syncr.globalInitFail': ['Global memory repo git init failed: {detail}', 'Global memory repo git init failed: {detail}'],
  'syncr.globalMainFail': ['Cannot set the default branch to main: {detail}', 'Cannot set the default branch to main: {detail}'],
  'syncr.globalStageFail': ['Staging the global memory file failed ({path}): {detail}', 'Staging the global memory file failed ({path}): {detail}'],
  'syncr.globalCommitFail': ['Global memory repo initial commit failed: {detail}', 'Global memory repo initial commit failed: {detail}'],
  'syncr.globalRemoteAddFail': ['Global memory repo remote attach failed: {detail}', 'Global memory repo remote attach failed: {detail}'],
  'syncr.globalRemoteSetFail': ['Global memory repo remote switch failed: {detail}', 'Global memory repo remote switch failed: {detail}'],
}

/** Memory-sync worker messages (lib/sync/worker.js). */
export const SYNC_WORKER_DICT = {
  'syncw.notInit': ['The memory repo is not initialized — press "Start Sync" in the Memory Sync tab first', 'The memory repo is not initialized — press "Start Sync" in the Memory Sync tab first'],
  'syncw.conflictsPending': ['{count} conflict(s) remain unresolved ({file}) — resolve them in the conflicts area before syncing', '{count} conflict(s) remain unresolved ({file}) — resolve them in the conflicts area before syncing'],
  'syncw.disabledResume': ['Sync is disabled for this project (memory fully kept locally) — re-enable to continue', 'Sync is disabled for this project (memory fully kept locally) — re-enable to continue'],
  'syncw.noTracksSelected': ['Project memory tracks left the sync (no sync content selected)', 'Project memory tracks left the sync (no sync content selected)'],
  'syncw.pullFail': ['Fetching the remote memory failed ({err}). Local memory unaffected; check network/credentials and retry', 'Fetching the remote memory failed ({err}). Local memory unaffected; check network/credentials and retry'],
  'syncw.branchGone': ['Remote branch {branch} no longer exists (a stale local tracking ref was cleaned up). The remote memory may have been deleted or moved — check the remote and re-initialize', 'Remote branch {branch} no longer exists (a stale local tracking ref was cleaned up). The remote memory may have been deleted or moved — check the remote and re-initialize'],
  'syncw.branchMissing': ['Remote branch {branch} does not exist — press "Start Sync" to initialize first', 'Remote branch {branch} does not exist — press "Start Sync" to initialize first'],
  'syncw.remoteInvalid': ['Remote memory data is malformed ({path}: {reason}) — sync stopped, local memory unaffected. Inspect the remote branch manually and retry', 'Remote memory data is malformed ({path}: {reason}) — sync stopped, local memory unaffected. Inspect the remote branch manually and retry'],
  'syncw.historyDiverged': ['Histories cannot be aligned (force-pushed or wrong branch?) — merge stopped, local memory unaffected. Inspect the remote branch manually and retry', 'Histories cannot be aligned (force-pushed or wrong branch?) — merge stopped, local memory unaffected. Inspect the remote branch manually and retry'],
  'syncw.baseInvalid': ['Historical data is malformed ({path}: {reason}) — merge stopped, local memory unaffected. Inspect it manually and retry', 'Historical data is malformed ({path}: {reason}) — merge stopped, local memory unaffected. Inspect it manually and retry'],
  'syncw.commitAfterMergeFail': ['Merge completed but the commit failed: {detail}. The working tree already holds the merged result; retry', 'Merge completed but the commit failed: {detail}. The working tree already holds the merged result; retry'],
  'syncw.conflictsBeforePush': ['{count} conflict(s) remain unresolved ({file}) — resolve before pushing or the remote will miss the conflicted entries', '{count} conflict(s) remain unresolved ({file}) — resolve before pushing or the remote will miss the conflicted entries'],
  'syncw.pushRejected': ['Push rejected: the remote has new commits (non-fast-forward). Press "Sync" again to fetch and merge first; never force-push', 'Push rejected: the remote has new commits (non-fast-forward). Press "Sync" again to fetch and merge first; never force-push'],
  'syncw.pushFail': ['Push failed ({detail}). The merged result is safely stored locally; retry later', 'Push failed ({detail}). The merged result is safely stored locally; retry later'],
  'syncw.unknownError': ['unknown error', 'unknown error'],
  'syncw.statusNotInit': ['not initialized', 'not initialized'],
  'syncw.statusInit': ['Initialization: {state}', 'Initialization: {state}'],
  'syncw.connectedState': ['connected', 'connected'],
  'syncw.notConnected': ['not connected to a remote', 'not connected to a remote'],
  'syncw.identityMismatchMerge': [
    'Remote memory identity missing or mismatched (local project {local}). The remote branch may be tampered with or miswired — merge refused. Check and retry',
    'Remote memory identity missing or mismatched (local project {local}). The remote branch may be tampered with or miswired — merge refused. Check and retry',
  ],
  'syncw.noConflicts': ['No pending conflicts', 'No pending conflicts'],
  'syncw.badConflictIndex': ['Conflict number {index} does not exist (valid range 1..{max})', 'Conflict number {index} does not exist (valid range 1..{max})'],
  'syncw.resolveUsage': ['Usage: conflict resolve <number> ours | theirs | both', 'Usage: conflict resolve <number> ours | theirs | both'],
  'syncw.choiceUnavailable': ['Conflict {index} has no {choice} side available (that side is empty/deleted)', 'Conflict {index} has no {choice} side available (that side is empty/deleted)'],
  'syncw.fileNotWhitelisted': ['冲突 {index} 的目标文件不在同步白名单内（{file}）——已拒绝写入', "Conflict {index}'s target file is not in the sync whitelist ({file}) — write refused"],
  'syncw.treeStepFail': ['{error} while resolving the conflict (the target entry is written back; safe to retry)', '{error} while resolving the conflict (the target entry is written back; safe to retry)'],
  'syncw.commitTreeFail': ['commit-tree failed while resolving: {detail} (the target entry is written back idempotently; retry directly)', 'commit-tree failed while resolving: {detail} (the target entry is written back idempotently; retry directly)'],
  'syncw.updateRefFail': ['update-ref failed while resolving: {detail}. The commit exists but the ref was not updated — the sidecar remains, writes are idempotent; retry', 'update-ref failed while resolving: {detail}. The commit exists but the ref was not updated — the sidecar remains, writes are idempotent; retry'],
  'syncw.resolved': ['Conflict #{index} resolved ({choice}) and committed', 'Conflict #{index} resolved ({choice}) and committed'],
}

/** COI task-completion notification mail body (lib/coi/index.js). */
export const NOTIFY_DICT = {
  'coin.head': ['[COI] Task {id} ({name}) {status}', '[COI] Task {id} ({name}) {status}'],
  'coin.subject': ['📮 Subject: Task finished: {id} ({name})', '📮 Subject: Task finished: {id} ({name})'],
  'coin.intro': ['📝 Intro: {intro}', '📝 Intro: {intro}'],
  'coin.sender': ['👤 Sender: DSH AI assistant (maestro-memory)', '👤 Sender: DSH AI assistant (maestro-memory)'],
  'coin.time': ['🕐 Time: {time}', '🕐 Time: {time}'],
  'coin.bodyHead': ['📄 Content', '📄 Content'],
}
