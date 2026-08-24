/**
 * maestro-memory — persistent long-term memory and background memory
 * review for DeepSeek Harness. Pure plugin: only public seams
 * (`systemPrompt`, `tools`, `commands`, `subagents`, `approval`), zero DSH
 * core changes, zero runtime dependencies.
 *
 * Two memory tracks:
 *   - user track (MEMORY.md / USER.md): written only by explicit user action
 *     (the `memory` tool call) or by user-confirmed suggestions;
 *   - learned track (SUGGESTIONS.jsonl): background reviews propose, the
 *     user confirms through `/memory_review`.
 *
 * The snapshot is injected as a `systemPrompt` context: DSH materializes it
 * as a user-role tail message and only re-appends when the rendered text
 * changes, so the stable system/history prefix (and its cache) is preserved.
 * @module maestro-memory
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { ArchiveStore, MemoryStore, SuggestionQueue, extractEntryDate, gitBranch, gitBranchList, parseEntryBranches, parseEntryDshOnly, parseEntrySummary, autoSummary, stripEntrySummary, todayStamp } from './store.js'
import { stripEntryId, extractEntryId, legacyIdFor } from './sync/entryid.js'
import { readAliases } from './aliases.js'
import { reviewCommand, reviewStatusTool, reviewTurnCounter, enqueueSuggestion, suggestToolDefinition } from './review.js'
import { skillManageTool } from './skills.js'
import { installApi } from './api.js'
import { installSkillsManager } from './skills-manager.js'
import { TodoStore, createTodoController } from './todo.js'
import { installMemorySync, makeProjectDirResolver } from './sync/index.js'
import { createSearchDocsController, searchDocsCommand } from './search-docs.js'
import { installBroadcast, installCoi } from './coi/index.js'
import { installNotify, installChannelSend, installSessionImages } from './notify.js'
import { buildWsCoordBlock, installWsCoord } from './coi/ws-coord.js'
import { installSession } from './session-orch.js'
import { AliasStore } from './aliases.js'
import { installSessionSearch } from './search/index.js'
import { installPrompts } from './prompts.js'
import { installModels, buildModelsSnapshotAsync } from './models.js'
import { installUiSettings } from './ui-settings.js'
import { installMermaid } from './mermaid.js'
import { installBookmarks } from './bookmarks.js'
import { installCanvas } from './canvas.js'
import { getUpdateChecker } from './update.js'
import { installAdvisor } from './advisor/index.js'
import { resolveLocale, setLocale, getLocale, translate, MEMORY_DICT, REVIEW_DICT, TODO_DICT, SKILL_DICT, SNAPSHOT_DICT, MISC_DICT } from './i18n.js'

/** Translate through the MEMORY dictionary in the active locale. */
const mt = (key, params) => translate(MEMORY_DICT, key, params)
/** Translate through the SNAPSHOT dictionary in the active locale. */
const st = (key, params) => translate(SNAPSHOT_DICT, key, params)

// Re-exported for the web API layer (api.js imports them from here).
export { gitBranch, gitBranchList } from './store.js'

export const name = 'maestro-memory'
// Plugin-level service declarations: declared services are available as ctx.xxx
// (Cordis restriction: reading an undeclared service throws
// "cannot get property 'xxx' without inject").
// tools/systemPrompt are historic declarations; agents was added on 2026-08-09 — the
// session orchestration module (de_session) needs it to create/wake sessions
// (previously used ctx.inject(['agents']) for dynamic injection which left tools
// unregistered; declarative injection is now as reliable as tools);
// workspace was added in the same batch — spawn needs to attach new sessions to the
// workspace ("Project" group in the left session list, otherwise new sessions fall under "Ungrouped");
// sessionTitle was added the same day — de_session rename updates the session title (left list header).
// sessionPersistence was added on 2026-08-11 — de_session wake needs to read the
// last model used for that session from its log (request/header), otherwise the restored
// agent.options is empty and the {{model}} variable is unset, causing the woken session turn to fail.
// settings / llm were added on 2026-08-11 — the model configuration module (de_models tool +
// "Model Settings" tab) needs to read the model directory (settings.get) and provider/thinking-level
// metadata (llm.listConfigurableProviders / resolveModelInfo).
export const inject = ['tools', 'systemPrompt', 'agents', 'workspaceRegistry', 'sessionTitle', 'sessionPersistence', 'settings', 'llm']

/** Plugin config defaults (conservative: review off, memory on). */
export const DEFAULTS = {
  // storage
  memoryDir: null, // null → <dshHome>/memories
  entryDatePrefix: true,
  // daily / project memory (per-turn proactive writes — never injected, see renderSnapshot)
  perTurnProjectWrites: true, // snapshot hint requires a per-turn project write check
  perTurnDailyWrites: true,   // snapshot hint requires a per-turn daily write check
  perTurnKeyWrites: true,     // snapshot hint: importance-gated project KEY writes (injected)
  keyBranchFilter: true,      // static (config.yaml only): inject only KEY entries whose branch scope matches the session's git branch
  // Progressive disclosure for the key track (2026-08-15): inject summaries to save tokens, expand on demand for full text
  keyProgressiveDisclosure: 'off', // 'auto' | 'off' | 'on' — auto=full injection for small data, summary injection for large; off=always full (default); on=always summary
  keyFullInjectThreshold: 3,  // auto mode: entry count ≤ this → full injection
  keyFullInjectCharLimit: 1500, // auto mode: total chars ≤ this → full injection
  // snapshot injection
  injectMemory: true,
  snapshotOrder: 500,
  injectionScan: true,
  // tools / command names
  toolName: 'memory',
  suggestToolName: 'memory_suggest',
  commandName: 'memory_review',
  skillManageToolName: 'skill_manage',
  todoToolName: 'dtodo',
  // Runtime toggle for todo capability (on by default; when off, the dtodo tool, todo tab, and due reminders
  // all exit together while data and sync tracks are retained). Backward compat: missing key in old config/state files
  // is treated as enabled to preserve existing behavior.
  todoEnabled: true,
  // skill management
  skillDir: null, // null → ~/.agents/skills (the DSH skill library)
  skillMaxBytes: 65536,
  // background review (in-turn, prompt-driven: the main LLM reviews itself
  // when the turn counter reaches the interval)
  reviewEnabled: false,
  reviewInterval: 5,
  reviewMode: 'suggest', // 'suggest' | 'auto' — suggest = global facts go through memory_suggest (user confirms); auto = direct memory writes
  skillReviewEnabled: false, // off by default: skill creations queue for user confirmation (on = direct, no approval)
  memoryTabEnabled: true, // session memory tab in the web GUI (default ON — the settings-panel entry is gone, the tab is the only surface)
  suggestionsFile: null, // null → <memoryDir>/SUGGESTIONS.jsonl
  stateFile: null, // null → <memoryDir>/plugin-state.json (runtime config overrides)
  // local file search (search_local_files; default OFF — the tool is not
  // registered at all, so the model never sees it)
  searchDocsEnabled: false,
  // Four-mode setting (decided 2026-08-09): all=file name+content / filename=file name only /
  // content=content only / off=tool not registered. **null = not set** — the effective value is
  // resolved by the controller via three levels: runtime mode → config mode → legacy boolean inference
  // (not inferred here to avoid the inferred value overriding runtime Web panel/slash command switches).
  searchDocsMode: null,
  searchDocsToolName: 'memory_evolve_search_local_files',
  searchDocsCommandName: 'memory_evolve_search_files',
  searchDocsExts: ['md'],
  searchDocsProviders: 'auto', // 'auto' | ['mdfind','es','rg','walk'] — replaceable implementations
  searchDocsCacheTtlMs: 3600000, // walk cache TTL (1h)
  searchDocsTimeoutMs: 60000, // per-layer search timeout upper bound
  searchDocsCacheFile: null, // null → <memoryDir>/search-docs-index.json
  // COI orchestration (de_coi: unified orchestration for kimi/codex/grok/hermes and other CLI agents)
  coiEnabled: false,          // COI master switch (disabled by default, consistent with local search; can be toggled at runtime via Memory tab, tools/commands take effect immediately, tab appears after refresh)
  coiDataDir: null,           // null → <memoryDir>/coi
  coiSummaryEnabled: true,    // auto-summarize completed tasks into project/daily memory
  coiSyncSkills: true,        // sync built-in adapter skills (skills/ directory) to the skill library on startup (plugin is source of truth)
  coiNotifyCommand: null,     // completion notification command template (placeholders {taskId}{coi}{status}{summary}; null=no notification)
  coiRetentionDays: 90,       // task archive retention in days (auto-cleanup after expiry)
  coiTaskTimeoutMs: 43200000, // default task timeout (12 hours; AI agent tasks can run for hours, timeout is only a safety net)
  coiMaxLogBytes: 2097152,    // per-task archive size limit (2 MiB)
  // Session broadcast (de_broadcast): **standalone sub-module** (decided 2026-08-08: clearly
  // independent sub-modules should not be nested under another — previously tied to coiEnabled which caused coupled switches and tool context pollution), with independent switch and storage directory; when enabled, registers de_broadcast tool +
  // snapshot "Session Broadcast" section + copy-session-ID button in session header; off by default
  broadcastEnabled: false,
  broadcastDataDir: null,     // null → <memoryDir>/broadcast
  // Broadcast image-attachment sub-switch (P3 2026-08-11, with 260810 snapshot image mechanism): de_broadcast
  // send supports image attachments (three sources: path/url/base64, stored in <broadcast dir>/attachments/,
  // message JSON keeps only metadata; GUI inbox shows thumbnails + AI read gets file path). **Depends on
  // broadcastEnabled master switch** (attachments are entirely disabled when broadcast is off); on by default (sending images is a basic chat capability, available as soon as broadcast is enabled; when off, send with attachments fails explicitly instead of being silently ignored).
  broadcastImageEnabled: true,
  // Workspace conflict coordination (ws-coord): **sub-feature group of the session broadcast module** (decided
  // 2026-08-09 — semantically "part of notifications", grouped under broadcast, not a standalone module).
  // Coordinates resource contention when multiple sessions run in the same workspace: declared locks (de_ws_declare) +
  // auto-registration (fs/observed writes automatically join the occupancy set) + pre-write conflict detection (soft mode:
  // warn without blocking, trust AI first; enforceWrite enables hard blocking) + directed conflict
  // notifications + activity awareness (de_ws_status overview / snapshot [Workspace Activity] section). Depends on
  // broadcastEnabled master switch (when broadcast is off, none of this is registered). Off by default.
  wsCoordEnabled: false,
  wsCoordEnforceWrite: false, // hard-blocking mode (true=deny writes on conflict; default soft mode only warns)
  wsCoordSnapshot: true,      // activity-aware snapshot section [Workspace Activity] (injects one line with timestamp when active sessions >=2)
  wsCoordAutoRegister: true,  // fs/observed auto-registration (false=declared locks only)
  wsCoordNotifyConflict: true,// send directed notification to occupants on conflict (via broadcast channel)
  // Session search (de_session_search): **standalone sub-module** (same discipline as broadcast — not nested
  // under any module). Independent switch; zero persistent state (no index/cache/timer, each call does a live read-only scan); currently supports Codex source (~/.codex/sessions + archived_sessions
  // plaintext JSONL, rg pre-filtered in milliseconds), DSH sessions (zstd concatenated frames) not yet implemented.
  // Off by default: registration occupies model tool list, enable only when needed.
  sessionSearchEnabled: false,
  sessionSearchRoots: null,   // per-source root overrides (currently only codex, e.g. { codex: '/path' }); null=defaults per source
  // Session orchestration (de_session): **standalone sub-module** (discipline: independent domain
  // not nested under another). Programmatically creates/wakes DSH sessions (spawn dispatches long prompt in new session,
  // wake wakes existing session equivalent to user sending a message, status/list query state). Independent switch
  // and storage directory; off by default (registration occupies model tool list). Depends on DSH agents service,
  // only in-process sessions can be woken; spawn room bridging is loosely coupled via broadcast module.
  sessionEnabled: false,
  sessionDataDir: null,       // null → <memoryDir>/session-orch
  promptsEnabled: false,      // prompt manager master switch (disabled by default, consistent with local search/COI; when enabled, "Prompts" tab, injection track and de_prompts tool become active)
  promptToolName: 'de_prompts', // prompt library tool name (AI queries/injects prompts; registered/unregistered with promptsEnabled)
  // Model configuration (de_models + "Model Settings" tab): **standalone sub-module** (same independent switch pattern as other modules). Table shows DSH providers/models + per-model enable/notes/thinking-level
  // configuration; de_models tool lets AI query available model list. **Off by default** (consistent with other
  // standalone modules: registration occupies model tool list, enable when needed; and this module's config
  // only applies to the plugin itself — it does not modify or affect DSH model settings, which remain governed by the official "Settings → Models" page).
  modelsEnabled: false,
  // DSH UI settings (dsh-ui-settings): **standalone sub-module** (same discipline as broadcast/COI —
  // independent domain not nested under another). Small style-level features for DSH web UI (v1: "Show active only" filter for left session list, showing only active sessions by default with one-click toggle to show all;
  // future: theme switching, etc.). Pure client-side implementation (CSS + DOM enhancement), host only provides
  // switch and status endpoints; **off by default** (consistent with other standalone modules, enable when needed).
  uiSettingsEnabled: false,
  // Session bookmarks: **standalone sub-module** (same discipline as broadcast/UI settings —
  // independent domain not nested under another). Per-turn starring + bookmark list + jump-to-position (phase 1);
  // phase 2 will add "create official branch from here". Pure UI + host API (no AI tools registered);
  // stored in standalone sidecar <memoryDir>/session-bookmarks.json; **off by default**.
  bookmarkEnabled: false,
  // Channel notifications (de_notify): **standalone sub-module** (same discipline as broadcast/COI — independent domain
  // not nested under another). After AI completes a task, proactively **sends notifications** to the user via IM channels (phase 1: Feishu). Channel capability comes from channel plugins (dsh-feishu and other **public plugins**) registered in the globalThis registry at apply time (chosen approach A) — this module has **zero dependency** on channel plugins
  // (not installed / old version without hook → honestly reports "channel unavailable", main plugin unaffected). Two triggers:
  // ① de_notify manual tool (can be sent anytime, no rate limit — as decided);
  // ② COI completion auto-notification (COI runtime config coiNotifyChannels, loosely bridged via sendChannelNotify
  // callback, silently skipped on COI side when notify is not enabled). **Off by default** (consistent with other
  // standalone modules: registration occupies model tool list, enable when needed).
  notifyEnabled: false,
  // Channel direct send (de_channel_send): **standalone sub-module** (decided 2026-08-10 — same discipline as
  // notify: independent domain with independent switch; generalized that day from de_feishu_send to four channels:
  // feishu/qq/weixin/wecom). AI proactively sends text/images/files to IM channels (DSH→channel
  // one-way, without "non-conversation" notification label). Channel capability comes from channel plugins (dsh-feishu /
  // dsh-qqbot / dsh-weixin / dsh-wecombot) via globalThis registry (sendMedia slot, plugin version must support attachments). **On by default** (requested feature, works out of the box;
  // independent from notifyEnabled: direct send vs notification, different semantics and independent switch granularity).
  channelSendEnabled: true,
  // Current-session image query (de_session_images): **standalone sub-module** (2026-08-11 P1 task —
  // same family as channel send but semantically independent: lists recent image references in the current session, AI queries first then sends).
  // Independent switch sessionImageQueryEnabled (**off** by default, consistent with other standalone modules: registration occupies
  // model tool list, enable when needed; and depends on DSH 260810+ snapshot attachments service,
  // queries on old versions will report honestly). When enabled, registers de_session_images tool; when disabled, fully uninstalled.
  sessionImageQueryEnabled: false,
  // Project memory cross-device sync (/memory_sync): **standalone sub-module** (independent domain with independent switch
  // discipline). syncEnabled is **off** by default — when off, per-project/per-machine behavior is byte-for-byte identical to current status;
  // when on: setup initializes memory git repo (mode A reuses main repo dsh-shared/memory
  // branch / mode B private repo), sync pulls and merges (fetch outside lock / merge inside lock / dual-parent commit),
  // sync --push explicit push (**push always requires user consent**, requirement #12). Phase 1 scope =
  // project tracks (KEY + project log + KEY-archive), global tracks in phase 2.
  syncEnabled: false,
  // Advisor review capability (lib/advisor/): **standalone sub-module** (same discipline as broadcast/COI
  // — independent domain not nested under another). Per-session independent review model: observes main session,
  // uses "user-visible text surface" as input (excluding thinking/tool calls), reviews in real time,
  // delivers suggestions via steer, right floating panel shows input/output live, user can send instructions, review
  // records persisted as JSONL (<advisorDataDir>/records.jsonl). **Off by default** (consistent with other standalone modules, enable when needed); provider/model defaults to empty = inherit session
  // model (agent.options), configuring only one = gate disabled (config-incomplete).
  advisorEnabled: false,
  advisorDataDir: null,           // null → <memoryDir>/advisor
  advisorProvider: null,          // review provider routing (both empty = inherit session model)
  advisorModel: null,             // review model id (both empty = inherit session model)
  advisorSystemPrompt: '',        // override built-in review prompt (≤8KB; empty = built-in default)
  advisorPanelEnabled: true,      // floating panel visibility switch (decoupled from review execution)
  advisorImmuneTurns: 0,          // cooldown turns (0=unlimited, as decided; fence path retained)
  advisorSteerSeverities: ['nit', 'concern', 'blocker'], // full steer (as decided), can be tightened later
  // Q1 (decided 2026-08-12): info-level suggestions are only recorded by default, not injected (visible in panel,
  // session flow undisturbed); when enabled, info goes via inject (never steer)
  advisorInfoInject: false,
  advisorMaxMessages: 60,         // review input bounded window (0=unlimited)
  advisorMaxQueued: 32,           // review queue upper bound (full=drop-newest)
  advisorCallTimeoutMs: 60000,    // per-review call timeout (positive integer)
  // Infinite canvas (de_canvas + Canvas tab): **standalone sub-module** (discipline —
  // independent domain not nested under another). Local path references + single-board + view filtering + AI bidirectional
  // pull (not injected via snapshot) + AI only adds/queries/edits without touching layout + AI outputs default to notes written
  // to the session board center + write without confirmation (only for adding session notes) + simplified security (AI only reads nodes already on board). Stored at <memoryDir>/canvas/boards.json (whole-board atomic write + rev optimistic lock
  // to prevent multi-session concurrent overwrites). Off by default (consistent with other standalone modules).
  canvasEnabled: false,
}

/** Keys the Web UI may change at runtime (persisted to stateFile). */
export const RUNTIME_KEYS = [
  'reviewEnabled', 'reviewInterval', 'reviewMode', 'skillReviewEnabled',
  'perTurnProjectWrites', 'perTurnDailyWrites', 'perTurnKeyWrites',
  'keyProgressiveDisclosure', 'keyFullInjectThreshold', 'keyFullInjectCharLimit',
  'searchDocsEnabled', 'coiEnabled', 'broadcastEnabled', 'promptsEnabled',
  'sessionSearchEnabled', 'sessionEnabled', 'modelsEnabled', 'uiSettingsEnabled',
  'bookmarkEnabled', 'searchDocsMode', 'todoEnabled',
  'wsCoordEnabled', 'wsCoordEnforceWrite', 'wsCoordSnapshot',
  'notifyEnabled', 'channelSendEnabled', 'broadcastImageEnabled',
  'sessionImageQueryEnabled', 'syncEnabled',
  'advisorEnabled', 'advisorProvider', 'advisorModel', 'advisorSystemPrompt',
  'advisorPanelEnabled', 'advisorImmuneTurns', 'advisorSteerSeverities',
  'advisorInfoInject',
  'advisorMaxMessages', 'advisorMaxQueued', 'advisorCallTimeoutMs',
  'canvasEnabled',
]

/** Validate one runtime-config patch value against its key. */
export function validateRuntimePatch(key, value) {
  switch (key) {
    case 'reviewEnabled':
    case 'skillReviewEnabled':
    case 'perTurnProjectWrites':
    case 'perTurnDailyWrites':
    case 'perTurnKeyWrites':
    case 'searchDocsEnabled':
    case 'searchDocsMode':
      if (key === 'searchDocsMode') {
        // null = not set (controller infers effective tier from searchDocsEnabled).
        // ⚠️ GET /api/config echoes null (runtime={...config} placeholder from
        // DEFAULTS), saving must allow it, otherwise the settings panel fails on save.
        if (value !== null && !['all', 'filename', 'content', 'off'].includes(value)) {
          throw new Error('maestro-memory: searchDocsMode must be one of all / filename / content / off (or null to restore default inference)')
        }
        return
      }
      if (typeof value !== 'boolean') throw new Error(`maestro-memory: ${key} must be a boolean`)
      return
    case 'coiEnabled':
    case 'broadcastEnabled':
    case 'promptsEnabled':
    case 'sessionSearchEnabled':
    case 'sessionEnabled':
    case 'modelsEnabled':
    case 'uiSettingsEnabled':
    case 'bookmarkEnabled':
    case 'todoEnabled':
    case 'wsCoordEnabled':
    case 'wsCoordEnforceWrite':
    case 'wsCoordSnapshot':
    case 'notifyEnabled':
    case 'channelSendEnabled':
    case 'broadcastImageEnabled':
    case 'sessionImageQueryEnabled':
    case 'syncEnabled':
    case 'canvasEnabled':
      if (typeof value !== 'boolean') throw new Error(`maestro-memory: ${key} must be a boolean`)
      return
    case 'reviewInterval':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        throw new Error('maestro-memory: reviewInterval must be >= 1')
      }
      return
    case 'reviewMode':
      if (value !== 'suggest' && value !== 'auto') throw new Error('maestro-memory: reviewMode must be "suggest" or "auto"')
      return
    case 'advisorEnabled':
    case 'advisorPanelEnabled':
    case 'advisorInfoInject':
      if (typeof value !== 'boolean') throw new Error(`maestro-memory: ${key} must be a boolean`)
      return
    case 'advisorProvider':
    case 'advisorModel':
      if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
        throw new Error(`maestro-memory: ${key} must be null (inherit session model) or a non-empty string`)
      }
      return
    case 'advisorSystemPrompt':
      if (typeof value !== 'string') throw new Error('maestro-memory: advisorSystemPrompt must be a string')
      if (value.length > 8192) throw new Error('maestro-memory: advisorSystemPrompt exceeds limit (max 8192 characters)')
      return
    case 'advisorImmuneTurns':
    case 'advisorMaxMessages':
    case 'advisorMaxQueued':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`maestro-memory: ${key} must be a non-negative integer`)
      }
      return
    case 'advisorCallTimeoutMs':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error('maestro-memory: advisorCallTimeoutMs must be a positive integer')
      }
      return
    case 'advisorSteerSeverities':
      if (!Array.isArray(value) || value.length === 0 || !value.every((s) => s === 'nit' || s === 'concern' || s === 'blocker')) {
        throw new Error('maestro-memory: advisorSteerSeverities must be a non-empty array with elements nit/concern/blocker')
      }
      return
    case 'keyProgressiveDisclosure':
      if (value !== 'auto' && value !== 'off' && value !== 'on') {
        throw new Error('maestro-memory: keyProgressiveDisclosure must be "auto" / "off" / "on"')
      }
      return
    case 'keyFullInjectThreshold':
    case 'keyFullInjectCharLimit':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error(`maestro-memory: ${key} must be a positive integer`)
      }
      return
    default:
      throw new Error(`maestro-memory: unknown runtime config key "${key}"`)
  }
}

/** Load persisted runtime overrides (stateFile); a missing file is empty. */
function loadState(stateFile) {
  try {
    const text = readFileSync(stateFile, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

/** Atomically persist runtime overrides. */
function saveState(stateFile, state) {
  writeFileSync(`${stateFile}.tmp.${process.pid}`, JSON.stringify(state, null, 2) + '\n')
  renameSync(`${stateFile}.tmp.${process.pid}`, stateFile)
}

const POSITIVE_NUMBER_KEYS = [
  'snapshotOrder', 'reviewInterval', 'skillMaxBytes',
  'searchDocsCacheTtlMs', 'searchDocsTimeoutMs',
  'coiRetentionDays', 'coiTaskTimeoutMs', 'coiMaxLogBytes',
  'advisorCallTimeoutMs',
]
const BOOLEAN_KEYS = [
  'injectMemory', 'injectionScan', 'reviewEnabled', 'skillReviewEnabled',
  'entryDatePrefix', 'memoryTabEnabled', 'keyBranchFilter',
  'perTurnProjectWrites', 'perTurnDailyWrites', 'perTurnKeyWrites',
  'searchDocsEnabled', 'coiEnabled', 'coiSummaryEnabled', 'coiSyncSkills',
  'promptsEnabled', 'sessionSearchEnabled', 'sessionEnabled', 'todoEnabled',
  'notifyEnabled', 'channelSendEnabled', 'broadcastImageEnabled',
  'sessionImageQueryEnabled', 'syncEnabled',
  'advisorEnabled', 'advisorPanelEnabled',
  'canvasEnabled',
]
const STRING_KEYS = [
  'toolName', 'suggestToolName', 'commandName', 'reviewMode',
  'skillManageToolName', 'searchDocsToolName', 'searchDocsCommandName',
  'promptToolName',
]

/**
 * Validate raw config and fill defaults. Throws loud on invalid values so
 * misconfiguration fails at load.
 * @param {object} [raw] - the raw cordis config.
 * @returns {object} the resolved config.
 */
export function resolveConfig(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('maestro-memory: config must be an object')
  }
  const config = { ...DEFAULTS }
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    if (!(key in DEFAULTS)) throw new Error(`maestro-memory: unknown config key "${key}"`)
    config[key] = value
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  config.memoryDir = resolve(config.memoryDir ?? join(home, 'memories'))
  config.suggestionsFile = resolve(config.suggestionsFile ?? join(config.memoryDir, 'SUGGESTIONS.jsonl'))
  config.skillDir = resolve(config.skillDir ?? join(homedir(), '.agents', 'skills'))
  for (const key of POSITIVE_NUMBER_KEYS) {
    const value = config[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`maestro-memory: ${key} must be a positive number`)
    }
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof config[key] !== 'boolean') {
      throw new Error(`maestro-memory: ${key} must be a boolean`)
    }
  }
  for (const key of STRING_KEYS) {
    if (typeof config[key] !== 'string' || config[key].length === 0) {
      throw new Error(`maestro-memory: ${key} must be a non-empty string`)
    }
  }
  if (config.reviewMode !== 'suggest' && config.reviewMode !== 'auto') {
    throw new Error('maestro-memory: reviewMode must be "suggest" or "auto"')
  }
  // MAJOR-4（Review）：Advisor static config validation（same rules as validateRuntimePatch，
  // prevent illegal static values / corrupted state bypassing runtime validation）
  if (!Number.isInteger(config.advisorMaxMessages) || config.advisorMaxMessages < 0) {
    throw new Error('maestro-memory: advisorMaxMessages must be a non-negative integer (0 = no limit)')
  }
  if (!Number.isInteger(config.advisorMaxQueued) || config.advisorMaxQueued < 1) {
    throw new Error('maestro-memory: advisorMaxQueued must be a positive integer')
  }
  if (!Number.isInteger(config.advisorImmuneTurns) || config.advisorImmuneTurns < 0) {
    throw new Error('maestro-memory: advisorImmuneTurns must be a non-negative integer')
  }
  if (typeof config.advisorSystemPrompt !== 'string' || config.advisorSystemPrompt.length > 8192) {
    throw new Error('maestro-memory: advisorSystemPrompt must be a string (≤8192 chars)')
  }
  // Q1（Round 1 optimization）：info injection boolean
  if (typeof config.advisorInfoInject !== 'boolean') {
    throw new Error('maestro-memory: advisorInfoInject must be a boolean')
  }
  if (!Array.isArray(config.advisorSteerSeverities) || config.advisorSteerSeverities.length === 0
    || !config.advisorSteerSeverities.every((s) => s === 'nit' || s === 'concern' || s === 'blocker')) {
    throw new Error('maestro-memory: advisorSteerSeverities must be a non-empty array with elements nit/concern/blocker')
  }
  for (const key of ['advisorProvider', 'advisorModel']) {
    if (config[key] !== null && (typeof config[key] !== 'string' || config[key].trim() === '')) {
      throw new Error(`maestro-memory: ${key} must be null or a non-empty string`)
    }
  }
  if (config.reviewInterval < 1) {
    throw new Error('maestro-memory: reviewInterval must be >= 1')
  }
  if (!Array.isArray(config.searchDocsExts) || config.searchDocsExts.length === 0
    || config.searchDocsExts.some((ext) => typeof ext !== 'string' || !/^[a-z0-9]{1,10}$/.test(ext.toLowerCase().replace(/^\./, '')))) {
    throw new Error('maestro-memory: searchDocsExts must be a non-empty array of extensions (e.g. ["md","docx"])')
  }
  config.searchDocsExts = config.searchDocsExts.map((ext) => ext.toLowerCase().replace(/^\./, ''))
  config.coiDataDir = resolve(config.coiDataDir ?? join(config.memoryDir, 'coi'))
  config.advisorDataDir = resolve(config.advisorDataDir ?? join(config.memoryDir, 'advisor'))
  config.sessionDataDir = resolve(config.sessionDataDir ?? join(config.memoryDir, 'session-orch'))
  if (config.coiNotifyCommand !== null && (typeof config.coiNotifyCommand !== 'string' || config.coiNotifyCommand.trim() === '')) {
    throw new Error('maestro-memory: coiNotifyCommand must be a string or null')
  }
  if (config.searchDocsProviders !== 'auto'
    && (!Array.isArray(config.searchDocsProviders) || config.searchDocsProviders.length === 0
      || config.searchDocsProviders.some((name) => typeof name !== 'string' || name.length === 0))) {
    throw new Error('maestro-memory: searchDocsProviders must be "auto" or a non-empty provider name array')
  }
  return config
}

/**
 * Render the memory snapshot injected into the model context. Live reads are
 * intentional: DSH's runtime-context materialization only appends when the
 * rendered text changes, so mid-session memory writes surface at the next
 * step as a tail message while the stable prefix stays cached. The slow-
 * moving tracks are rendered here — global memory/user AND the per-project
 * KEY track (projects/<hash>/KEY.md, scoped to this agent's cwd): KEY facts
 * change rarely (only when something important happens, never per-turn), so
 * injecting them with live reads gives real-time change monitoring at a
 * cache-friendly cost, exactly like the global tracks. The project log and
 * the daily log change on every write, and injecting them would append a
 * new tail snapshot per turn and defeat prefix caching — they stay on-demand
 * via the memory tool, with a fixed per-turn write duty in the hint below.
 * @param {object} config - resolved config.
 * @param {MemoryStore} store - the memory store.
 * @param {object|null} [sessionTitleService] - DSH sessionTitle service (optional,
 *   for displaying session name; when unavailable/not passed, name is not shown — graceful degradation).
 * @returns {string} the snapshot text (empty when nothing is stored).
 */
export function renderSnapshot(config, store, agent, counter, sessionTitleService = null) {
  const parts = []
  // Session ID segment (a standalone output at the very front of the snapshot, always injected, independent of any module toggle):
  // The AI always knows "who I am" — broadcast messages determine sender/recipients, and when replying
  // it tells the other party this ID, and future consumers of other modules also need it. Fixed text (within a session
  // lifecycle it never changes, cache-friendly); no session view (subagent etc.) is injected.
  // Session name/alias (2026-08-12 user requirement): same "show if present, hide if absent"
  // compatibility logic — name comes from DSH sessionTitle service (auto-generated/user rename,
  // update granularity is "after user message", not per-step rendering — follows the snapshot segment state-driven stability rule;
  // live sessions readable, service unavailable/no title → null not shown); alias comes from this plugin's
  // aliases.json（manually set by user,≤10 chars）。When both are absent, output is identical to the old version
  // （only ID), zero-change compatible.
  if (agent?.session?.id) {
    const aliases = readAliases(config.memoryDir ?? '')
    const alias = aliases[agent.session.id]
    let title = null
    try {
      title = sessionTitleService?.get?.(agent.session)?.title ?? null
    } catch { /* title read failed → null (graceful degradation) */ }
    if (alias || title) {
      const bits = []
      if (title) bits.push(st('snap.yourName', { title }))
      if (alias) bits.push(st('snap.yourAlias', { alias }))
      bits.push(st('snap.yourId', { id: agent.session.id }))
      parts.push(`${st('snap.sessionNamed')}\n${bits.join('\n')}`)
    } else {
      parts.push(`${st('snap.sessionPlain')}\n${st('snap.yourId', { id: agent.session.id })}`)
    }
  }
  // ⚠️ 2026-08-13 Design reversal: no longer inject the "reviewer mechanism description" snapshot segment — injected messages
  // disguised as user instructions (Agent does not know the reviewer exists); the snapshot segment introducing Advisor would expose
  // identity and make the Agent question the injection source (measured execution drop).
  const memoryEntries = store.entriesOf('memory')
  const userEntries = store.entriesOf('user')
  if (memoryEntries.length > 0) {
    // Display stripping the ID (Codex round 2 P1-4): globally-tracked re-issued [id:xxxx] after enabling
    // must not enter model context (same rule as KEY segment)
    parts.push(`${st('snap.memoryHead')}\n${memoryEntries.map((entry) => `- ${stripEntrySummary(stripEntryId(entry))}`).join('\n')}`)
  }
  if (userEntries.length > 0) {
    parts.push(`${st('snap.userHead')}\n${userEntries.map((entry) => `- ${stripEntrySummary(stripEntryId(entry))}`).join('\n')}`)
  }
  // Project KEY facts are injected for the agent's own project only (its
  // session cwd). Same live-read/change-detected mechanism as the global
  // tracks: a KEY write (tool or web tab) surfaces in the next step's tail.
  // When the project is a git worktree and keyBranchFilter is on, the
  // current branch is resolved live and ONLY entries whose scope covers it
  // are injected (untagged entries = "all" always qualify). Outside git,
  // or when the branch cannot be resolved, every entry is injected — the
  // conservative choice that never hides memory. The branch name itself is
  // injected alongside, so the model knows which branch it is on.
  const keyAgent = agent?.session?.header?.cwd ? agent : undefined
  const branch = keyAgent && config.keyBranchFilter !== false ? gitBranch(keyAgent.session.header.cwd) : undefined
  let keyEntries = keyAgent ? store.entriesOf('key', keyAgent) : []
  if (branch !== undefined) {
    keyEntries = keyEntries.filter((entry) => {
      const scope = parseEntryBranches(entry)
      return scope === null || scope.includes(branch)
    })
  }
  if (keyEntries.length > 0) {
    // Progressive disclosure: decide full vs summary injection based on config
    const totalChars = keyEntries.reduce((sum, e) => sum + e.length, 0)
    const mode = config.keyProgressiveDisclosure ?? 'off'
    const useFullInject = mode === 'off' || 
      (mode === 'auto' && keyEntries.length <= (config.keyFullInjectThreshold ?? 3) && totalChars <= (config.keyFullInjectCharLimit ?? 1500))
    
    if (useFullInject) {
      // Full injection (current logic)
      const head = branch !== undefined
        ? st('snap.keyBranchHead', { branch })
        : st('snap.keyHead')
      // Full injection display stripping: ID [id:...] + summary marker [summary:...] (2026-08-15:
      // body is complete, summary is metadata for summary-mode injection only and should not be displayed)
      parts.push(`${head}\n${keyEntries.map((entry) => `- ${stripEntrySummary(stripEntryId(entry))}`).join('\n')}`)
    } else {
      // Summary injection (progressive disclosure)
      const head = branch !== undefined
        ? st('snap.keySummaryBranchHead', { branch })
        : st('snap.keySummaryHead')
      parts.push(`${head}\n${keyEntries.map((entry) => {
        const shortId = extractEntryId(entry) ?? legacyIdFor(entry)
        const summary = parseEntrySummary(entry) || autoSummary(entry)
        return `- [${shortId}] ${summary}`
      }).join('\n')}`)
    }
  }
  // The project log (MEMORY.md under projects/<hash>/) and the daily log are
  // deliberately NOT rendered into the snapshot: they change on every write,
  // and each change would append a new runtime-context tail message,
  // defeating LLM prefix caching. Instead the stable hint below (fixed text
  // for a given config, never varies with content) requires the model to
  // CHECK every turn for record-worthy facts and write them via the memory
  // tool right away — the program stamps timestamps, so daily/project stay
  // current without waiting for a review round. Both tracks are
  // user-toggleable at runtime (perTurnProjectWrites / perTurnDailyWrites):
  // a disabled track drops its write duty and the hint falls back to
  // on-demand reads. KEY writes are importance-gated (perTurnKeyWrites):
  // only durable project facts (long-lived conventions/decisions/architecture
  // pitfalls) qualify — never per-turn progress. Subagent sessions get a
  // restrained variant: record one entry per independent achievement instead
  // of a per-turn duty, so bulk delegation does not flood the tracks.
  const isSubagent = agent?.session?.header?.origin === 'subagent'
  const reviewOn = !isSubagent && config.reviewEnabled
  // Due warning: when the review is due, the snapshot itself tells the model
  // (the sticky counter is the authority). Low-frequency text change — one
  // extra tail snapshot per review cycle is a fair cache price for closing
  // the 'never checks' hole of weak-following models.
  const due = reviewOn && counter !== undefined && counter.turnsOf(agent) >= config.reviewInterval
  const keyDuty = config.perTurnKeyWrites !== false
  const writeTargets = [
    config.perTurnDailyWrites !== false ? 'target=daily' : null,
    config.perTurnProjectWrites !== false ? 'target=project' : null,
  ].filter(Boolean)
  // With git the model is told which branch it is on — even when no KEY
  // entry matches, the branch line keeps the model branch-aware. Outside
  // git nothing branch-related is injected at all.
  const branchHint = branch !== undefined
    ? st('snap.branchHint', { branch })
    : ''
  // When todo capability is off (todoEnabled=false), snapshot does not inject dtodo guidance lines, header also
  // does not mention dtodo — model sees no dtodo in tool list and will not be asked to call it.
  const todoEnabled = config.todoEnabled !== false
  parts.push(`${todoEnabled ? st('snap.section') : st('snap.sectionNoTodo')}
${st('snap.readHint')}${branchHint}${todoEnabled ? `\n${st('snap.todoHint')}` : ''}`)

  // Turn-final duties, as one minimal checklist (write → review when the
  // snapshot says so). No per-turn status check: the program injects a
  // due warning into the snapshot the moment a review is due (sticky until
  // completed), so the model never has to poll — and weak followers cannot
  // skip a review silently. No mechanism explanation: the interval and mode
  // ride on the due warning; `memory_review_status` is only for completing
  // a review (or manual progress checks).
  if (writeTargets.length > 0 || keyDuty || reviewOn) {
    const steps = []
    if (writeTargets.length > 0 || keyDuty) {
      if (isSubagent) {
        const base = st('snap.subagentWrite', { targets: writeTargets.join(st('snap.and')) })
        steps.push(keyDuty
          ? `${base}${st('snap.subagentKeyTail')}`
          : `${base}${st('snap.subagentSkipTail')}`)
      } else {
        const duties = []
        if (writeTargets.length > 0) {
          // One-call batch write (entries array contains one item per track), saving one tool round-trip.
          // writeTargets elements like 'target=daily', directly join(' and ') into the prompt.
          duties.push(st('snap.batchWriteDuty', { targets: writeTargets.join(st('snap.and')) }))
        }
        if (keyDuty) duties.push(st('snap.keyDuty'))
        // User sentiment feedback record (2026-08-10): when the human user's input this turn carries clear sentiment,
        // attach feedback param to both daily/project entries (program renders [Feedback] line, format
        // fixed and searchable); categories by track: daily generic layering, project intra-project layering.
        if (writeTargets.length > 0) {
          duties.push(st('snap.feedbackDuty'))
        }
        steps.push(st('snap.writeStep', { duties: duties.join('；') }))
      }
    }
    if (reviewOn) {
      const n = steps.length + 1
      steps.push(st('snap.reviewStep', { n }))
    }
    const tail = st('snap.noTimestampTail')
    const dueWarning = due
      ? st('snap.dueWarning', { interval: config.reviewInterval, mode: config.reviewMode })
      : ''
    const head = isSubagent
      ? st('snap.subagentTurnEndHead')
      : st('snap.turnEndHead')
    parts.push(`${head}
${steps.map((step) => `  ${step}`).join('\n')}
${tail}${dueWarning}`)
  }

  // COI status notification (2026-08-13 user decision refactor): **no longer injected into snapshot list** —
  // status changes now deliver standalone messages to the originating session (start=[COI task initiated], terminal=
  // [COI task completed], via coi/scheduler.js on state transition through agents service
  // inject/followup delivery). Reasons for removing the snapshot segment: 1) noisy when mixed with other module segments;
  // 2) terminal summaries have no value when truncated (logs fall in the middle when long); 3) duplicate with completion wake-up
  // messages duplicate-reminding the same task via dual channels. To see background tasks use de_coi_status / GUI task page.
  // Session broadcast (2026-08-13 user decision): **removed from overall snapshot** — new messages/room dynamics
  // changed to standalone message delivery (post-send in installBroadcast + first-sessionsupplemental delivery of unread
  // summary), inbox semantics unchanged (de_broadcast read handling). DSH snapshot diffs by overall text
  // injection; high-frequency changes in the broadcast segment cause other segments to re-inject (noise).
  // Memory sync (2026-08-13 user decision): **no AI-side entry** — command group and snapshot status
  // lines all deleted. Memory sync is now entirely user-driven in the Web GUI (Memory Sync tab),
  // AI does not participate; snapshot no longer shows sync status.
  return parts.join('\n\n')
}

/**
 * Resolve one reveal target to an openable path. Every target is a fixed
 * path derived from the memory dir, the skill dir, or the dsh home — never
 * an arbitrary path. Directories open as-is; a missing file falls back to
 * its containing directory (e.g. AGENTS.md before DSH created it, or
 * today's daily log before the first write) instead of failing with an
 * unknown target.
 * @param {object} config - resolved plugin config.
 * @param {string} target - the reveal target name.
 * @returns {string | undefined} the path to open, or undefined for an
 *   unknown target.
 */
export function resolveRevealTarget(config, target) {
  const today = todayStamp()
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const table = {
    memoryDir: config.memoryDir,
    memoryFile: join(config.memoryDir, 'MEMORY.md'),
    userFile: join(config.memoryDir, 'USER.md'),
    archiveMemoryFile: join(config.memoryDir, 'MEMORY-archive.md'),
    archiveUserFile: join(config.memoryDir, 'USER-archive.md'),
    dailyDir: join(config.memoryDir, 'daily'),
    dailyFile: join(config.memoryDir, 'daily', `${today}.md`),
    projectsDir: join(config.memoryDir, 'projects'),
    skillDir: config.skillDir,
    agentsFile: join(dshHome, 'AGENTS.md'),
  }
  if (typeof target !== 'string' || !(target in table)) return undefined
  const path = table[target]
  // Directories open as-is; the plugin's own storage directories are
  // created on demand so the reveal buttons work on a fresh install before
  // any memory was ever written (MEMORY.md/USER.md/daily/projects do not
  // exist yet, and neither does the memory dir itself).
  if (target === 'memoryDir' || target === 'dailyDir' || target === 'projectsDir') {
    return existsSync(path) ? path : ensureDir(path)
  }
  if (target === 'agentsFile') {
    return existsSync(path) ? path : dshHome
  }
  if (target === 'skillDir') {
    return existsSync(path) ? path : dirname(config.skillDir)
  }
  // Files: open the containing directory when the file does not exist yet
  // (creating it on demand — the memory dir is plugin-owned).
  const dir = table[target === 'dailyFile' ? 'dailyDir' : 'memoryDir']
  return existsSync(path) ? path : ensureDir(dir)
}

/**
 * Convert a Linux/WSL path to a Windows path for `explorer.exe`, using
 * `wslpath` (bundled with WSL itself). Falls back to the original path when
 * wslpath is missing or fails — e.g. on pure Linux, where the explorer.exe
 * attempt will fail anyway and the command chain moves on.
 * @param {string} path - the Linux path to convert.
 * @returns {string} the Windows path, or the input when not convertible.
 */
export function toWindowsPath(path) {
  const result = spawnSync('wslpath', ['-w', path], { encoding: 'utf8' })
  const converted = result.error ? '' : String(result.stdout ?? '').trim()
  return converted || path
}

/** Create a directory (recursively) and return its path. */
function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

/** Render the memory tool result as model/UI text. */
function renderMemoryResult(value) {
  const lines = [value.message ?? '']
  if (Array.isArray(value.entries) && value.entries.length > 0) {
    lines.push(mt('render.currentEntries', { count: value.entries.length }))
    value.entries.forEach((entry, index) => lines.push(`${index + 1}. ${entry}`))
  }
  if (Array.isArray(value.matches) && value.matches.length > 0) {
    lines.push(mt('render.matches'))
    value.matches.forEach((entry, index) => lines.push(`${index + 1}. ${entry}`))
  }
  // entries multi-track batch write: render per-track results, model sees at a glance which track succeeded/failed
  if (Array.isArray(value.multi) && value.multi.length > 0) {
    lines.push(mt('render.batchResults'))
    value.multi.forEach((m) => lines.push(`- ${m.target}: ${m.message}`))
  }
  return lines.join('\n')
}

/**
 * Strip the full entry list and store-internal fields from a write result:
 * add/replace/remove return the whole track (and `removed` original text) for internal
 * bookkeeping, but the model only needs the outcome (list is the read path
 * that returns entries). `removed` is not in output schema (additionalProperties
 * :false — extra fields would be rejected by model API), must be stripped together.
 * @param {object} result - the store result.
 * @returns {object} the same result without `entries` / `removed`.
 */
function outcomeOnly(result) {
  if (result && typeof result === 'object') {
    const { entries, removed, matches, ...rest } = result
    // matches（replace/remove non-unique match display) also strip ID (audit P1-5)
    if (Array.isArray(matches)) rest.matches = matches.map((entry) => stripEntrySummary(stripEntryId(entry)))
    return rest
  }
  return result
}

/**
 * Build the `memory` tool definition.
 * @param {object} ctx - the plugin context (for optional approval).
 * @param {object} config - resolved config.
 * @param {MemoryStore} store - the memory store.
 * @param {import('./store.js').SuggestionQueue} queue - the suggestion queue
 *   (key-track writes go through it for user confirmation).
 * @param {() => object} getRuntime - runtime config getter.
 * @param {ArchiveStore} archive - the archive store (archive action: 
 *   main-track entry moved to corresponding archive file).
 * @returns {object} a ToolDefinition-shaped object.
 */
export function memoryTool(ctx, config, store, queue, getRuntime, archive) {
  /**
   * program renders [Feedback] line (user sentiment feedback record, launched 2026-08-10).
   * sentiment required (positive/negative); category/quote/note optional
   * (absent segment not output, category defaults to "uncategorized"). All fields sanitized
   * |, newline, §, quotes (to prevent breaking §-delimited MD entry format); quote truncated
   * ≤20 chars (excerpt of user's original words, traceable evidence). Returns '' means no line is generated。
   * @param {object|null} feedback - tool feedback param (or inside entries item)。
   * @returns {string} [Feedback] line text，or ''。
   */
  function buildFeedbackLine(feedback) {
    if (!feedback || typeof feedback !== 'object') return ''
    const sent = feedback.sentiment === 'positive' ? mt('feedback.positive') : feedback.sentiment === 'negative' ? mt('feedback.negative') : null
    if (sent === null) return ''
    const clean = (s) => String(s ?? '').replace(/[|\n\r§"]/g, '').trim()
    const cat = clean(feedback.category) || mt('feedback.uncategorized')
    const quote = clean(feedback.quote).slice(0, 20)
    const note = clean(feedback.note)
    const tag = feedback.manual === true ? mt('feedback.tagManual') : mt('feedback.tag')
    const parts = [`${mt('feedback.sentiment')}:${sent}`, `${mt('feedback.category')}:${cat}`]
    if (quote) parts.push(`${mt('feedback.quote')}:"${quote}"`)
    if (note) parts.push(`${mt('feedback.note')}:${note}`)
    return `${tag}${parts.join(' | ')}`
  }

  /**
   * Common implementation for single-track add (shared by entries batch and single-track add):
   * - feedback line is rendered by program and appended to entry tail (only for daily/project tracks;
   *   key track ignores feedback and goes through suggestion queue; memory/user also do not generate lines);
   * - key track add enters pending-confirmation queue (written and injected after user confirmation), not persisted directly;
   * - result is unified outcomeOnly (strip entries/removed, strictly align with output schema).
   * @param {string} target - memory track.
   * @param {string} content - entry content.
   * @param {object|null} feedback - feedback param (optional)。
   * @param {object} exec - tool execution context (agent etc.)。
   * @returns {Promise<object>} tool-friendly result {ok, message, target, ...}。
   */
  async function addOne(target, content, feedback, exec, summary) {
    const fbLine = target === 'daily' || target === 'project' ? buildFeedbackLine(feedback) : ''
    let finalContent = String(content ?? '').trim()
    if (fbLine !== '') finalContent = finalContent === '' ? fbLine : `${finalContent}\n${fbLine}`
    if (finalContent === '') return { ok: false, message: mt('msg.emptyContent'), target }
    // Progressive disclosure: key track supports summary param, spliced into [summary:...] tag.
    // Sanitization (audit fix): newlines would make tags span lines,']' would make the parsing regex [^\]]* terminate early
    // truncation (remaining text leaking into body, stripEntrySummary mismatch) — all are common in LLM free
    // text params and must be stripped before truncating.
    if (target === 'key' && summary) {
      const sanitized = String(summary).replace(/[\n\r\t\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (sanitized !== '') {
        const summaryTag = `[summary:${sanitized}]`
        finalContent = `${summaryTag}\n${finalContent}`
      }
    }
    if (target === 'key') {
      const outcome = enqueueSuggestion(queue, 'key', finalContent, mt('msg.keySuggestReason'), exec?.agent)
      if (outcome.ok) {
        outcome.message = mt('msg.keySuggestionQueued', { queued: outcome.queued })
      }
      // queued is not in output schema (additionalProperties:false), stripped
      const { queued: _queued, ...rest } = outcome
      return outcomeOnly(rest)
    }
    const addResult = store.add(target, finalContent, exec.agent)
    return outcomeOnly(addResult)
  }

  return {
    name: config.toolName,
    get description() { return mt('memory.desc') },
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove', 'archive', 'list', 'expand'],
          get description() { return mt('param.action') },
        },
        target: {
          type: 'string',
          enum: ['memory', 'user', 'project', 'key', 'daily'],
          get description() { return mt('param.target') },
        },
        content: {
          type: 'string',
          get description() { return mt('param.content') },
        },
        entries: {
          type: 'array',
          get description() { return mt('param.entries') },
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              target: {
                type: 'string',
                enum: ['daily', 'project'],
                get description() { return mt('param.entriesTarget') },
              },
              content: {
                type: 'string',
                get description() { return mt('param.entriesContent') },
              },
              feedback: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sentiment: {
                    type: 'string',
                    enum: ['positive', 'negative'],
                    get description() { return mt('param.sentiment') },
                  },
                  category: {
                    type: 'string',
                    get description() { return mt('param.category') },
                  },
                  quote: {
                    type: 'string',
                    get description() { return mt('param.quote') },
                  },
                  note: {
                    type: 'string',
                    get description() { return mt('param.note') },
                  },
                  manual: {
                    type: 'boolean',
                    get description() { return mt('param.manual') },
                  },
                },
                required: ['sentiment'],
                get description() { return mt('feedback.tag') },
              },
            },
            required: ['target', 'content'],
          },
        },
        feedback: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sentiment: {
              type: 'string',
              enum: ['positive', 'negative'],
              get description() { return mt('param.sentiment') },
            },
            category: {
              type: 'string',
              get description() { return mt('param.category') },
            },
            quote: {
              type: 'string',
              get description() { return mt('param.quote') },
            },
            note: {
              type: 'string',
              get description() { return mt('param.note') },
            },
            manual: {
              type: 'boolean',
              get description() { return mt('param.manual') },
            },
          },
          required: ['sentiment'],
          get description() { return mt('param.feedback') },
        },
        match: {
          type: 'string',
          get description() { return mt('param.match') },
        },
        archived: {
          type: 'boolean',
          get description() { return mt('param.archived') },
        },
        branches: {
          type: 'string',
          get description() { return mt('param.branches') },
        },
        branch: {
          type: 'string',
          get description() { return mt('param.branch') },
        },
        filter: {
          type: 'string',
          get description() { return mt('param.filter') },
        },
        since: {
          type: 'string',
          get description() { return mt('param.since') },
        },
        until: {
          type: 'string',
          get description() { return mt('param.until') },
        },
        limit: {
          type: 'integer',
          get description() { return mt('param.limit') },
        },
        recent: {
          type: 'boolean',
          get description() { return mt('param.recent') },
        },
        id: {
          type: 'string',
          get description() { return mt('param.id') },
        },
        summary: {
          type: 'string',
          get description() { return mt('param.summary') },
        },
      },
      required: ['action', 'target'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          target: { type: 'string' },
          entries: { type: 'array', items: { type: 'string' } },
          matches: { type: 'array', items: { type: 'string' } },
          chars: { type: 'integer' },
          backup: { type: 'string' },
          // list 元数据：total entry count and earliest/latest dates for this track (to guide model to set reasonable query scope)
          total: { type: 'integer' },
          earliest: { type: 'string' },
          latest: { type: 'string' },
          // entries 多轨批量写的结果数组（每轨 {target, ok, message}）
          multi: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                target: { type: 'string' },
                ok: { type: 'boolean' },
                message: { type: 'string' },
              },
              required: ['target', 'ok', 'message'],
            },
          },
        },
        required: ['ok', 'message'],
      },
      render: (_args, value) => [{ type: 'text', text: renderMemoryResult(value) }],
    },
    async execute(args, exec) {
      const target = args.target
      const action = args.action
      const origin = exec?.agent?.session?.header?.origin
      // Layered gate for subagent-origin writes: global tracks (memory/user,
      // injected every session) are the high-risk surface — refused in
      // suggest mode, approval-gated in auto mode. The project-scoped tracks
      // (project/key, keyed to one cwd) and daily (never injected) are safe
      // for automatic writes. The main session is never gated here (the review
      // prompt disciplines its global writes instead).
      if (origin === 'subagent' && (target === 'memory' || target === 'user')) {
        if (getRuntime().reviewMode !== 'auto') {
          return {
            ok: false,
            message: mt('msg.subagentGlobalDenied', { suggestTool: getRuntime().suggestToolName }),
            target,
          }
        }
        const approval = ctx.get('approval')
        if (!approval) {
          return { ok: false, message: mt('msg.approvalUnavailable'), target }
        }
        const outcome = await approval.request({
          agent: exec.agent,
          toolName: config.toolName,
          callId: exec.callId,
          reason: 'memory review suggests writing to long-term memory',
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return { ok: false, message: mt('msg.notApproved', { outcome }), target }
        }
      }
      // target fallback validation: required relaxed to only ['action'](entries batch mode
      // top-level target not needed), other ops missing target give explicit error rather than low-level error.
      const isEntriesAdd = action === 'add' && Array.isArray(args.entries) && args.entries.length > 0
      if (!target && !isEntriesAdd) {
        return { ok: false, message: mt('msg.missingTarget') }
      }
      let result
      try {
        switch (action) {
          case 'list': {
            // archived=true：query archive files (MEMORY-archive.md / USER-archive.md /
            // project KEY-archive.md) — archived content not injected, not visible in main-track list,
            // retrievable here when needed (move back via Memory tab or manual promote).
            if (args.archived === true) {
              if (target !== 'memory' && target !== 'user' && target !== 'key') {
                result = { ok: false, message: mt('msg.archivedQueryOnly'), target }
                break
              }
              const cwd = exec?.agent?.session?.header?.cwd
              if (target === 'key' && !cwd) {
                result = { ok: false, message: mt('msg.keyArchiveNeedsCwd'), target }
                break
              }
              let entries = archive.entriesOf(target, cwd)
              // Lightweight filtering: filter substring (case-insensitive), since/until by timestamp
              // prefix comparison, recent reverse, limit truncation — aligned with main-track list semantics
              const q = String(args.filter ?? '').trim().toLowerCase()
              if (q) entries = entries.filter((e) => e.toLowerCase().includes(q))
              const stamp = (e) => { const m = /^\[(\d{4}-\d{2}-\d{2})\]/.exec(e); return m ? m[1] : null }
              if (args.since !== undefined) {
                const s = String(args.since)
                entries = entries.filter((e) => { const d = stamp(e); return d !== null && d >= s })
              }
              if (args.until !== undefined) {
                const u = String(args.until)
                entries = entries.filter((e) => { const d = stamp(e); return d !== null && d <= u })
              }
              if (args.recent === true) entries = [...entries].reverse()
              if (args.limit !== undefined && Number.isInteger(args.limit) && args.limit > 0) {
                entries = entries.slice(0, args.limit)
              }
              result = {
                ok: true,
                message: mt('msg.archiveList', { target, count: entries.length }),
                target,
                entries: entries.map((entry) => stripEntrySummary(stripEntryId(entry))), // display stripping ID + summary marker (§4.7)
                chars: entries.map((entry) => stripEntrySummary(stripEntryId(entry))).join('\n').length,
              }
              break
            }
            const stats = {}
            // ── Large-file track query protection (2026-08-10)──
            // project/daily are append-growth logs (thousands per year), model queries without params
            // list would fetch all → context token explosion. When limit/recent not explicitly passed
            // default to "latest 50 reverse" and return metadata (total/earliest/latest) to let
            // model judge query scope (logs are for AI to query, clearer info leads to better queries).
            // When limit/recent explicitly passed, respect explicit values; memory/user/key tracks have no protection.
            const isLog = target === 'project' || target === 'daily'
            const protectedView = isLog
              && args.limit === undefined
              && args.recent === undefined
              && args.since === undefined
              && args.until === undefined
            const queryOpts = {
              filter: args.filter,
              since: args.since,
              until: args.until,
              limit: protectedView ? 50 : args.limit,
              recent: protectedView ? true : args.recent,
            }
            let entries = store.query(target, exec.agent, queryOpts, stats)
            // Metadata: total entry count and earliest/latest dates for this track file (to guide query scope)
            const allEntries = store.entriesOf(target, exec.agent)
            const dates = []
            for (const entry of allEntries) {
              const d = extractEntryDate(entry)
              if (d !== null) dates.push(d)
            }
            const total = allEntries.length
            const earliest = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : ''
            const latest = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : ''
            // key track branch filtering: only entries visible for this branch (untagged=all + tagged containing this branch)
            if (target === 'key' && args.branch !== undefined && String(args.branch).trim() !== '') {
              const b = String(args.branch).trim()
              entries = entries.filter((entry) => {
                const scope = parseEntryBranches(entry)
                return scope === null || scope.includes(b)
              })
            }
            let message = `${target}：${entries.length}  entries matched`
            if (protectedView) {
              // default protected view: inform of library size and time span, guide model to add conditions reasonably
              message += `（this track has ${total}  entries, time span ${earliest || '?'} ~ ${latest || '?'}, defaults to latest 50 — to query earlier records add since/untilntilil（如 since=${earliest || 'YYYY-MM-DD'}）or增大 limit）`
            } else if (entries.length === 0 && (args.filter !== undefined || args.since !== undefined || args.until !== undefined)) {
              // not found: remind model to read full text, do not guess
              message += '（no matching entries found — try removing filters and list full text to verify）'
            } else if (stats.undated > 0 && (args.since !== undefined || args.until !== undefined)) {
              // date format incompatibility: remind model these entries were not included in date filtering
              message += `（additionally, ${stats.undated} entries with unparsable dates were not included in date filtering — try removing since/until and list full text to verify）`
            }
            result = {
              ok: true,
              message,
              target,
              // display stripping: ID [id:...] is internal merge mechanism, always stripped from model-visible output
              // (blueprint §4.7; internal matching uses original text, unaffected).
              entries: entries.map((entry) => stripEntrySummary(stripEntryId(entry))),
              chars: entries.map((entry) => stripEntrySummary(stripEntryId(entry))).join('\n').length,
              total,
              earliest,
              latest,
            }
            break
          }
          case 'add': {
            // ── entries multi-track batch (per-turn closing batch write daily+project)──
            // only daily/project tracks supported (schema enum limited; program fallback here,
            // prevent bypassing memory/user subagent gate and key confirmation queue).
            // each item executed independently, succeeds/fails independently, aggregated into multi return.
            if (Array.isArray(args.entries) && args.entries.length > 0) {
              const multi = []
              for (const item of args.entries) {
                const t = item?.target
                const c = String(item?.content ?? '').trim()
                if (t !== 'daily' && t !== 'project') {
                  multi.push({ target: String(t ?? '?'), ok: false, message: mt('msg.batchUnsupportedTrack') })
                  continue
                }
                if (c === '') {
                  multi.push({ target: t, ok: false, message: mt('msg.emptyContent') })
                  continue
                }
                // Single-track fault tolerance (issue #18 suggestion 3): if any single track write throws
                // (e.g., Windows lock file deletion occupied, memory directory cannot be created, etc.)
                // only mark that track as failed, do not interrupt loop or discard other tracks.
                let r
                try {
                  r = await addOne(t, c, item?.feedback, exec)
                } catch (error) {
                  r = { ok: false, message: mt('msg.writeError', { detail: error?.message ?? String(error) }) }
                }
                multi.push({ target: t, ok: r.ok, message: r.message })
              }
              const allOk = multi.every((m) => m.ok)
              result = {
                ok: allOk,
                message: mt('msg.batchSummary', { count: multi.length }) + multi.map((m) => `${m.target}=${m.ok ? mt('msg.ok') : mt('msg.failed')}`).join(' '),
                multi,
              }
              break
            }
            // ── Single-track add (original logic + feedback param)──
            let content = String(args.content ?? '').trim()
            let branchWarning = ''
            // key track branch scope: branches=main,dev → entry carries [branch:main,dev] marker;
            // default/empty = all (no marker). Non-existent branches only warn, still write normally (branch may be created later).
            if (target === 'key' && args.branches !== undefined && String(args.branches).trim() !== '') {
              const list = String(args.branches).split(',').map((b) => b.trim()).filter((b) => b.length > 0)
              if (list.length > 0) {
                content = `[branch:${list.join(',')}] ${content}`
                const known = gitBranchList(exec?.agent?.session?.header?.cwd)
                if (known.length > 0) {
                  const unknown = list.filter((b) => !known.includes(b))
                  if (unknown.length > 0) {
                    branchWarning = mt('msg.branchWarningUnknown', { branches: unknown.join(', ') })
                  }
                }
              }
            }
            const addOneResult = await addOne(target, content, args.feedback, exec, args.summary)
            if (addOneResult.ok && branchWarning !== '') addOneResult.message += branchWarning
            result = addOneResult
            break
          }
          case 'replace':
            result = outcomeOnly(store.replace(target, args.match, args.content, exec.agent))
            break
          case 'remove':
            result = outcomeOnly(store.remove(target, args.match, exec.agent))
            break
          case 'archive': {
            // Archive: main-track entry → corresponding archive file (only memory/user/key tracks).
            // Same semantics as Memory tab "Archive" button — remove whole entry from main track by unique substring
            // and append original text to MEMORY-archive.md / USER-archive.md /
            // projects/<project>/KEY-archive.md (key requires session working directory).
            // Reversible: Memory tab archive page "Move back to main memory" can promote.
            // Order: archive first, then delete — first peek preview matched original and write to archive
            // file, only after archive write succeeds delete from main track; if archive fails, main-track entry remains
            // intact (never lose data). If delete fails (concurrent match changed), archive
            // there will be an extra entry that can be manually cleaned, but main-track data remains recoverable —
            // trade-off: prefer duplication over loss.
            if (target !== 'memory' && target !== 'user' && target !== 'key') {
              result = { ok: false, message: mt('msg.archiveTracksOnly'), target }
              break
            }
            const match = String(args.match ?? '').trim()
            if (!match) {
              result = { ok: false, message: mt('msg.archiveEmptyMatch'), target }
              break
            }
            const cwd = exec?.agent?.session?.header?.cwd
            if (target === 'key' && !cwd) {
              result = { ok: false, message: mt('msg.archiveKeyNeedsCwd'), target }
              break
            }
            // Step 1: preview matched original text (read-only, no disk write)
            const preview = store.peek(target, match, exec.agent)
            if (!preview.ok) {
              result = outcomeOnly(preview)
              break
            }
            // Step 2: first write original text to archive file (atomic write + directory lock)
            const appended = archive.append(target, preview.entry, cwd)
            if (!appended.ok) {
              result = {
                ok: false,
                message: mt('msg.archiveAppendFailed', { detail: appended.message ?? '?' }),
                target,
              }
              break
            }
            // Step 3: only after archive succeeds delete from main track
            const removed = store.remove(target, match, exec.agent)
            if (!removed.ok) {
              result = {
                ok: false,
                message: mt('msg.archivePartial', { total: appended.total, detail: removed.message }),
                target,
              }
              break
            }
            result = {
              ok: true,
              message: mt('msg.archivedDone', { target, total: appended.total }),
              target,
            }
            break
          }
          case 'expand': {
            // Progressive disclosure: load full key-track entry by ID
            if (target !== 'key') {
              result = { ok: false, message: mt('msg.expandKeyOnly'), target }
              break
            }
            if (!args.id) {
              result = { ok: false, message: mt('msg.expandNeedsId'), target }
              break
            }
            const cwd = exec?.agent?.session?.header?.cwd
            if (!cwd) {
              result = { ok: false, message: mt('msg.expandNeedsCwd'), target }
              break
            }
            const keyAgent = { session: { header: { cwd } } }
            // Branch scope filtering (audit fix): same rule as snapshot injection/key-track list —
            // only entries visible for current branch (untagged=all + [branch:...] containing current branch)
            // can be expanded, preventing a session on branch A from expanding an entry limited to branch B.
            const branch = config.keyBranchFilter !== false ? gitBranch(cwd) : undefined
            let keyEntries = store.entriesOf('key', keyAgent)
            if (branch !== undefined) {
              keyEntries = keyEntries.filter((entry) => {
                const scope = parseEntryBranches(entry)
                return scope === null || scope.includes(branch)
              })
            }
            const found = keyEntries.find(e => e.includes(`[id:${args.id}]`) || legacyIdFor(e) === args.id)
            if (!found) {
              result = { ok: false, message: mt('msg.expandNotFound', { id: args.id }), target }
              break
            }
            result = {
              ok: true,
              message: mt('msg.expandFullText'),
              target,
              entries: [stripEntrySummary(stripEntryId(found))],
            }
            break
          }
          default:
            result = { ok: false, message: mt('msg.unknownAction', { action }), target }
        }
      } catch (error) {
        // e.g. project memory without a session cwd
        result = { ok: false, message: error?.message ?? String(error), target }
      }
      return result
    },
  }
}


/**
 * Build memory context text injected into COI tasks (same source and rules as DSH session injection):
 *   long-term memory + user profile (injected into all tasks); project key memory only injected when cwd exists,
 *   and filtered by git branch (consistent with keyBranchFilter: only inject untagged or covering current
 *   branch entries). **Do not inject AGENTS.md** (user decision: DSH per-turn discipline/dev rules
 *   only constrain the DSH main model and should not be imposed on external COI). Project log/daily log not injected
 *   (too long, consistent with DSH snapshot strategy).
 *   tracks 可只取部分轨（'memory'/'user'/'key' 子集，COI 调度由 AI 经
 *   injectTracks 自主选择）；缺省=all三轨。
 *   excludeDshOnly：true = 跳过带「仅 DSH」标记（[dsh-only]）的条目——
 *   这些条目只适用于 DSH 自身（DSH 纪律/规则/架构类事实），外部执行器
 *   不必遵循 DSH 规则，注入只会让它们困惑。COI 调度注入时传 true；DSH
 *   自身快照注入不传（标记条目照常注入 DSH）。
 * @param {MemoryStore} store - 记忆 store。
 * @param {object} [opts] - { cwd, branch, tracks, excludeDshOnly }。
 * @returns {string} 拼接好的上下文文本（无内容返回空串）。
 */
export function buildMemoryContext(store, { cwd, branch: declaredBranch, tracks, excludeDshOnly } = {}) {
  // tracks 缺省=all三轨（兼容快照等既有调用方）；COI 调度时由 AI 经
  // injectTracks 参数自主选择（scope 与注入无关，任何层级都能选轨注入）
  const want = (track) => tracks === undefined || tracks.includes(track)
  // 「仅 DSH」标记过滤：excludeDshOnly=true（外部执行器注入）时整条跳过
  // 带 [dsh-only] 的条目；DSH 自身注入（false/缺省）原样保留
  const dshOnlySafe = (entries) => (excludeDshOnly ? entries.filter((entry) => !parseEntryDshOnly(entry)) : entries)
  const parts = []
  if (want('memory')) {
    const memoryEntries = dshOnlySafe(store.entriesOf('memory'))
    if (memoryEntries.length > 0) parts.push(`${st('ctx.memoryGlobal')}\n${memoryEntries.join('\n')}`)
  }
  if (want('user')) {
    const userEntries = dshOnlySafe(store.entriesOf('user'))
    if (userEntries.length > 0) parts.push(`${st('ctx.userProfile')}\n${userEntries.join('\n')}`)
  }
  if (want('key') && cwd) {
    const keyAgent = { session: { header: { cwd } } }
    let keyEntries = dshOnlySafe(store.entriesOf('key', keyAgent))
    // 分支过滤：优先用任务声明的分支（scope=project 可挂 branch，如
    // feat/tag-question-paper）；任务未声明时回退到 cwd 目录当前 checkout
    // 的分支（git branch --show-current，与 DSH 会话注入同规则）。非 git
    // 仓库/获取失败 → all注入。
    const branch = declaredBranch ?? gitBranch(cwd)
    if (branch !== undefined) {
      keyEntries = keyEntries.filter((entry) => {
        const scope = parseEntryBranches(entry)
        return scope === null || scope.includes(branch)
      })
    }
    if (keyEntries.length > 0) {
      const head = branch !== undefined ? st('ctx.keyWithBranch', { branch }) : st('ctx.keyPlain')
      // 展示剥离：身份证 [id:…] 不注入（审查 P1-5：COI/外部执行器出口）
      // 展示剥离：身份证 + 摘要标记（与 DSH 快照全量注入同规则；正文完整时
      // [summary:…] 是仅供摘要模式用的元数据，不注入外部执行器）
      parts.push(`${head}\n${keyEntries.map((entry) => stripEntrySummary(stripEntryId(entry))).join('\n')}`)
    }
  }
  return parts.join('\n\n')
}

/**
 * The plugin entrypoint.
 * @param {object} ctx - the plugin context (`tools`, `systemPrompt` injected).
 * @param {object} [rawConfig] - raw cordis config.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  // Host-side locale (English support): resolve once at boot from the DSH
  // Language preference (default 'en' when unset), then follow live changes
  // through the settings commit event. Getter-based tool descriptions and
  // snapshot builders read the active locale per call, so a flip takes
  // effect on the next model request / injected turn without re-registering
  // anything. The 'locale' namespace belongs to DSH's own locale plugin —
  // we only .get() it here and never write to it.
  setLocale(resolveLocale(ctx))
  ctx.effect(() => {
    const settings = ctx.get('settings')
    if (!settings || typeof settings.get !== 'function') return () => {}
    return ctx.on('settings/updated', (ns) => {
      if (ns === 'locale') setLocale(resolveLocale(ctx))
    })
  }, 'maestro-memory: locale watcher')
  const store = new MemoryStore(config.memoryDir, {
    ...config,
    // 记忆同步接线（施工图 §4.2/§6）：entryIdMode 随 syncEnabled 动态开关
    // （syncCtrl.sync() 里同步）；projectDirResolver 让 sync 项目（迁移到
    // projectId 目录后）的 store 读写定位到新目录，未启用项目回退原逻辑。
    entryIdMode: config.syncEnabled ? 'on' : 'off',
    projectDirResolver: makeProjectDirResolver(config),
  })
  const archive = new ArchiveStore(config.memoryDir, { projectDirResolver: makeProjectDirResolver(config) })
  const queue = new SuggestionQueue(config.suggestionsFile)
  const todoStore = new TodoStore(config.memoryDir, makeProjectDirResolver(config))
  const stateFile = resolve(config.stateFile ?? join(config.memoryDir, 'plugin-state.json'))
  // 会话别名共享存储（aliases.json 单实例）：api 路由（/api/aliases）与
  // de_session rename 共用，避免多实例内存缓存互覆写
  const aliasStore = new AliasStore(config.memoryDir)

  // Runtime configuration: cordis config (static defaults) overlaid with the
  // persisted state file, which the Web settings panel updates live.
  const state = loadState(stateFile)
  const runtime = { ...config }
  // 记忆同步模块引用（声明提前：installApi 的 deps 对象在 apply 前部构造，
  // 而 syncCtrl 在尾部装配——TDZ 约束，2026-08-11 实测）
  let syncDispose = null
  let syncStatusRef = null
  let syncOpsRef = null
  for (const key of RUNTIME_KEYS) {
    if (state[key] !== undefined) runtime[key] = state[key]
  }
  const getRuntime = () => runtime
  // Review turn counter: created once, shared by the snapshot (due warning)
  // and the memory_review_status tool. Zero-cost when review is disabled
  // (the settled listener returns early unless reviewEnabled).
  const counter = reviewTurnCounter(ctx, getRuntime)
  const updateRuntime = (patch) => {
    const entries = Object.entries(patch)
    for (const [key, value] of entries) validateRuntimePatch(key, value)
    const nextState = { ...state, ...patch }
    const nextRuntime = { ...runtime, ...patch }
    saveState(stateFile, nextState)
    Object.assign(state, nextState)
    Object.assign(runtime, nextRuntime)
    return { ...runtime }
  }

  // 3. In-turn review tools are one runtime-controlled capability. Register
  // and dispose the pair together so the snapshot never advertises a review
  // workflow with only half of its tools available.
  let reviewToolsDispose = null
  const reviewCtrl = {
    sync(desired = runtime.reviewEnabled === true) {
      const enabled = desired === true
      if (enabled && reviewToolsDispose === null) {
        reviewToolsDispose = ctx.effect(() => {
          let suggestDispose = null
          try {
            suggestDispose = ctx.tools.register(suggestToolDefinition(config, queue, () => getRuntime().todoEnabled !== false))
            const statusDispose = ctx.tools.register(reviewStatusTool(getRuntime, counter))
            return () => { try { statusDispose() } finally { suggestDispose() } }
          } catch (error) {
            suggestDispose?.()
            throw error
          }
        }, 'maestro-memory: review tools')
      } else if (!enabled && reviewToolsDispose !== null) {
        const dispose = reviewToolsDispose
        reviewToolsDispose = null
        dispose()
      }
    },
  }

  // 2d. Local document search (search_local_docs): default OFF — the tool is
  // registered only while the runtime switch is on, so a disabled tool never
  // appears in the model's tool list (and its schema stays out of the prompt).
  // updateRuntime 联动：Web 设置面板 / slash 命令切换后即时注册or注销。
  const searchDocsCtrl = createSearchDocsController(ctx, config, getRuntime)
  const applyRuntimePatch = (patch) => {
    // Stage the tool transition before committing the settings patch. A tool
    // registration failure leaves every runtime/persisted key untouched; a
    // persistence failure restores the previous tool surface.
    const previousReviewEnabled = runtime.reviewEnabled === true
    const desiredReviewEnabled = Object.hasOwn(patch, 'reviewEnabled')
      ? patch.reviewEnabled
      : previousReviewEnabled
    if (Object.hasOwn(patch, 'reviewEnabled')) validateRuntimePatch('reviewEnabled', patch.reviewEnabled)
    let next
    try {
      reviewCtrl.sync(desiredReviewEnabled)
      next = updateRuntime(patch)
    } catch (error) {
      try {
        reviewCtrl.sync(previousReviewEnabled)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'maestro-memory: 运行时设置失败且审查工具回滚不完整')
      }
      throw error
    }
    notifyCtrl.sync() // 渠道通知随 notifyEnabled 即时安装/卸载（先于 COI——COI 依赖其 sendChannelNotify 回调）
    channelSendCtrl.sync() // 渠道直发随 channelSendEnabled 即时安装/卸载（独立开关，与 notify 互不影响）
    sessionImageCtrl.sync() // 本会话图片查询随 sessionImageQueryEnabled 即时安装/卸载（独立开关）
    searchDocsCtrl.sync()
    todoCtrl.sync() // 待办能力随 todoEnabled 即时注册/注销（dtodo 工具；数据与同步轨不动）
    coiCtrl.sync() // COI 模块随 coiEnabled 即时安装/卸载
    broadcastCtrl.sync() // 会话广播随 broadcastEnabled 即时安装/卸载
    sessionSearchCtrl.sync() // 会话搜索随 sessionSearchEnabled 即时安装/卸载
    sessionCtrl.sync() // 会话编排随 sessionEnabled 即时安装/卸载（曾漏掉导致开关打开工具不注册）
    promptsCtrl.sync() // 提示词模块随 promptsEnabled 即时安装/卸载
    modelsCtrl.sync() // 模型配置随 modelsEnabled 即时安装/卸载
    uiSettingsCtrl.sync() // DSH UI 设置随 uiSettingsEnabled 即时安装/卸载
    bookmarkCtrl.sync() // 会话书签随 bookmarkEnabled 即时安装/卸载
    syncCtrl.sync() // 记忆同步随 syncEnabled 即时安装/卸载（含 store.entryIdMode 动态切换）
    advisorCtrl.sync() // Advisor 评审随 advisorEnabled 即时安装/卸载（运行中键变化走 reconfigure）
    canvasCtrl.sync() // 无限画板随 canvasEnabled 即时安装/卸载（de_canvas 工具 + HTTP API）
    return next
  }

  // 1. Memory snapshot injection (frozen-ish: live reads, change-detected
  //    materialization keeps the cache prefix stable).
  if (config.injectMemory) {
    ctx.effect(() => {
      try {
        return ctx.systemPrompt.context({
          name: 'memory:snapshot',
          order: config.snapshotOrder,
          text: (context) => {
            const runtime = getRuntime()
            // 记忆同步无快照状态行（2026-08-13 用户拍板：AI 不参与同步，见
            // renderSnapshot 内注释）
            return renderSnapshot(runtime, store, context.agent, counter, ctx.sessionTitle)
          },
        })
      } catch (error) {
        // 幂等保护（issue #23）：DSH 0.1.x 的 loader 曾把插件在无 scope 标签的
        // ctx 上装配两次，system-prompt 的 global 层同名重复插入会抛
        // "already registered"（该层本就该只有一份注册，DSH 报错文案也提示应走
        // per-agent 注册）。命中重复时跳过并告警，避免整个 apply 失败连带
        // 快照注入失效 + /memory-evolve/api/* 404；其余异常照抛。
        if (error instanceof Error && error.message.includes('already registered')) {
          console.warn('[memory-evolve] memory:snapshot 已注册，跳过重复注册（issue #23 幂等保护）')
          return () => {}
        }
        throw error
      }
    }, 'maestro-memory: memory snapshot')
  }

  // 2. The memory tool (always registered; subagent writes are gated).
  ctx.effect(() => ctx.tools.register(memoryTool(ctx, config, store, queue, getRuntime, archive)), 'maestro-memory: memory tool')

  // 2b. The skill management tool (always registered: useful in ordinary
  //     sessions too — "把这个流程做成技能" — and required by the review
  //     subagent for the skill track).
  ctx.effect(() => ctx.tools.register(skillManageTool(ctx, config)), 'maestro-memory: skill tool')

  // 2c. The todo capability（todoEnabled 运行时开关）：控制器只负责工具注册；
  // 存储刻意留在控制器外——禁用完全可逆，不触碰既有待办数据文件，也不
  // 影响独立的同步轨；重新启用即刻恢复。
  const todoCtrl = createTodoController(ctx, config, getRuntime, todoStore)

  // 3. In-turn review (opt-in): the live runtime value is the sole authority
  // for both the snapshot instructions and the paired tool surface.
  reviewCtrl.sync()

  // 3b. 模型配置模块（de_models 工具 + 「模型设置」Tab 数据面）：**独立
  //     子模块**，与其他模块同款独立开关 modelsEnabled（默认关）。开启时
  //     注册 de_models 工具 + 提供 /api/models 数据；关闭时工具注销、
  //     API 返回"未启用"（配置数据 models.json 保留）。开关在「设置」Tab
  //     的「配置」里切换（applyRuntimePatch sync 链即时生效）。
  let modelsDispose = null
  let modelsStore = null
  const modelsCtrl = {
    sync() {
      const enabled = runtime.modelsEnabled === true
      if (enabled && modelsDispose === null) {
        const installed = installModels(ctx, config)
        modelsDispose = installed.dispose
        modelsStore = installed.store
      } else if (!enabled && modelsDispose !== null) {
        modelsDispose()
        modelsDispose = null
        modelsStore = null
      }
    },
  }
  modelsCtrl.sync()

  // 4. Web API: the settings panel's data surface (web-only service; the
  //    plugin still loads on surfaces without httpServer).
  ctx.inject(['webServer'], (webCtx) => {
    // 版本检测与更新模块（lib/update.js，一期）：模块级单例——runningTag
    // 只在进程首次创建时探测；注入回调重跑（热装配/fiber 重放）复用同一
    // 实例，不会误清更新后的"等待重启"提示（CodeX Review P0-4）。
    // restartRequired 为派生语义（runningTag !== localTag），无需 init
    // 清除步骤。状态文件回退目录用 memoryDir。
    const updateOps = getUpdateChecker({ fallbackDir: config.memoryDir })
    // 启动后台静默检测（稳定版Review P0-10）：badge 数据源是只读缓存，
    // 若用户从不打开版本页，检测永不触发、红点永不出现（卖点自锁）——
    // 插件启动时在后台跑一次 status()（fire-and-forget，不阻塞启动）。
    // status 自带 24h 成功 TTL + 30min 失败退避 + single-flight，多设备/
    // 多实例不会反复打远端；结果落缓存，设置 Tab 红点与版本页自动就位。
    void updateOps.status().catch(() => { /* 静默：检测失败不打扰启动 */ })
    const resolveReveal = (target) => resolveRevealTarget(config, target)
    // Open a path with the platform's reveal command; WSL/Linux falls back
    // from xdg-open to wslview so a missing xdg-utils does not silently
    // swallow the click. Rejects with a user-visible message when nothing
    // is available. Linux/WSL: xdg-open → wslview → explorer.exe (WSL ships
    // explorer.exe + wslpath even where wslu's wslview cannot be installed).
    const revealPath = (path) => new Promise((resolve, reject) => {
      const commands = process.platform === 'darwin' ? ['open']
        : process.platform === 'win32' ? ['explorer']
          : ['xdg-open', 'wslview', 'explorer.exe']
      const tryNext = (index) => {
        if (index >= commands.length) {
          reject(new Error('没有可用的打开命令（Linux/WSL 请安装 xdg-utils，or使用 Windows 自带的 explorer.exe）'))
          return
        }
        const command = commands[index]
        // explorer.exe takes a Windows path; everything else the Linux path.
        const args = command === 'explorer.exe' ? [toWindowsPath(path)] : [path]
        const child = spawn(command, args, { stdio: 'ignore' })
        child.on('error', () => tryNext(index + 1))
        child.on('spawn', () => resolve())
      }
      tryNext(0)
    })
    webCtx.effect(() => installApi(webCtx, {
      store, archive, queue, todoStore, getRuntime, updateRuntime: applyRuntimePatch, resolveRevealTarget: resolveReveal, revealPath,
      config,
      // 共享别名存储实例（aliases.json 单实例：api 路由与 de_session rename
      // 共用同一内存缓存，避免多实例互覆写；api.js 缺省自建）
      aliases: aliasStore,
      resolveCwd: (sessionId) => ctx.get('agents')?.get?.(sessionId)?.session?.header?.cwd,
      // 记忆同步状态（/memory-evolve/memory-sync/status）：syncEnabled 时由
      // syncCtrl 提供，否则恒未启用
      syncStatus: (cwd) => (syncStatusRef ? syncStatusRef(cwd) : { enabled: false, initialized: false }),
      // 记忆同步 UI 操作（/memory_sync 命令组的 API 化：setup/sync/off/
      // resolve/conflicts/migrate——记忆同步 Tab 用）
      syncOps: syncOpsRef ?? {
        setup: async () => ({ kind: 'error', text: translate(MISC_DICT, 'misc.syncNotReady', undefined, getLocale()) }),
        sync: async () => ({ kind: 'error', text: translate(MISC_DICT, 'misc.syncNotReady', undefined, getLocale()) }),
        off: () => ({ kind: 'error', text: translate(MISC_DICT, 'misc.syncNotReady', undefined, getLocale()) }),
        resolve: async () => ({ kind: 'error', text: translate(MISC_DICT, 'misc.syncNotReady', undefined, getLocale()) }),
        conflicts: () => [],
        migrate: () => null,
      },
      // 模型配置模块：store（models.json 读写）+ 快照聚合（供应商/模型/
      // 思考等级/备注/enabled 一站式返回给「模型设置」Tab 与外部查询）；
      // 模块未启用（modelsEnabled=false）时 store 为 null，API 拒绝访问。
      modelsStore,
      buildModelsSnapshot: () => buildModelsSnapshotAsync(ctx, modelsStore),
      // 版本检测与更新（/api/update/status、/api/update、badge.update 字段）
      updateOps,
    }), 'maestro-memory: web api')
  })

  // 5. Skills manager (merged from the standalone dsh-skill-browser plugin):
  //    browse/search/disable skills + custom skill dirs, served under the
  //    original /skills-manager prefix so the browser client is unchanged.
  //    The disabled list migrates once from the standalone plugin's state.
  installSkillsManager(ctx, {
    stateFile: join(config.memoryDir, 'skills-state.json'),
    // issue #4：技能 Tab 的项目技能扫描按「当前会话 cwd」定位（与 /api/memory
    // 各接口同款模式），不再固定回退到 workspace.list()[0]；客户端请求带
    // sessionId，服务端据此解析会话工作目录。
    resolveCwd: (sessionId) => ctx.get('agents')?.get?.(sessionId)?.session?.header?.cwd,
  })

  // 6. Commands: the review command works even with review off (users may
  //    want to inspect/clean leftover suggestions). Registered when the
  //    commands service exists.
  ctx.inject(['commands'], (cmdCtx) => {
    cmdCtx.commands.register(reviewCommand(config, store, todoStore, archive, queue, () => getRuntime().todoEnabled !== false))
    cmdCtx.commands.register(searchDocsCommand(config, {
      status: () => searchDocsCtrl.status(),
      setEnabled: (enabled) => applyRuntimePatch({ searchDocsEnabled: enabled }),
    }))
  })

  // 7.4 通知模块（de_notify + web 站内通知）：2026-08-13 用户拍板把「渠道通知」
  //     与「web 通知」合并为**通知模块**——notifyEnabled 一个开关同时启用两者：
  //     de_notify 工具（手动触发，channels 含 feishu/qq/weixin/wecom/web/all）
  //     + web 站内通知（落盘存储 + 网页右上角铃铛）。sendChannelNotify ref 供
  //     COI 调度模块（coiNotifyChannels 自动通知）松耦合桥接——未启用时 ref
  //     为 null，COI 侧静默跳过。webStore ref 供直发模块复用（发 web 落盘）。
  let notifyDispose = null
  let notifySendRef = null
  let notifyWebStoreRef = null
  let channelSendDispose = null
  let channelSendWebStoreRef = null

  // 7.4.1 渠道直发（de_channel_send）：**独立子模块**（与通知模块同一家族但
  //     语义独立——直发 vs 通知，开关粒度独立）。channelSendEnabled 独立开关
  //     （默认**开**，用户拍板要的功能开箱即用）：开启时注册 de_channel_send
  //     工具（channels 同样含 web——直发也能发到网页站内）。与 notifyEnabled
  //     互不影响，但发 web 依赖通知模块的 webStore（notify 未开时 webStore 为
  //     null，发 web 如实报「渠道未启用」）。
  //     ⚠️ channelSendCtrl 定义在 notifyCtrl 之前：notifyCtrl.sync 会重装直发
  //     （web 存储就绪/释放时），引用 channelSendCtrl 必须已初始化（防 TDZ）。
  const channelSendCtrl = {
    sync() {
      const enabled = runtime.channelSendEnabled === true
      if (enabled) {
        // webStore 引用变化时重装：execute 闭包捕获了旧 webStore（发 web 的
        // 落盘目标变了），须 dispose 后重装刷新绑定。
        if (channelSendDispose === null || channelSendWebStoreRef !== notifyWebStoreRef) {
          if (channelSendDispose !== null) channelSendDispose()
          channelSendDispose = installChannelSend(ctx, { webStore: notifyWebStoreRef }).dispose
          channelSendWebStoreRef = notifyWebStoreRef
        }
      } else if (channelSendDispose !== null) {
        channelSendDispose()
        channelSendDispose = null
        channelSendWebStoreRef = null
      }
    },
  }

  // 通知发送方显示名解析（web 铃铛列表用）：别名优先 → 会话名称（sessionTitle
  // 服务实时取，用户可见的左侧列表标题）→ 短 ID 兜底。sessionId 空 = 系统自动。
  // ⚠️ 2026-08-14 防御加固：sessionTitle.get(session) 读 session.events，
  // 传 undefined 会崩（可选链不保护参数）——先判 agent?.session 存在。
  const resolveNotifySenderName = (sessionId) => {
    if (!sessionId) return 'system'
    const alias = aliasStore?.get?.(sessionId)
    if (alias) return alias
    const agent = ctx.get('agents')?.get?.(sessionId)
    const title = agent?.session ? (ctx.sessionTitle?.get?.(agent.session)?.title ?? null) : null
    if (title) return title
    return String(sessionId).slice(0, 8)
  }

  const notifyCtrl = {
    sync() {
      const enabled = runtime.notifyEnabled === true
      if (enabled && notifyDispose === null) {
        const installed = installNotify(ctx, { memoryDir: config.memoryDir, resolveSenderName: resolveNotifySenderName })
        notifyDispose = installed.dispose
        notifySendRef = installed.sendChannelNotify
        notifyWebStoreRef = installed.webStore
        // web 存储就绪：若直发已启用，重装它拿到 webStore（发 web 才能落盘）。
        channelSendCtrl.sync()
      } else if (!enabled && notifyDispose !== null) {
        notifyDispose()
        notifyDispose = null
        notifySendRef = null
        notifyWebStoreRef = null
        // web 存储释放：若直发仍启用，重装它失去 webStore（发 web 报未启用）。
        channelSendCtrl.sync()
      }
    },
  }
  notifyCtrl.sync()
  channelSendCtrl.sync()

  // 7.4.2 本会话图片查询（de_session_images）：**独立子模块**（2026-08-11 P1
  //     任务——与渠道发送同一家族但语义独立：列出当前会话最近的图片引用，
  //     AI 先查再发；独立开关 sessionImageQueryEnabled（默认关），不借
  //     channelSendEnabled/notifyEnabled 的开关——2026-08-08 用户纪律）。
  //     依赖 DSH 260810+ 快照的 attachments 服务与 agents 服务（agents 已
  //     声明式注入）；260809 及更早进程查询会如实报错（attachments 缺失）。
  let sessionImageDispose = null
  const sessionImageCtrl = {
    sync() {
      const enabled = runtime.sessionImageQueryEnabled === true
      if (enabled && sessionImageDispose === null) {
        sessionImageDispose = installSessionImages(ctx).dispose
      } else if (!enabled && sessionImageDispose !== null) {
        sessionImageDispose()
        sessionImageDispose = null
      }
    },
  }
  sessionImageCtrl.sync()

  // 7. COI 调度模块（de_coi 工具/命令/API）：统一调度 kimi/codex/grok/hermes
  //    等 CLI 代理。模块边界：lib/coi/* 独立目录，只通过 memoryStore.add
  //    这一个薄接口沉淀摘要；未来拆独立插件时替换该回调即可。
  //    coiEnabled 为运行时开关（默认禁用）：开启时安装（工具/命令/API 注册、
  //    任务数据目录复用），关闭时整体卸载；Web Tab 在刷新后随 API 探测出现/隐藏。
  let coiDispose = null
  const coiCtrl = {
    sync() {
      const enabled = runtime.coiEnabled === true
      if (enabled && coiDispose === null) {
        const installed = installCoi(ctx, config, {
          memoryStore: store,
          resolveCwd: (sessionId) => ctx.get('agents')?.get?.(sessionId)?.session?.header?.cwd,
          // 记忆上下文注入（读 memory/user/key；tracks 由 AI 经 injectTracks
          // 自主选择）。excludeDshOnly=true：跳过带 [dsh-only] 标记的条目——
          // 外部执行器不是 DSH，不必遵循 DSH 纪律/规则，注入只会让其困惑
          memoryContext: ({ cwd, branch, tracks }) => buildMemoryContext(store, { cwd, branch, tracks, excludeDshOnly: true }),
          // 渠道通知回调（coiNotifyChannels 自动通知）：notify 模块未启用时
          // ref 为 null → 可选链返回 undefined，COI 侧静默跳过
          sendChannelNotify: (opts) => notifySendRef?.(opts),
        })
        coiDispose = installed.dispose
      } else if (!enabled && coiDispose !== null) {
        coiDispose()
        coiDispose = null
      }
    },
  }
  coiCtrl.sync()

  // 7.5 会话广播（de_broadcast）：**独立子模块**（用户拍板：明显独立的
  //     子模块不挂在别的模块下，曾跟随 coiEnabled 是事故）。broadcastEnabled
  //     独立开关（默认关）：开启时安装（de_broadcast 工具注册 + prune
  //     定时器 + 快照「会话广播」段 + 会话头部复制会话 ID 按钮），关闭时
  //     整体卸载；存储独立目录 broadcastDataDir（<memoryDir>/broadcast）。
  //     storeRef 供会话编排模块（de_session spawn 加房间）松耦合桥接——
  //     广播未启用时返回 undefined，编排模块只提示不阻断。
  //     7.55 工作区冲突协调（ws-coord）是**广播模块的子功能组**（用户拍板
  //     2026-08-09：语义上属于"通知的一部分"，归入广播，不做独立模块）：
  //     wsCoordEnabled 子开关（默认关），**依赖广播大开关**（广播关 =
  //     wsCoord all不注册）；开启时安装锁存储 + de_ws_* 工具 + 事件监听
  //     （fs/observed 自动登记 / pre-execute 冲突检测 / post-execute 软模式
  //     警告 / turn-stopping 释放），存储独立子目录 <broadcastDataDir>/ws-coord/，
  //     代码独立装配单元（installWsCoord）——防 08-08「广播挂 COI 拆不开」
  //     事故重演，将来若要拆出成本低。
  let broadcastDispose = null
  let broadcastStoreRef = null
  let wsCoordDispose = null
  const wsCoordCtrl = {
    sync() {
      // 子开关依赖广播大开关：broadcastEnabled 关 = wsCoord 不注册
      const enabled = runtime.wsCoordEnabled === true && broadcastDispose !== null
      if (enabled && wsCoordDispose === null) {
        const installed = installWsCoord(ctx, config, { broadcastStore: broadcastStoreRef })
        wsCoordDispose = installed.dispose
      } else if (!enabled && wsCoordDispose !== null) {
        wsCoordDispose()
        wsCoordDispose = null
      }
    },
  }
  const broadcastCtrl = {
    sync() {
      const enabled = runtime.broadcastEnabled === true
      if (enabled && broadcastDispose === null) {
        const installed = installBroadcast(ctx, config)
        broadcastDispose = installed.dispose
        broadcastStoreRef = installed.store
        // 广播装好后同步 wsCoord（wsCoordEnabled 已开时随广播一起装）
        wsCoordCtrl.sync()
      } else if (!enabled && broadcastDispose !== null) {
        // 广播卸载时 wsCoord 一并卸载（先子后父，依赖顺序）
        if (wsCoordDispose !== null) {
          wsCoordDispose()
          wsCoordDispose = null
        }
        broadcastDispose()
        broadcastDispose = null
        broadcastStoreRef = null
      }
    },
  }
  broadcastCtrl.sync()

  // 7.55 会话编排（de_session）：**独立子模块**（与广播同一纪律——独立
  //      领域不挂别的模块下）。sessionEnabled 独立开关（默认关）：开启时
  //      注册 de_session 工具（spawn 新建会话 / wake 唤醒已有会话 /
  //      status/list 查状态），关闭时整体卸载（并清理本模块 spawn 出的
  //      live agent，用户自己的会话不受影响）；存储独立目录
  //      sessionDataDir（<memoryDir>/session-orch）。依赖 DSH agents 服务，
  //      仅同进程会话可唤醒；spawn 加房间经 getBroadcastStore 桥接广播。
  let sessionDispose = null
  const sessionCtrl = {
    sync() {
      const enabled = runtime.sessionEnabled === true
      if (enabled && sessionDispose === null) {
        const installed = installSession(ctx, config, {
          getBroadcastStore: () => broadcastStoreRef,
          // 共享别名存储（与 /api/aliases 同一实例，rename 改别名即时一致）
          aliasStore,
        })
        sessionDispose = installed.dispose
      } else if (!enabled && sessionDispose !== null) {
        sessionDispose()
        sessionDispose = null
      }
    },
  }
  sessionCtrl.sync()

  // 7.6 会话搜索（de_session_search）：**独立子模块**（与广播同一纪律）。
  //     sessionSearchEnabled 独立开关（默认关）：开启时注册 de_session_search
  //     工具（实时只读扫描 Codex 会话，无索引/缓存/定时器），关闭时注销。
  //     存储零依赖——不建目录不落盘，root 覆盖走静态 config.sessionSearchRoots。
  let sessionSearchDispose = null
  const sessionSearchCtrl = {
    sync() {
      const enabled = runtime.sessionSearchEnabled === true
      if (enabled && sessionSearchDispose === null) {
        const installed = installSessionSearch(ctx, config)
        sessionSearchDispose = installed.dispose
      } else if (!enabled && sessionSearchDispose !== null) {
        sessionSearchDispose()
        sessionSearchDispose = null
      }
    },
  }
  sessionSearchCtrl.sync()

  // 8. 提示词管理器（Prompt Manager）：提示词库 CRUD + 注入轨（一次性/持续
  //    N 轮/每 M 回合一次，agent/turn-stopping 回合推进）+ 快照段 + Web API。
  //    复用「写后即时注入、不打断回复」通道；未来监测注入只对接注入轨 add
  //    入口。promptsEnabled 为运行时开关（默认禁用）：开启时安装，关闭时
  //    整体卸载（快照段/事件监听/API all移除，存储数据保留）。
  let promptsDispose = null
  const promptsCtrl = {
    sync() {
      const enabled = runtime.promptsEnabled === true
      if (enabled && promptsDispose === null) {
        const installed = installPrompts(ctx, config)
        promptsDispose = installed.dispose
      } else if (!enabled && promptsDispose !== null) {
        promptsDispose()
        promptsDispose = null
      }
    },
  }
  promptsCtrl.sync()

  // 9. DSH UI 设置（dsh-ui-settings）：**独立子模块**（用户拍板纪律——
  //    独立领域不挂别的模块下）。对 DSH web 界面做样式级小功能（第一版：
  //    左侧会话列表「仅显示进行中」筛选 + 折叠工作区运行徽标）。纯客户端
  //    实现（CSS + DOM 增强，注入逻辑在 src/client/session-filter.ts），
  //    宿主端提供独立开关 uiSettingsEnabled（默认关）、状态探测端点
  //    GET /api/ui-settings/state（关闭时 404，客户端探测失败即不注入任何
  //    东西）与**运行中会话快照** GET /api/ui-settings/running（折叠的
  //    工作区分组不渲染会话行、DOM 计数会漏，由宿主端精确统计——
  //    agents.roots 的 status + workspace.sessionIds 归属）。开关在
  //    「设置」Tab 的「配置」里切换（applyRuntimePatch sync 链即时安装/卸载）。
  //
  // 运行中会话快照构建：遍历所有顶层 live agent（roots，即用户可见的
  // 会话），status==='running' 的按 workspace.sessionIds 归属到工作区，
  // 归属不到的合并为未分组（title=null）。groups 保持 workspace.list()
  // 顺序，客户端按行标题前缀匹配（workspace title 全局唯一）。
  //
  // ⚠️ 踩坑（2026-08-09 用户实测 bug）：workspace.list() 返回的包装对象
  // 是 { host, id, record:{...} } 结构——title/sessionIds 经**原型 getter**
  // 暴露（可读），但**没有 workspaceId getter**（真实 id 在 .id）。
  // 之前用 owner.workspaceId 做 Map key 全是 undefined → 所有组 get(undefined)
  // 命中同一个计数 → 每个工作区都显示相同的运行数。修复：**用 workspace
  // 对象引用本身做 Map key**（不依赖任何字段名），归属与取数天然一一对应。
  const buildRunningSnapshot = () => {
    const agentsSvc = ctx.get('agents')
    const workspaceSvc = ctx.get('workspaceRegistry')
    const roots = agentsSvc?.roots?.() ?? []
    const workspaces = workspaceSvc?.list?.() ?? []
    // 按 workspace 对象引用统计 running 数（sessionIds getter 精确归属）。
    const runningByWorkspace = new Map()
    let ungrouped = 0
    for (const agent of roots) {
      if (agent.status !== 'running') continue
      const sessionId = agent.session?.id
      const owner = sessionId === undefined ? undefined
        : workspaces.find((w) => (w.sessionIds ?? []).includes(sessionId))
      if (owner === undefined) ungrouped += 1
      else runningByWorkspace.set(owner, (runningByWorkspace.get(owner) ?? 0) + 1)
    }
    const groups = []
    for (const w of workspaces) {
      const running = runningByWorkspace.get(w) ?? 0
      groups.push({ title: w.title, workspaceId: w.id ?? null, running })
    }
    if (ungrouped > 0) groups.push({ title: null, workspaceId: null, running: ungrouped })
    const total = groups.reduce((sum, g) => sum + g.running, 0)
    return { total, groups }
  }
  let uiSettingsDispose = null
  const uiSettingsCtrl = {
    sync() {
      const enabled = runtime.uiSettingsEnabled === true
      if (enabled && uiSettingsDispose === null) {
        const installed = installUiSettings(ctx, { getRunningSnapshot: buildRunningSnapshot })
        // Mermaid 静态端点（/memory-evolve/mermaid/mermaid.min.js）跟随
        // DSH UI 设置模块的生命周期：模块关闭时端点一并卸载（client 的
        // 「Mermaid 图表渲染」功能开关在其「综合」列表里，模块关了功能
        // 自然没有入口）。独立文件独立函数（lib/mermaid.js），不借开关。
        const installedMermaid = installMermaid(ctx)
        uiSettingsDispose = () => {
          installed.dispose()
          installedMermaid.dispose()
        }
      } else if (!enabled && uiSettingsDispose !== null) {
        uiSettingsDispose()
        uiSettingsDispose = null
      }
    },
  }
  uiSettingsCtrl.sync()

  // 10. 会话书签（session bookmarks）：**独立子模块**（用户拍板纪律——
  //     独立领域不挂别的模块下）。每轮星标 + 书签列表 + 跳转（第一阶段
  //     不做分支）。纯 UI + 宿主 API（不注册 AI 工具）；存储独立 sidecar
  //     session-bookmarks.json。bookmarkEnabled 独立开关（默认关）：开启
  //     时安装 HTTP API，关闭时整体卸载（数据文件保留）；客户端探测
  //     /api/bookmarks/state 成功才注入 turnTail 星标与「书签」Tab。
  //     开关在「设置」Tab 的「配置」里切换（applyRuntimePatch sync 链
  //     即时安装/卸载）。
  let bookmarkDispose = null
  const bookmarkCtrl = {
    sync() {
      const enabled = runtime.bookmarkEnabled === true
      if (enabled && bookmarkDispose === null) {
        const installed = installBookmarks(ctx, config)
        bookmarkDispose = installed.dispose
      } else if (!enabled && bookmarkDispose !== null) {
        bookmarkDispose()
        bookmarkDispose = null
      }
    },
  }
  bookmarkCtrl.sync()

  // 11. 无限画板（canvas）：**独立子模块**（用户拍板纪律）。canvasEnabled
  //     独立开关（默认关）：开启时安装（de_canvas 工具 + HTTP API +
  //     <memoryDir>/canvas/ 存储），关闭时整体卸载（数据文件保留）。
  //     resolveCwd 复用主插件 agents 服务（与会话编排同款），供工具与
  //     API 解析会话归属键。开关在「设置」Tab 的「配置」里切换。
  let canvasDispose = null
  const canvasCtrl = {
    sync() {
      const enabled = runtime.canvasEnabled === true
      if (enabled && canvasDispose === null) {
        const installed = installCanvas(
          ctx,
          config,
          (sessionId) => ctx.get('agents')?.get?.(sessionId)?.session?.header?.cwd,
          // 会话显示名解析（2026-08-14 用户要求：归属徽标显示会话名称
          // 而非一长段 sessionId）：别名优先 → sessionTitle 服务实时取
          // （左侧列表标题）→ null（前端兜底短 ID）。与 advisor/notify
          // 同款模式。
          // ⚠️ 2026-08-14 修复：sessionTitle.get(session) 直接读
          // session.events，传 undefined 会崩（可选链不保护参数）——
          // 画板 GET 遍历**所有节点**的 sessionId，必然遇到不在本进程的
          // 会话（离线/已归档），曾导致整个 GET 500、前端刷新后空板
          // （用户反馈"冲突后刷新画板是空的"的真根因）。必须先判
          // agent?.session 存在再取标题；查不到会话名返回 null 让前端
          // 兜底短 ID，绝不让单个节点拖垮整板加载。
          (sessionId) => {
            if (!sessionId) return null
            const agent = ctx.get('agents')?.get?.(sessionId)
            const alias = aliasStore?.get?.(sessionId) ?? null
            if (alias) return alias
            const session = agent?.session
            if (!session) return null
            return ctx.sessionTitle?.get?.(session)?.title ?? null
          },
        )
        canvasDispose = installed.dispose
      } else if (!enabled && canvasDispose !== null) {
        canvasDispose()
        canvasDispose = null
      }
    },
  }
  canvasCtrl.sync()

  // 7.9 项目记忆跨设备同步：**独立子模块**（施工图 §7 第 6 步；独立领域
  //     独立开关纪律——syncEnabled 默认关）。2026-08-13 用户拍板：记忆同步
  //     完全由用户在 Web GUI（记忆同步 Tab）主动操作——**无 AI 侧入口**
  //     （/memory_sync 命令组与快照状态行均已删除），仅保留 GUI 侧
  //     syncOps/syncStatus（Tab 与 API 用）。关闭时整体卸载（记忆目录/仓库
  //     全保留）。store 的 entryIdMode 随开关动态切换（仅项目轨受影响，
  //     未启用零变化）。
  const syncCtrl = {
    sync() {
      const enabled = runtime.syncEnabled === true
      store.entryIdMode = enabled ? 'on' : 'off'
      if (syncDispose === null) {
        const installed = installMemorySync(ctx, { config, getRuntime, applyRuntimePatch, store })
        syncDispose = installed.dispose
        syncStatusRef = installed.syncStatus
        syncOpsRef = installed.ops
      }
    },
  }
  syncCtrl.sync()

  // 8.9 Advisor 评审能力（lib/advisor/）：**独立子模块**（用户拍板：与广播/
  //     COI 同一纪律）。advisorEnabled 开关（默认关）：开启时安装（可见面
  //     观察器 + 评审运行时 + /advisor 命令 + HTTP API + 数据目录
  //     <memoryDir>/advisor），关闭时整体卸载（dispose 统一清理）；运行中
  //     键变化（provider/model/prompt/窗口/队列/超时）经 reconfigure 热
  //     更新（按签名重建运行时，仅窗口类键原地生效）。
  let advisorRef = null
  const advisorConfigOf = () => {
    // 合并静态 config 与运行时 advisor 键（installAdvisor 只消费 advisor* 键；
    // runtime 覆盖优先）
    const merged = { ...config }
    for (const key of RUNTIME_KEYS) {
      if (key.startsWith('advisor') && runtime[key] !== undefined) merged[key] = runtime[key]
    }
    return merged
  }
  const advisorCtrl = {
    sync() {
      // **B2（Review）：控制面常驻**——API/命令/面板状态始终可用（默认关闭
      // 时面板可开、/advisor on 可开）；开关只影响 observer/runtime 是否
      // 评审（installAdvisor 内部 effectiveEnabled + ensureRuntime 门禁）。
      // 不再按 advisorEnabled 卸载（旧实现默认关闭时 /status 404、无法开启）。
      if (advisorRef === null) {
        const installed = installAdvisor(ctx, advisorConfigOf(), {
          dataDir: config.advisorDataDir,
          sessionName: (sessionId) => {
            // MAJOR-3：别名优先（AliasStore）→ sessionTitle → null
            // ⚠️ 曾误写 aliasStoreRef（未定义变量）→ sessionName 闭包抛
            // ReferenceError → renderAndEmit 在 onDelta 前静默失败（评审
            // 从未开始）；正确变量为 apply 内的 aliasStore
            // ⚠️ 2026-08-14 防御加固：sessionTitle.get 传 undefined 会崩
            //（可选链不保护参数），先判 agent?.session 存在。
            const agent = ctx.get('agents')?.get?.(sessionId)
            const alias = aliasStore?.get?.(sessionId) ?? null
            if (alias) return alias
            const session = agent?.session
            if (!session) return null
            return ctx.sessionTitle?.get?.(session)?.title ?? null
          },
          // 测试环境 ctx.logger 可能是对象（非 cordis 函数式）——兼容两种形态
          logger: typeof ctx.logger === 'function' ? (ctx.logger('advisor') ?? console) : console,
          persistAdvisorPatch: (patch) => applyRuntimePatch(patch),
          validatePatch: validateRuntimePatch,
        })
        advisorRef = installed
      } else {
        // 运行中键变化：热更新（含开关翻转——reconfigure 停/启all runtime）
        advisorRef.ctrl?.reconfigure?.(advisorConfigOf())
      }
    },
  }
  advisorCtrl.sync()
}
