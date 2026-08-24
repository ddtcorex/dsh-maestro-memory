/**
 * maestro-memory (@ddtcorex/dsh-maestro-memory) — client entry.
 *
 * Registers three session tabs ('conversation.view') — the ONLY
 * memory-management surface (the former settings-panel section was
 * removed):
 *   - Memory tab (memory-files): memory files + memory guide + pending memory suggestions
 *   - Skills tab (skills-hub): pending skill suggestions + skill management (SkillsBrowser)
 *   - Todos tab (todos-hub): pending todo suggestions + four-track todos (TodoView)
 * plus the optional COI dispatch / prompts / infinite canvas tabs, all backed by
 * the host's /memory-evolve/api routes (legacy path kept for compatibility; see rebrand note). Each tab label carries a
 * red-dot pending count (\uD83D\uDD34 Memory (N) / \uD83D\uDD34 Skills (N) / \uD83D\uDD34 Todos (N)) while
 * suggestions/skills/todos await confirmation, refreshed by polling the
 * badge endpoint and re-registering through the deferral handle's
 * refresh().
 */
import type { Context } from 'cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row lives in ui-conversation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { MemoryTabView } from './MemoryTabView.tsx'
import { SkillsTabView } from './SkillsTabView.tsx'
import { TodosTabView } from './TodosTabView.tsx'
import { SettingsTabView } from './SettingsTabView.tsx'
import { ModelsTabView } from './ModelsTabView.tsx'
import { UiSettingsTabView } from './UiSettingsView.tsx'
import { CoIView } from './CoIView.tsx'
import { HeaderActions } from './HeaderActions.tsx'
import { AdvisorHost } from './advisor/AdvisorPanel.tsx'
import { ADVISOR_CONNECTION_RESET_EVENT } from './advisor/advisor-store.ts'
import { BroadcastView } from './BroadcastView.tsx'
import { PromptView } from './PromptView.tsx'
import { BookmarksView } from './BookmarksView.tsx'
import { SyncView } from './SyncView.tsx'
import { createBookmarkInjector } from './bookmark-injector.tsx'
import { registerCanvasTab } from './canvas-grok/index.ts'
import { createSessionFilter } from './session-filter.ts'
import { createWideBubble, createWideChat } from './wide-chat.ts'
import { createContextMeterWarn } from './context-meter-warn.ts'
import { createMermaidRenderer } from './mermaid-render.ts'
import { FEATURES_EVENT, readFeatures } from './ui-settings-features.ts'
import styles from './styles.css'
import coiStyles from './coi-styles.css'
import promptStyles from './prompt-styles.css'
import broadcastStyles from './broadcast-styles.css'
import skillBrowserStyles from './skills-browser/styles.css'
import uiSettingsStyles from './ui-settings-styles.css'
import mermaidStyles from './mermaid-render.css'
import bookmarkStyles from './bookmark-styles.css'
import advisorStyles from './advisor/advisor-styles.css'
import mobileCss from './mobile.css'
import { createInputSheetEnhance } from './mobile-input-sheet'
import { createNotificationBell } from './notification-bell.tsx'
import { createTodoTabLifecycle, RUNTIME_CONFIG_CHANGED } from './todo-tab-lifecycle.js'
import notificationStyles from './notification-styles.css'

/** Locale namespace owned by this plugin (maestro-memory). */
const NS = 'maestro-memory'

/** Dictionary key set for the memory-evolve namespace. */
export type MemoryEvolveKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'memory-evolve': MemoryEvolveKey
  }
}

/** English dictionary (primary). `zh` is kept as an alias for compatibility but now also English-first. */
export const zh = {
  'tab.label': 'Skill Manager',
  'tab.label.alt': 'Skill Manager',
  'header.title': 'Skill Manager',
  'header.subtitle': 'Manage every skill · custom dirs · enable/disable · view & edit',
  'search.placeholder': 'Search skills by name, description, or when-to-use…',
  'search.empty': 'No matching skills',
  'filter.all': 'All',
  'status.enabled': 'Enabled',
  'disable': 'Disable',
  'enable': 'Enable',
  'disabled.badge': 'Disabled',
  'disabled.hint': 'Disabled: excluded from the model skill catalog',
  'protected.badge': 'System',
  'protected.hint': 'System skill (project source) — cannot be disabled',
  'toggle.failed': 'Toggle failed: {message}',
  'manage.dirs': 'Manage custom skill directories',
  'dirs.title': 'Custom Skill Directories',
  'dirs.help': 'Add directories containing skills (<dir>/<skill>/SKILL.md or <dir>/<skill>.md layouts). Directories persist in the plugin state.json and reload automatically after restart; paths overlapping an existing skill root are rejected.',
  'dirs.placeholder': 'Absolute path, e.g. ~/.hermes/skills/…',
  'dirs.add': 'Add',
  'dirs.remove': 'Remove',
  'dirs.empty': 'No custom directories yet',
  'dirs.missing': 'Directory missing',
  'pager.prev': 'Prev',
  'pager.next': 'Next',
  'pager.page': 'Page {page} / {total}',
  'skills.count': '{count} skills',
  'roots.count': '{count} roots',
  'pane.skills': 'Skills',
  'pane.files': 'Files',
  'pane.editor': 'Editor',
  'no.skill.selected': 'Select a skill on the left to start browsing',
  'no.root': 'This skill has no browsable local directory',
  'no.entries': 'Empty directory',
  'no.file': 'Select a text file to view or edit',
  'not.text': 'Not a text file — cannot preview',
  'too.large': 'File exceeds the 512 KiB read cap',
  'read.failed': 'Read failed: {message}',
  'write.failed': 'Save failed: {message}',
  'save': 'Save',
  'saving': 'Saving…',
  'saved': 'Saved',
  'edit': 'Edit',
  'cancel': 'Cancel',
  'discard': 'Discard',
  'dirty.hint': 'Unsaved changes',
  'readonly': 'Read-only',
  'bytes': '{size} B',
  'kib': '{size} KiB',
  'mib': '{size} MiB',
  'dir.up': 'Parent directory',
  'open.folder': 'Open directory',
  'source.badge': '{source}',
  'invocable': 'Invocable',
  'when.to.use': 'When to use',
  'description': 'Description',
  'resource.directory': 'Directory',
  'resource.url': 'Link',
  'resource.opaque': 'Resource',
  'refresh': 'Refresh',
  'loading.skills': 'Loading skills…',
  'loading.dir': 'Loading…',
  'tree.collapse': 'Collapse',
  'tree.expand': 'Expand',
  'path': 'Path',
  'root.label': 'Root',
  'editor.placeholder': 'Select a text file in the tree on the left to start editing.',
  'status.ready': 'Ready',
  'status.skill': 'Skill',
  'status.file': 'File',
  'status.unsaved': 'Unsaved',
  'status.saved': 'Saved',
  'confirm.discard.title': 'Discard unsaved changes?',
  'confirm.discard.body': 'Your changes to {name} are not saved. Switching files will lose them.',
  'confirm.discard.ok': 'Discard changes',
  'mtime.label': 'Modified {time}',
  'open.in.new.tab': 'Open in new tab',
  'preview': 'Preview',
  'memoryTab.label': 'Memory',
  'memoryTab.label.pending': '🔴 Memory ({count})',
  'skillsTab.label': 'Skills',
  'skillsTab.label.pending': '🔴 Skills ({count})',
  'todosTab.label': 'Todos',
  'todosTab.label.pending': '🔴 Todos ({count})',
  'coiTab.label': 'COI Dispatch',
  'coiTab.label.pending': '🔴 COI Dispatch ({count})',
  'broadcastTab.label': 'Broadcast',
  'broadcast.tab.guide': 'Guide',
  'broadcast.tab.messages': 'Messages',
  'broadcast.tab.rooms': 'Rooms',
  'broadcast.tab.settings': 'Settings',
  'broadcast.settings.wsCoord.title': 'Workspace coordination (ws-coord)',
  'broadcast.settings.wsCoord.desc': 'Resource-occupancy coordination for parallel sessions in one workspace — declare files you will modify (de_ws_declare), auto-register writes, write-conflict detection (soft warning / hard block switchable), and de_ws_status to see "who is running and what they are doing". These switches only control this sub-feature; the "Session broadcast" master switch lives under Memory Evolve Settings → Config.',
  'broadcast.settings.wsCoord.enabled': 'Enable workspace coordination',
  'broadcast.settings.wsCoord.enabled.hint': 'Registers de_ws_declare / de_ws_status / de_ws_release tools + write-conflict detection listeners + the activity snapshot section. Depends on the "Session broadcast" master switch (unavailable while broadcast is off). Off by default',
  'broadcast.settings.wsCoord.snapshot': 'Activity snapshot section',
  'broadcast.settings.wsCoord.snapshot.hint': 'When ≥2 sessions are active in the workspace, inject one 【Workspace activity】 line into the per-turn snapshot (with the current time and what each session is doing); zero cost with 0-1 active sessions',
  'broadcast.settings.wsCoord.enforce': 'Hard-block mode',
  'broadcast.settings.wsCoord.enforce.hint': 'Off by default (soft mode: trust the AI — conflicts warn but never block); when on, writes to files occupied by other sessions are denied at the tool layer (deny), and the AI sees the reason and adjusts on its own',
  'broadcast.guide.intro.title': 'What is Session Broadcast',
  'broadcast.guide.intro.body': 'Session broadcast = a message channel between DSH sessions: send messages to other sessions (the AI sends them via the de_broadcast send tool) and the receiver sees a "Session broadcast" notice in its next snapshot. Messages are managed like an inbox — subject + summary, auto-deleted once every recipient has read them.',
  'broadcast.guide.send.title': 'How to send',
  'broadcast.guide.send.body': 'Just tell the AI "broadcast to session XX…" (default is one-to-one; the recipient is the other session ID):',
  'broadcast.guide.send.item1': 'One-to-one: give the recipient session ID (send them your "copy session ID" result and their AI can reply to you);',
  'broadcast.guide.send.item2': 'Rooms: multi-member chat rooms that work across working directories — everyone in the room sees the message (send to room:<room-id>);',
  'broadcast.guide.send.item3': 'Project: visible to every session under that working directory (send to project:/absolute-path).',
  'broadcast.guide.inbox.title': 'Inbox (Messages tab)',
  'broadcast.guide.inbox.body': 'The list shows only unread non-room messages by default (read ones are hidden; room messages live inside the room):',
  'broadcast.guide.inbox.item1': 'Filter: unread / all / read; search subject, sender, content; paged 20 per page;',
  'broadcast.guide.inbox.item2': 'Click "expand" for the full text; the red "delete" is an admin delete (hidden from everyone);',
  'broadcast.guide.inbox.item3': 'One-to-one messages are auto-deleted once every recipient has read them (consumed, out of the list).',
  'broadcast.guide.room.title': 'Rooms tab: multi-member chat rooms',
  'broadcast.guide.room.body': 'Rooms = multi-member collaboration chat rooms:',
  'broadcast.guide.room.item1': 'Expand a room to see member presence: 🟢 running = generating right now (you can wait; it sees messages within its turn), ⚪ idle / unknown = turn over or unknown (do not just wait);',
  'broadcast.guide.room.item2': 'Room messages share the inbox filters / search / paging; the creator can kick members and dissolve the room (system notices are sent);',
  'broadcast.guide.room.item3': 'Dissolved rooms keep their records for traceability; members can no longer join or post.',
  'broadcast.guide.alias.title': 'Session aliases: recognize a session at a glance',
  'broadcast.guide.alias.body': 'Give a session a friendly name (≤10 chars) — shown in snapshots, lists and messages as an alias (short ID):',
  'broadcast.guide.alias.item1': 'The "My session" row on top: copy session ID / copy alias, then send it to the other side to start chatting;',
  'broadcast.guide.alias.item2': 'The ⧉ copy-session-ID / ✎ alias buttons at the top right of a session also work.',
  'broadcast.guide.switch.title': 'Switch',
  'broadcast.guide.switch.body': 'Session broadcast is off by default: enable "Session broadcast" under "Config" in the "Memory Evolve Settings" tab, then refresh to reveal this tab.',
  'broadcast.guide.wscoord.title': 'Workspace coordination: parallel work without collisions',
  'broadcast.guide.wscoord.body': 'When several sessions edit the same project in parallel, use the workspace coordination in the "Settings" page to avoid overwriting each other:',
  'broadcast.guide.wscoord.item1': 'Before starting, have the AI "declare which files you will change" (de_ws_declare) — others (and their AIs) can see who is editing what;',
  'broadcast.guide.wscoord.item2': 'Write-time conflict detection: soft mode warns first (default); hard mode can be enabled — writes into files claimed by others are rejected outright;',
  'broadcast.guide.wscoord.item3': 'The "activity" overview (de_ws_status) shows who is running and what they are doing; the switch lives in the Settings page (requires the Session broadcast master switch).',
  'broadcast.mySessionId': 'My session ID',
  'broadcast.copyId': 'Copy',
  'broadcast.copied': 'Copied',
  'broadcast.loading': 'Loading…',
  'broadcast.refresh': 'Refresh',
  'broadcast.messages.empty': '(no messages)',
  'broadcast.messages.sender': 'From',
  'broadcast.messages.to': 'To',
  'broadcast.messages.direct': 'direct',
  'broadcast.messages.room': 'room',
  'broadcast.messages.project': 'project',
  'broadcast.messages.unread': 'unread',
  'broadcast.messages.long': 'long',
  'broadcast.message.expand': 'Expand',
  'broadcast.message.collapse': 'Collapse',
  'broadcast.message.delete': 'Delete',
  'broadcast.message.deleteConfirm': 'Delete this message? (admin action, invisible to everyone)\n\n{subject}',
  'broadcast.message.deleted': 'Deleted',
  'broadcast.copyAlias': 'Copy alias',
  'broadcast.msg.unread': 'unread',
  'broadcast.msg.read': 'read',
  'broadcast.filter.unread': 'Unread',
  'broadcast.filter.all': 'All',
  'broadcast.filter.read': 'Read',
  'broadcast.searchPh': 'Search subject/sender/content…',
  'broadcast.pagePrev': 'Prev',
  'broadcast.pageNext': 'Next',
  'broadcast.pageInfo': 'Page {page}/{total}',
  'broadcast.room.detail': 'Details',
  'broadcast.room.messages': 'Room messages',
  'broadcast.room.messages.empty': '(no room messages)',
  'broadcast.messages.roomInRooms': 'Room messages live inside their room — open it from the Rooms view',
  'broadcast.rooms.empty': '(no rooms)',
  'broadcast.roomSearchPh': 'Search room name…',
  'broadcast.roomStatus.all': 'All',
  'broadcast.roomStatus.active': 'Active',
  'broadcast.roomStatus.dissolved': 'Dissolved',
  'broadcast.roomDays.0': 'Any time',
  'broadcast.roomDays.7': 'Last 7 days',
  'broadcast.roomDays.30': 'Last 30 days',
  'broadcast.room.status.active': 'active',
  'broadcast.room.status.idle': 'idle',
  'broadcast.room.status.dissolved': 'dissolved',
  'broadcast.room.online': '{online}/{total} online',
  'broadcast.room.members': 'Members',
  'broadcast.room.kick': 'Kick',
  'broadcast.room.kickConfirm': 'Kick member {member}? (a system notice is sent; the session loses room access)',
  'broadcast.room.dissolve': 'Dissolve',
  'broadcast.room.dissolveConfirm': 'Dissolve room "{name}"? (soft delete: record kept for traceability, members get a system notice, no further joins/messages)',
  'broadcast.room.dissolved': 'dissolved',
  'broadcast.room.copyId': 'Copy room id',
  'broadcast.room.lastActive': 'Last active',
  'broadcast.room.created': 'Created',
  'broadcast.room.presence.unknown': 'unknown · no activity recorded',
  'header.copySessionId': '⧉ Copy session ID',
  'header.copySessionId.done': '✓ Copied',
  'header.copySessionId.title': 'Copy this session\\'s ID (send it to another session: tell its AI your session ID so it can broadcast to you via de_broadcast)',
  'header.setAlias': '✎ Alias',
  'header.setAlias.title': 'Set a session alias (≤10 chars) — shown as your friendly name in the snapshot / broadcast panel / messages',
  'header.setAlias.placeholder': 'alias (≤10 chars)',
  'header.setAlias.save': 'Save',
  'header.setAlias.clear': 'Clear',
  'header.setAlias.saved': 'Alias saved',
  'header.setAlias.cleared': 'Alias cleared',
  'advisor.header.toggle': 'Session Review',
  'advisor.header.toggle.title': 'Open or collapse the Advisor review panel',
  'promptTab.label': 'Prompts',
  'promptTab.label.active': '🔴 Prompts ({count})',
  'settingsTab.label': 'Memory Evolve Settings',
  'settingsTab.label.pending': '🔴 Memory Evolve Settings',
  'settingsTab.feature.guide': 'Guide',
  'settingsTab.feature.config': 'Config',
  'settingsTab.feature.version': 'Version',
  'version.current': 'Current version',
  'version.latest': 'Latest version',
  'version.statusLabel': 'Status',
  'version.status.latest': 'Up to date',
  'version.status.outdated': 'Update available',
  'version.status.no-release': 'No releases yet',
  'version.status.unsupported': 'Auto-check unsupported',
  'version.status.unknown': 'Unknown',
  'version.loading': 'Checking…',
  'version.lastError': 'Last check failed',
  'version.checkTime': 'Last checked',
  'version.checking': 'Checking…',
  'version.checkNow': 'Check for updates',
  'version.updating': 'Updating…',
  'version.updateNow': 'Update to {tag}',
  'version.restart.title': 'Restart required',
  'version.restart.hint': 'New code is on disk. Restart dsh web first, then refresh the browser (a page refresh alone will not load the new code).',
  'version.releaseNotes': 'Release notes',
  'version.unsupported.hint': 'Auto-check requires a git clone install. Reinstall with `git clone git@github.com:csyangwen/maestro-memory.git` to enable it.',
  'version.note.no-release': 'No release tags (v0.x.y) on the remote yet.',
  'version.note.outdated': 'A new version is available — update below (restart dsh web afterwards).',
  'version.note.latest-exact': 'You are on the latest release.',
  'version.note.latest-contained': 'Your checkout already contains the latest release (dev-track ahead or synced).',
  'version.note.unsupported': 'Plugin dir is not a git repository or git is unavailable.',
  'version.error.bad-request': 'Bad request: {message}',
  'version.error.dirty': 'Update rejected: {message}',
  'version.error.busy': 'Update rejected: {message}',
  'version.error.target-changed': 'Target version changed: {message}',
  'version.error.untrusted': 'Update rejected: {message}',
  'version.error.unsupported': 'Auto-check unsupported: {message}',
  'version.error.error': 'Update failed: {message}',
  'version.error.network': 'Network request failed: {message}',
  'version.error.unknown': 'Unknown error',
  'memoryTab.feature.guide': 'Guide',
  'memoryTab.feature.suggestions': 'Memory suggestions',
  'skillsTab.feature.guide': 'Guide',
  'skillsTab.feature.skills': 'Skill suggestions',
  'skillsTab.feature.skillBrowser': 'Skill manager',
  'todosTab.feature.guide': 'Guide',
  'todosTab.feature.todoSuggestions': 'Todo suggestions',
  'todosTab.feature.todo': 'Todos',
  'modelsTab.label': 'Model Settings',
  'modelsTab.feature.models': 'Model Settings',
  'modelsTab.feature.guide': 'Guide',
  'modelsTab.guide.what.title': 'What is Model Settings',
  'modelsTab.guide.what.body': 'A table view of every DSH provider and model, with per-model plugin-side settings (enabled state, note, reasoning levels). All settings belong to this plugin (models.json) — DSH configuration is never touched and nothing couples to other plugins:',
  'modelsTab.guide.what.item1': 'Columns: enabled switch, provider (with DSH activation state), model (name + ID), context / output capacity, reasoning levels, image-input marker (🖼), note; search and a "show reasoning levels" toggle;',
  'modelsTab.guide.what.item2': 'Per model: enable / disable (a plugin-side availability flag — DSH routing is untouched), note, thinking support, allowed reasoning levels, recommended level, custom levels;',
  'modelsTab.guide.what.item3': 'Settings persist immediately (<memoryDir>/models.json) across restarts.',
  'modelsTab.guide.config.title': 'Per-model settings',
  'modelsTab.guide.config.body': 'Expand a row ("configure levels") to edit reasoning settings:',
  'modelsTab.guide.config.item1': 'Enable / disable: decides which models the de_models tool lists by default (all enabled by default);',
  'modelsTab.guide.config.item2': 'Thinking support: when off the model cannot reason (only the off level remains);',
  'modelsTab.guide.config.item3': 'Recommended level: "auto" follows the model own recommendation by default; you can pin any available level;',
  'modelsTab.guide.config.item4': 'Allowed levels: tick which levels may be used (all by default); custom levels (e.g. ultra) can be added / removed;',
  'modelsTab.guide.config.item5': 'Image input: models explicitly declaring image support show the "🖼 image input" marker (from DSH model capability metadata, read-only); undeclared = unknown, no marker.',
  'modelsTab.guide.tool.title': 'de_models tool (for the AI)',
  'modelsTab.guide.tool.body': 'This module also registers the de_models tool so the AI can query the available model (endpoint) list:',
  'modelsTab.guide.tool.item1': 'Only "enabled" models are returned by default (all=true shows everything incl. disabled), filterable by provider;',
  'modelsTab.guide.tool.item2': 'Each model reports: enabled, DSH-activated, image input support (supportsImage: true / false / null=unknown), thinking support, allowed reasoning levels (incl. recommended and custom), note.',
  'modelsTab.guide.switch.title': 'Switch',
  'modelsTab.guide.switch.body': 'Model Settings are on by default; they can be turned off independently under "Config" in the "Memory Evolve Settings" tab like other modules — the tab and the de_models tool hide, settings data is kept.',
  'modelsTab.searchPh': 'Search provider, model, or note…',
  'modelsTab.showReasoning': 'Show reasoning levels',
  'modelsTab.refresh': 'Refresh',
  'modelsTab.loading': 'Loading…',
  'modelsTab.count': '{total} models · {enabled} enabled',
  'modelsTab.loadFailed': 'Load failed: {message}',
  'modelsTab.empty': '(No models)',
  'modelsTab.enabled': 'Enabled',
  'modelsTab.enable': 'Enable',
  'modelsTab.disable': 'Disable',
  'modelsTab.provider': 'Provider',
  'modelsTab.model': 'Model',
  'modelsTab.capacity': 'Context/Output',
  'modelsTab.reasoning': 'Reasoning',
  'modelsTab.note': 'Note',
  'modelsTab.notePh': 'Add a note…',
  'modelsTab.dormant': 'Inactive',
  'modelsTab.thinking': 'Support thinking',
  'modelsTab.thinkingHint': 'When off, this model cannot reason (only the off level stays available)',
  'modelsTab.thinkingOff': 'Thinking off',
  'modelsTab.supportsImage': '🖼 Image input',
  'modelsTab.supportsImageHint': 'This model explicitly declares image input support (from DSH model capability metadata inputModalities)',
  'modelsTab.recommendedLevel': 'Recommended level',
  'modelsTab.recommendedAuto': 'Auto (follow model recommendation)',
  'modelsTab.levelsNone': 'All disabled',
  'modelsTab.editLevels': 'Configure levels',
  'modelsTab.closeEditor': 'Collapse',
  'modelsTab.editorTitle': 'Available reasoning levels (check = allowed; recommended comes from the model)',
  'modelsTab.recommended': 'Recommended',
  'modelsTab.addLevel': 'Add',
  'modelsTab.removeLevel': 'Remove',
  'modelsTab.levelIdPh': 'Level ID (e.g. ultra)',
  'modelsTab.levelNamePh': 'Display name (e.g. Ultra)',
  'modelsTab.save': 'Save',
  'modelsTab.saving': 'Saving…',
  'modelsTab.cancel': 'Cancel',
  'uiSettingsTab.label': 'Web UI Settings',
  'uiSettingsTab.feature.mixed': 'General',
  'uiSettingsTab.feature.guide': 'Guide',
  'uiSettingsTab.features.title': 'Feature switches',
  'uiSettingsTab.features.help': 'Every feature has its own small switch, **all off by default** — you turn them on deliberately; changes apply immediately (features stay under "General" until they mature and get their own categories).',
  'uiSettingsTab.guide.what.title': 'What is Web UI Settings',
  'uiSettingsTab.guide.what.body': 'Style-level tweaks for the DSH web GUI — no framework source changes, pure client-side injection (CSS + DOM enhancement) that survives DSH updates; future extensions (themes etc.) all land in this module.',
  'uiSettingsTab.guide.switch.title': 'Switches',
  'uiSettingsTab.guide.switch.body': 'The module switch lives under "Config" in the "Memory Evolve Settings" tab (off by default); the per-feature switches live in the "General" sub-tab — also all off by default, turned on deliberately.',
  'uiSettingsTab.guide.features.title': 'Features',
  'uiSettingsTab.guide.features.body': 'Each feature has an independent switch in the "General" page; it takes effect immediately:',
  'uiSettingsTab.guide.features.item1': 'Session filter: the left session list shows only active sessions; purely idle ones collapse, one click switches back to all;',
  'uiSettingsTab.guide.features.item2': 'Wide conversation: the middle transcript area widens from about half to about 95%, more comfortable for long messages;',
  'uiSettingsTab.guide.features.item3': 'Wide bubbles: the user message bubble grows from its 525px cap to about 80% width (pairs best with the wide conversation);',
  'uiSettingsTab.guide.features.item4': 'Context warning: the context ring turns yellow above 30% and red above 40% — a nudge to bookmark or start a fresh session;',
  'uiSettingsTab.guide.features.item5': 'Mermaid rendering: mermaid code blocks in messages render into diagrams; on failure they fall back to plain code blocks.',
  'uiSettings.feature.sessionFilter': 'Session filter',
  'uiSettings.feature.sessionFilter.hint': 'The left session list shows only active sessions (purely idle ones collapse; one click switches back to all); the filter bar appears only while this is on',
  'uiSettings.feature.wideChat': 'Wide conversation area',
  'uiSettings.feature.wideChat.hint': 'Widen the conversation transcript/input area from roughly half to about 95% of the right pane (aligned with the tabs bar above)',
  'uiSettings.feature.wideBubble': 'Wide message bubble',
  'uiSettings.feature.wideBubble.hint': 'Widen the user message bubble from its 525px cap to about 80% of the content column (pairs well with "Wide conversation area")',
  'uiSettings.feature.contextWarn': 'Context usage warning',
  'uiSettings.feature.contextWarn.hint': 'The context-usage ring beside the input box turns yellow above 30% occupancy and red above 40%; back to its default color below the threshold',
  'uiSettings.feature.mermaidRender': 'Mermaid diagram rendering',
  'uiSettings.feature.mermaidRender.hint': 'Render mermaid code blocks in messages as diagrams (DSH itself does not render mermaid); the engine loads lazily on first diagram, works on PC and mobile alike, and falls back to the code block on failure',
  'uiSettings.filter.on': 'Running only',
  'uiSettings.filter.off': 'All',
  'uiSettings.running.label': '{count} running',
  'uiSettings.ungrouped': 'Ungrouped',
  'syncTab.label': 'Memory Sync',
  'syncTab.loading': 'Loading…',
  'syncTab.loadFailed': 'Failed to load status: {message}',
  'syncTab.tab.project': 'This project',
  'syncTab.tab.global': 'Global memory',
  'syncTab.tab.remote': 'Shared memory repo',
  'syncTab.section.project': 'Project memory (KEY + project log + archive + project todos)',
  'syncTab.section.global': 'Global memory (device-level, project-independent)',
  'syncTab.section.remote': 'Shared memory repo (device-level config)',
  'syncTab.project.mode.off': 'Disabled (local only)',
  'syncTab.project.mode.off.desc': 'Project memory stays on this machine: no repo, no entry IDs, no reconciliation with any remote',
  'syncTab.project.mode.main': 'Mode A: main code repo (zero config)',
  'syncTab.project.mode.main.desc': 'Project memory lives in a dedicated branch of your code repo (never touches your code). **A public code repo means public memory**',
  'syncTab.project.mode.shared': 'Mode B: shared memory repo',
  'syncTab.project.mode.shared.desc': 'Project memory lives in a dedicated branch of the shared memory repo, fully isolated from your code',
  'syncTab.project.mode.shared.needRemote': 'Shared memory repo is not enabled — switched to "Shared memory repo", please enable and save the URL first',
  'syncTab.status.title': 'Current memory remote',
  'syncTab.status.disabled': 'Disabled — enable sync for this project above to begin',
  'syncTab.status.notInit': 'Enabled, but this project is not initialized yet — pick Mode A or B above to initialize',
  'syncTab.status.remoteKind': 'Memory remote: {kind}',
  'syncTab.status.remoteKindMain': 'main code repo',
  'syncTab.status.remoteKindShared': 'shared memory repo',
  'syncTab.status.remoteKindNone': 'not mounted',
  'syncTab.status.originUrl': 'Remote URL: {url}',
  'syncTab.status.branch': 'Remote branch: {branch}',
  'syncTab.status.counts': '{pending} not pushed · {behind} behind · {conflicts} conflicts',
  'syncTab.status.migrate': 'Legacy memory dir found: {dir} — "Start sync" will migrate it',
  'syncTab.global.title': 'Global memory',
  'syncTab.global.uncommitted': '{n} tracks not pushed (uncommitted + unpushed commits)',
  'syncTab.global.trackMemory': 'Global memory (MEMORY.md)',
  'syncTab.global.trackUser': 'User profile (USER.md)',
  'syncTab.global.trackDaily': 'Daily logs (daily/*.md)',
  'syncTab.global.trackTodo': 'Todos: life/work/daily (TODOS-*.md)',
  'syncTab.global.hint': 'Global memory (user profile / daily logs / todos) belongs to no single project — all projects share this one set of switches; push always requires your explicit click',
  'syncTab.global.sync': 'Fetch & merge',
  'syncTab.global.push': 'Push',
  'syncTab.global.notInit': 'Shared memory repo is not enabled — global memory is unavailable; enable and save the URL on the "Shared memory repo" page first',
  'syncTab.remote.desc': 'One shared memory repo for the whole device: project Mode B and global memory (user profile / daily logs / todos) both reference it — enable and save the URL once.',
  'syncTab.remote.mode.off': 'Disabled',
  'syncTab.remote.mode.off.desc': 'Project Mode B and global memory unavailable; synced data and the URL are kept',
  'syncTab.remote.mode.on': 'Enabled',
  'syncTab.remote.mode.on.desc': 'Project Mode B and global memory available; save the repo URL first',
  'syncTab.remote.disable': 'Disable shared memory repo',
  'syncTab.remote.current': 'Current shared memory repo: {url}',
  'syncTab.remote.placeholder': 'Paste a shared memory repo URL (e.g. ssh://git@.../dsh-memories.git)',
  'syncTab.remote.save': 'Enable & save',
  'syncTab.remote.modify': 'Modify & save',
  'syncTab.remote.switchHint': 'Disabling turns off the shared memory repo (project Mode B and global memory become unavailable); synced data and the URL are kept, re-enable anytime.',
  'syncTab.actions.sync': 'Fetch & merge',
  'syncTab.actions.push': 'Push',
  'syncTab.actions.nothingToSync': 'Nothing to sync — enable this project or a global track first',
  'syncTab.conflicts.title': 'Conflicts ({count} — both devices edited the same entry)',
  'syncTab.conflicts.titleGlobal': 'Global {track}: {count} pending conflicts (both devices edited the same entry)',
  'syncTab.conflicts.base': 'Base',
  'syncTab.conflicts.ours': 'Ours',
  'syncTab.conflicts.theirs': 'Theirs',
  'syncTab.conflicts.oursBtn': 'Use ours',
  'syncTab.conflicts.theirsBtn': 'Use theirs',
  'syncTab.conflicts.bothBtn': 'Keep both',
  'syncTab.footnote': 'Writing memory stays real-time local (no Git touched); sync batches up. Conflict markers never hit disk; resolving auto-commits.',
  'bookmarkTab.label': 'Bookmarks',
  'bookmark.tab.list': 'List',
  'bookmark.tab.guide': 'Guide',
  'bookmark.list.title': 'Session bookmarks',
  'bookmark.list.help': 'Click a bookmark to jump to that turn; star ☆ at each turn tail to bookmark, ★ when bookmarked (rename/delete); searchable list; fork from any turn (official mid-turn branch buttons are taken over by Memory Evolve).',
  'bookmark.refresh': 'Refresh',
  'bookmark.loading': 'Loading…',
  'bookmark.empty': '(No bookmarks yet — click ☆ at a turn tail)',
  'bookmark.defaultLabel': 'Turn {n}',
  'bookmark.turn': 'Turn {n}',
  'bookmark.prompt.create': 'Bookmark name (editable):',
  'bookmark.prompt.rename': 'New name:',
  'bookmark.confirm.delete': 'Delete bookmark "{label}"?',
  'bookmark.noSession': 'Cannot determine the current session (refresh the page and retry)',
  'bookmark.search.placeholder': 'Search bookmarks…',
  'bookmark.search.empty': '(No matching bookmarks)',
  'bookmark.star.title.off': '☆ Bookmark this turn (Memory Evolve session bookmarks)',
  'bookmark.star.title.on': '★ Bookmarked: {label} (Memory Evolve — click to rename/delete)',
  'bookmark.menu.rename': 'Rename',
  'bookmark.menu.delete': 'Delete',
  'bookmark.action.jump': 'Jump',
  'bookmark.action.fork': 'Fork',
  'bookmark.action.rename': 'Rename',
  'bookmark.action.delete': 'Delete',
  'bookmark.fork.title': 'Fork from this turn (Memory Evolve enhancement)',
  'bookmark.fork.confirm': 'Officially you can only fork from the last message. Fork from this turn (seq {n}) anyway? (Memory Evolve enhancement)',
  'bookmark.fork.working': 'Creating fork session…',
  'bookmark.fork.ok': 'New session created: {id} (see the session list on the left)',
  'bookmark.jump.hint': 'Click to jump to this turn',
  'bookmark.jumping': 'Locating…',
  'bookmark.jump.ok': 'Jumped to "{label}"',
  'bookmark.jump.notFound': 'Could not find the message for "{label}" (may be compacted or outside the loaded window)',
  'bookmark.jump.noChat': 'Chat tab not found — cannot jump',
  'bookmark.renamed': 'Renamed',
  'bookmark.deleted': 'Deleted',
  'bookmark.error': 'Failed: {message}',
  'bookmark.guide.what.title': 'What are session bookmarks',
  'bookmark.guide.what.body': 'Star any completed turn, then jump back to it from the list in one click; you can also fork an official branch session from any turn — start a new line from a mid-way decision point. Data lives in a plugin sidecar (official session logs are never touched); the official mid-turn branch buttons are taken over by this plugin (a confirm dialog, then the official fork path).',
  'bookmark.guide.star.title': 'How to star',
  'bookmark.guide.star.body': 'Every completed turn has a ☆ button at its tail: click it, name it (default "Turn N") and it is bookmarked; ★ means bookmarked — click again to rename or delete. The small icon does not crowd Copy / Branch.',
  'bookmark.guide.list.title': 'List and jump',
  'bookmark.guide.list.body': 'This tab lists every bookmark of the current session (label, turn, time, summary). Click to jump: it switches back to the Chat tab and scrolls to that turn; if the target lies outside the loaded history window it fetches older messages first.',
  'bookmark.guide.switch.title': 'Switch',
  'bookmark.guide.switch.body': 'Off by default; enable "Session bookmarks" under Memory Evolve Settings → Config. When off, stars and this tab hide; the sidecar file is kept.',
  'panel.guide.bookmark.title': 'Session bookmarks',
  'panel.guide.bookmark.desc': 'Star any turn and jump back from the list; fork official branch sessions from any turn (including taking over official mid-turn branch buttons). Independent switch, off by default.',
  'panel.config.bookmarkEnabled': 'Session bookmarks',
  'panel.config.bookmarkEnabled.hint': 'Enable session bookmarks: a ☆ star on each completed turn tail + a Bookmarks tab for the list and jump; fork official branch sessions from any turn (list "Fork" button, or click the official branch button — mid-turn buttons are taken over with a confirm dialog). Data lives in <memoryDir>/session-bookmarks.json (per-session, keyed by turn seq). **Independent submodule** (off by default; pure UI + host API, no AI tools); when off, stars and the tab hide, the data file is kept.',
  'panel.config.todoEnabled': 'Todos',
  'panel.config.todoEnabled.hint': 'Enable the dtodo tool, Todos tab, and due reminders. When off, the tab hides immediately and todo writes stop; existing data and the sync track stay intact.',
  'memoryTab.feature.config': 'Config',
  'memoryTab.feature.todoSuggestions': 'Todo suggestions',
  'memoryTab.feature.skills': 'Skill suggestions',
  'memoryTab.feature.skillBrowser': 'Skill manager',
  'memoryTab.feature.todo': 'Todos',
  'memoryTab.guide.tracks.title': 'Five memory tracks: the AI long-term working memory',
  'memoryTab.guide.tracks.body': 'Memory is organized in five tiers by "who should see it"; injection scope narrows by tier and tiers never pollute each other — what should be injected is auto-injected, the rest is read on demand:',
  'memoryTab.guide.tracks.item1': 'User profile (user): who you are — preferences, habits, communication style. Injected into every session, so you never re-introduce yourself;',
  'memoryTab.guide.tracks.item2': 'Long-term memory (memory): global facts — environment, tools, general conventions. Injected into every session;',
  'memoryTab.guide.tracks.item3': 'Key project facts (key): conventions, decisions, architecture, pitfalls of the current project. Injected only into this project sessions, filtered by git branch — each branch keeps its own conventions;',
  'memoryTab.guide.tracks.item4': 'Project log (project): the running record of this project. Never injected; the AI reads it on demand, history is traceable;',
  'memoryTab.guide.tracks.item5': 'Daily log (daily): per-day progress notes. Never injected; read on demand — like a daily work report.',
  'memoryTab.guide.files.title': 'File tabs: read the memory files directly',
  'memoryTab.guide.files.body': 'This tab previews AGENTS.md (global rules) and every memory file. File tabs are read-only — edit through the memory tool or via the actions in this tab, to avoid breaking the §-delimited format:',
  'memoryTab.guide.files.item1': 'Beauty view: each entry is a card (time / branch / tag badges + content), searchable and filterable; a plain-text view shows the raw text;',
  'memoryTab.guide.files.item2': 'The KEY tab lets you manually add long-term project facts (optionally scoped to certain git branches); they are injected next turn after saving;',
  'memoryTab.guide.files.item3': 'Every entry can be edited (writes need confirmation), deleted (exact full-entry match, no accidental deletions), archived / restored to the main track.',
  'memoryTab.guide.branch.title': 'Git branch awareness: different branches, different conventions',
  'memoryTab.guide.branch.body': 'Different branches of the same project can carry completely different conventions; project-level memory tracks the current branch end to end:',
  'memoryTab.guide.branch.item1': 'Key entries can carry a branch-scope marker (no marker = visible on all branches); injection only includes "no marker" + "covers the current branch";',
  'memoryTab.guide.branch.item2': 'Log entries are automatically tagged with their source branch ([git branch name]), so cross-branch reviews never mix things up.',
  'memoryTab.guide.maintain.title': 'Edit & maintain: day-to-day care of the memory',
  'memoryTab.guide.maintain.body': 'All memory maintenance happens right here:',
  'memoryTab.guide.maintain.item1': 'Edit the body only — timestamps / branch / tags are maintained by the program;',
  'memoryTab.guide.maintain.item2': 'Delete: exact full-entry matching (long entries that contain others are never accidentally removed); deletion is irreversible;',
  'memoryTab.guide.maintain.item3': 'Archive / restore: move low-frequency entries out of the main track (kept for reference, no injection), restore them anytime.',
  'memoryTab.guide.suggestions.title': 'Memory suggestions: the AI proposes, you decide',
  'memoryTab.guide.suggestions.body': 'The background review distills "what is worth remembering" into a pending queue — the AI never writes into the memory on its own:',
  'memoryTab.guide.suggestions.item1': 'Approve: optionally edit the text first and pick the target track (long-term memory / user profile / key project facts); it is injected with the next snapshot;',
  'memoryTab.guide.suggestions.item2': 'Archive: no injection, kept for reference, restorable; Reject: discard.',
  'memoryTab.guide.confirm.title': 'The confirmation system: why your approval is required',
  'memoryTab.guide.confirm.body': 'Memory writes genuinely change the AI behavior — once written they enter the context and affect every later reply. So everything goes through your confirmation first: that is the gate of memory evolution. You are in charge.',
  'skillsTab.guide.what.title': 'What a skill is: a methodology manual for the AI',
  'skillsTab.guide.what.body': 'A skill = a methodology document for the AI (SKILL.md: name + description + steps). It is injected into every session system prompt — next time the AI meets the same kind of task it follows your process instead of re-inventing it:',
  'skillsTab.guide.what.item1': 'The skill library lives at ~/.agents/skills by default (one directory per skill);',
  'skillsTab.guide.what.item2': 'DSH also scans project skills, bundled skills and custom directories — all visible and manageable in this tab.',
  'skillsTab.guide.how.title': 'How skills form',
  'skillsTab.guide.how.body': 'Methodologies learned the hard way are solidified into skills through two main paths:',
  'skillsTab.guide.how.item1': 'Background review: when the AI notices a recurring pattern it creates a skill, which lands in "skill suggestions" — after your approval it moves into the library;',
  'skillsTab.guide.how.item2': 'The skill_manage tool: just tell the AI "save this process as a skill" and it creates / updates one;',
  'skillsTab.guide.how.item3': 'Create sparingly: only "recurring, hard-won, reusable" skills — every skill is injected into every session and affects the context.',
  'skillsTab.guide.pending.title': 'Skill suggestions',
  'skillsTab.guide.pending.body': 'Review-created skills wait for your confirmation here:',
  'skillsTab.guide.pending.item1': 'Approve: moved into the skill library (~/.agents/skills), injected with the system prompt, immediately usable in every session;',
  'skillsTab.guide.pending.item2': 'Reject: discard the skill.',
  'skillsTab.guide.manager.title': 'Skill manager: browse, edit, custom directories',
  'skillsTab.guide.manager.body': 'The full skill manager (three panes: skill list / directory tree / file view-edit):',
  'skillsTab.guide.manager.item1': 'All skills are grouped by source (user user-* / custom / bundled / project project-*), searchable and filterable;',
  'skillsTab.guide.manager.item2': 'Custom skill directories: add / remove any skill directory (<dir>/<skill>/SKILL.md or <dir>/<skill>.md layout);',
  'skillsTab.guide.manager.item3': 'File browsing & editing: directory tree + text view / edit (scoped to skill directories; out-of-bounds, binary and oversized files are rejected);',
  'skillsTab.guide.manager.item4': 'Disabled-list and custom directories persist across restarts.',
  'skillsTab.guide.disable.title': 'Disable / enable: hide skills you do not want',
  'skillsTab.guide.disable.body': 'One click removes a skill from the model skill catalog (the model no longer sees it and the skill tool refuses to load it):',
  'skillsTab.guide.disable.item1': 'Re-enable anytime; the choice persists;',
  'skillsTab.guide.disable.item2': 'System skills (project source) cannot be disabled by design.',
  'skillsTab.guide.dirs.title': 'Custom skill directories',
  'skillsTab.guide.dirs.body': 'Add / remove your own skill directories in "Skill manager" (e.g. ~/.hermes/skills); paths overlapping an existing skill root are rejected; persisted and reloaded after restart.',
  'skillsTab.guide.restraint.title': 'Creation discipline: restraint is what makes skills effective',
  'skillsTab.guide.restraint.body': 'Skills are injected into every session system prompt and affect context and cache — create sparingly:',
  'skillsTab.guide.restraint.item1': 'Only create skills for "hard, recurring problems you will meet again";',
  'skillsTab.guide.restraint.item2': 'Never create a skill for a one-off or trivial task.',
  'todosTab.guide.tracks.title': 'Four todo tracks: everything in its place',
  'todosTab.guide.tracks.body': 'Todos are filed by target, isomorphic to the memory system:',
  'todosTab.guide.tracks.item1': 'Life (life): personal errands;',
  'todosTab.guide.tracks.item2': 'Work (work): cross-project business;',
  'todosTab.guide.tracks.item3': 'This project (project): todos of the current working directory — invisible from other directories, isolated by cwd;',
  'todosTab.guide.tracks.item4': 'Today (daily): per-day todo files, with past days reviewable (grouped by date).',
  'todosTab.guide.add.title': 'How to add',
  'todosTab.guide.add.body': 'Two ways, pick either:',
  'todosTab.guide.add.item1': 'Tell the AI "remember / I need to do X" (optionally say work / life / this project / today) and it files the todo into the right track;',
  'todosTab.guide.add.item2': 'Add manually in this tab input (quadrant and due date optional).',
  'todosTab.guide.pending.title': 'Todo suggestions: the AI cannot assign you work on its own',
  'todosTab.guide.pending.body': 'AI-proposed todos enter a pending queue first, effective only after your confirmation:',
  'todosTab.guide.pending.item1': 'Approve: written into the target track (a todo stays a todo, never becomes memory);',
  'todosTab.guide.pending.item2': 'Archive: kept for reference; Reject: discard.',
  'todosTab.guide.attrs.title': 'Status & attributes',
  'todosTab.guide.attrs.body': 'Every todo carries full metadata to track:',
  'todosTab.guide.attrs.item1': 'Quadrant (important × urgent), due date, optional category;',
  'todosTab.guide.attrs.item2': 'Status: pending / doing / done (completion time stamped) / blocked / cancelled;',
  'todosTab.guide.attrs.item3': 'List / board views: list tabs by track with status / quadrant filters; board shows a 2×2 quadrant grid; each item can be done / restored, inline-edited, deleted (with confirm).',
  'todosTab.guide.view.title': 'Smart view: only what needs attention',
  'todosTab.guide.view.body': 'By default only items needing attention are shown (overdue / due today / current project / important-urgent, max 8) to avoid noise:',
  'todosTab.guide.view.item1': 'Past daily todos are read on demand — open the "past" tab to query history;',
  'todosTab.guide.view.item2': 'Check "show expired" to reveal overdue leftovers (hidden by default).',
  'todosTab.guide.remind.title': 'Due reminders: the AI keeps watch for you',
  'todosTab.guide.remind.body': 'The AI checks todos at the end of every turn and reminds you of overdue / due items in its reply — you never have to keep track yourself.',
  'todo.track.life': 'Life',
  'todo.track.all': 'All',
  'todo.track': 'Track',
  'todo.track.work': 'Work',
  'todo.track.project': 'This project',
  'todo.track.daily': 'Today',
  'todo.track.past': 'Past',
  'todo.projectHint': 'No working directory for this session — project todos unavailable (life/work/today only).',
  'todo.help': 'Four tracks: Life=personal errands; Work=cross-project tasks; This project=the current working directory\\'s todos (invisible from other dirs); Today=today\\'s tasks (one file per day). Past daily todos (earlier days) are not loaded by default — open the “Past” tab or tick “Show expired” to query history (expired leftovers stay hidden until then). To add: type content, optionally pick a quadrant (important × urgent) and a due date, then hit Add — or just tell me “add a todo, it\\'s for work/life/this project/today” and I will file it in the right track.',
  'todo.showExpired': 'Show expired',
  'todo.pastHint': 'Past daily todos are mostly expired leftovers and are hidden by default; tick “Show expired” to view them.',
  'todo.addPlaceholder': 'Type a todo (multi-line ok), pick quadrant/due, add…',
  'todo.add': 'Add',
  'todo.added': 'Todo added',
  'todo.done': 'Done',
  'todo.undone': 'Restore',
  'todo.edit': 'Edit',
  'todo.save': 'Save',
  'todo.cancel': 'Cancel',
  'todo.updated': 'Updated',
  'todo.deleted': 'Deleted',
  'todo.deleteConfirm': 'Delete this todo? This cannot be undone.\n\n{snippet}',
  'todo.due': 'Due',
  'todo.overdue': 'Overdue',
  'todo.all': 'All',
  'todo.filterStatus': 'Status',
  'todo.filterQuadrant': 'Quadrant',
  'todo.status.active': 'Active',
  'todo.status.pending': 'Pending',
  'todo.status.doing': 'Doing',
  'todo.status.done': 'Done',
  'todo.status.blocked': 'Blocked',
  'todo.status.cancelled': 'Cancelled',
  'todo.quadrant': 'Quadrant',
  'todo.quadrant.none': 'Unclassified',
  'todo.quadrant.q1': 'Important & urgent',
  'todo.quadrant.q2': 'Important, not urgent',
  'todo.quadrant.q3': 'Urgent, not important',
  'todo.quadrant.q4': 'Neither',
  'todo.empty': '(No todos yet — add one)',
  'todo.view.mode': 'View',
  'todo.view.list': 'List',
  'todo.view.board': 'Board',
  'todo.board.empty': 'No todos in this quadrant',
  'todo.board.cycleStatus': 'Click to cycle status',
  'memoryTab.cwd': 'Session working directory',
  'memoryTab.loading': 'Loading…',
  'memoryTab.warning': 'These files are §-delimited structured memory. If you open them with a system tool, edit with caution — careless changes can break the format and corrupt memory reads.',
  'memoryTab.readonly': 'Read-only',
  'memoryTab.open': 'Open file',
  'memoryTab.opened': 'Opened with the system tool',
  'memoryTab.empty': '(missing or empty)',
  'memoryTab.noCwd': '(no working directory for this session — project memory unavailable)',
  'memoryTab.truncated': '(content truncated for display)',
  'memoryTab.pagePrev': 'Previous',
  'memoryTab.pageNext': 'Next',
  'memoryTab.pageInfo': 'Page {page}/{total} · {count} entries',
  'memoryTab.viewPretty': 'Pretty view',
  'memoryTab.viewRaw': 'Raw text',
  'memoryTab.searchPlaceholder': 'Search content, time or tag…',
  'memoryTab.noResults': 'No matching entries — try another keyword.',
  'memoryTab.projectTag': 'Project tag',
  'memoryTab.entryCount': '{count} entries',
  'memoryTab.keyAddHelp': 'Manually add a durable project fact (convention/decision/architecture/pitfall); it is written to KEY.md and injected into the context from the next turn on.',
  'memoryTab.keyAddPlaceholder': 'Type a key project fact, e.g. this project uses pnpm workspaces…',
  'memoryTab.keyAdd': 'Save',
  'memoryTab.keyAdded': 'Key fact saved — it will be injected from the next turn',
  'memoryTab.delete': 'Delete',
  'memoryTab.deleteConfirm': 'Delete this memory entry? This cannot be undone.\n\n{snippet}',
  'memoryTab.deleted': 'Entry deleted',
  'memoryTab.edit': 'Edit',
  'memoryTab.save': 'Save',
  'memoryTab.cancel': 'Cancel',
  'memoryTab.updated': 'Entry updated',
  'memoryTab.editHint': 'Content only: timestamps and branch tags are program-maintained and cannot be changed; the § delimiter cannot be typed.',
  'memoryTab.editConfirm': 'This entry is injected into the session context (the model\\'s prompt) right after saving. Save anyway?\n\n{snippet}',
  'memoryTab.archive': 'Archive',
  'memoryTab.archiveConfirm': 'Archive this entry? It leaves the main memory (no longer injected) and can be promoted back any time.\n\n{snippet}',
  'memoryTab.archived': 'Archived (no longer injected; can be promoted back)',
  'memoryTab.promote': 'Promote to memory',
  'memoryTab.promoted': 'Promoted back into the main memory',
  'memoryTab.keyScope': 'Branch scope',
  'memoryTab.keyScopeLabel': 'Branch',
  'memoryTab.keyScopeAll': 'All branches',
  'memoryTab.keyScopeAllHint': 'All branches = visible everywhere',
  'memoryTab.keyScopeAllWeight': '(checking it clears branch picks)',
  'memoryTab.keyScopeHint': 'Click to change the branch scope',
  'memoryTab.keyScopeSaved': 'Branch scope updated',
  'memoryTab.keyScopeSave': 'Save',
  'memoryTab.keyScopeCancel': 'Cancel',
  'memoryTab.keyBranchInfo': 'current branch: {branch} — only untagged entries or entries covering this branch are injected',
  'memoryTab.gitBranch': 'The git branch this record belongs to',
  'memoryTab.dshOnly': 'DSH-only',
  'memoryTab.dshOnlyHint': 'This entry is injected into DSH sessions only; external executors (COI tasks) skip it — for DSH-specific discipline/rules/architecture facts',
  'memoryTab.dshOnlyOn': 'DSH-only',
  'memoryTab.dshOnlyOff': 'Unmark DSH-only',
  'memoryTab.dshOnlySet': 'Marked DSH-only (skipped when injecting into external executors)',
  'memoryTab.dshOnlyRemoved': 'DSH-only mark removed (visible to external executors)',
  'memoryTab.dshOnlyToggleHint': 'Toggle the DSH-only mark: the entry reaches DSH sessions only, external executors (COI) skip it',
  'memoryTab.dshOnlyAdd': 'DSH-only (do not inject into external executors)',
  'memoryTab.desc.project': 'Project log: auto-recorded per turn; never injected, read on demand by the model.',
  'memoryTab.desc.key': 'Key project facts: conventions/decisions/pitfalls, injected into this project\\'s sessions; written when important, addable/deletable manually.',
  'memoryTab.desc.daily': 'Daily log: per-day progress records with program-tagged project labels; never injected, read on demand.',
  'memoryTab.desc.user': 'User profile: preferences and habits, injected into every session; writes need review + confirmation.',
  'memoryTab.desc.memory': 'Long-term memory: global environment/project facts, injected into every session; writes need review + confirmation.',
  'memoryTab.desc.archive-user': 'Archived user facts: not good enough for the main track, never injected; can be promoted back or deleted.',
  'memoryTab.desc.archive-memory': 'Archived memory facts: not good enough for the main track, never injected; can be promoted back or deleted.',
  'memoryTab.desc.archive-key': 'Archived key project facts: not good enough for the main track (or paused from injection), never injected; can be promoted back or deleted.',
  'memoryTab.desc.agents': 'Global rules: cross-session user rules (AGENTS.md), injected with the system prompt.',
  'panel.suggestions.title': 'Pending memory suggestions',
  'panel.suggestions.empty': 'No pending suggestions.',
  'panel.suggestions.help': 'Global-track suggestions produced by the background review: approve writes them into the memory files (injected with the snapshot); archive keeps them aside (never injected); reject drops them.',
  'panel.todoSuggestions.title': 'Pending todo suggestions',
  'panel.todoSuggestions.empty': 'No pending todo suggestions.',
  'panel.todoSuggestions.help': 'Todo suggestions from the background review: approve writes into the matching todo track (a todo stays a todo); archive keeps aside; reject drops.',
  'panel.guide.title': 'Guide',
  'panel.guide.intro': 'maestro-memory is a "memory & self-evolution" toolkit: it turns conversations into durable memory, todos and skills — the AI gets to know you better over time and never loses context across sessions. Here is what each module does and how to use it.',
  'panel.guide.memory.title': 'Memory read/write (memory tool)',
  'panel.guide.memory.desc': 'Five tracks: global memory, user profile, key project facts (auto-injected and git-branch aware — only facts relevant to the current branch reach the context), project log, daily log. How to use: just chat — the AI logs progress every turn; for important facts say "remember: the deploy port is 8080"; when resuming days later ask "check the memory" and it picks up seamlessly.',
  'panel.guide.review.title': 'Memory review (self-evolution)',
  'panel.guide.review.desc': 'Every N turns (10 by default, configurable) the AI reviews the conversation and distills what is worth remembering into suggestions for your confirmation — it never writes into the memory on its own. Just approve or reject in the Memory tab queue from time to time.',
  'panel.guide.todo.title': 'Todo management (dtodo)',
  'panel.guide.todo.desc': 'Say "remember / I need to do X" and it becomes a structured todo (auto-filed into life / work / project / daily, with important-urgent flags and due dates); the AI reminds you of due items at the end of its replies. AI-proposed todos land in a pending queue first. Manage everything in the Todos tab.',
  'panel.guide.skill.title': 'Skill accumulation (skill_manage)',
  'panel.guide.skill.desc': 'Methodologies learned the hard way can be solidified into skills; next time the same kind of task follows the process. Just say "save this process as a skill"; keep creation restrained and high-value. Browse, search and enable / disable skills in the Skills tab.',
  'panel.guide.search.title': 'Local file search (memory_evolve_search_local_files)',
  'panel.guide.search.desc': 'When the memory has no answer and you need local material, tell the AI "search the machine for XX" — by filename (documents only by default, all types on request); "which document mentioned XX" searches file content and returns hits with snippets. Four modes under "Config": filename + content / filename only / content only / off. Off by default — the tool is invisible to the model until enabled.',
  'panel.guide.coi.title': 'COI dispatch (de_coi)',
  'panel.guide.coi.desc': 'Dispatch tasks to external CLI agents (kimi / codex / grok / hermes…): unified scheduling without blocking, live progress, layered sessions with one-click resume, cross-COI chaining, results archived and distilled into memory. Say "dispatch XX to kimi / codex" or use the COI Dispatch tab. Off by default: enable "COI dispatch" under Config.',
  'panel.guide.prompt.title': 'Prompt manager',
  'panel.guide.prompt.desc': 'Turn recurring working patterns into prompt assets: pick one and inject — the model sees it next turn without interrupting the reply; supports one-shot, N turns, or every-M-turns reminders (numbers freely editable, auto-expiring by turn count), stoppable anytime; ad-hoc injection works without creating a prompt first. Off by default: enable "Prompt manager" under Config.',
  'panel.guide.models.title': 'Model settings (de_models)',
  'panel.guide.models.desc': 'The "Model settings" tab + de_models tool: a table of DSH providers and models with plugin-side per-model settings (enabled, note, thinking support, allowed / recommended reasoning levels incl. custom levels) — these settings only affect this plugin (de_models queries and tab display); DSH own model settings stay untouched. Off by default: enable "Model settings" under Config.',
  'panel.guide.advisor.title': 'Session review (Advisor)',
  'panel.guide.advisor.desc': `Attach an independent reviewer to every session — it only observes what you see in the UI (no thinking / tool calls), reviews each turn in real time and nudges you as "user instructions" when needed (info / nit / concern / blocker; info is record-only by default; in the chat flow these appear as collapsed [severity] lines so you can tell them apart). It works as a persistent session — full context, never truncated; the panel supports starting a fresh reviewer, asking it directly, and four levels of constraints (system prompt / project / session / reviewer-session, most-local wins). Off by default: open the master switch under Config, then enable per session in the floating panel; the reviewer model inherits the session model by default and can be set separately.`,
  'panel.guide.broadcast.title': 'Session broadcast (de_broadcast)',
  'panel.guide.broadcast.desc': 'Message passing between DSH sessions: copy your session ID (⧉ button in the session header), send it to another session and let its AI use de_broadcast send to reach you — the receiver snapshot gets a targeted unread notice (visible only to the receiver), the AI reads the full text via list / read, auto-deleted once everyone has read it; very long content is stored to a file. Rooms support multi-member collaboration across working directories; project groups reach a whole directory. Off by default: enable "Session broadcast" under Config.',
  'panel.guide.session.title': 'Session search (de_session_search)',
  'panel.guide.session.desc': 'Let the AI search the history of other AI tools (Codex currently) — "when did we do XX in Codex" just works: keyword hits with message snippets and context windows; scope by cwd, control scale with sort / limit / window; zero resident state — no index, no cache, read-only live scans. Off by default: enable "Session search" under Config.',
  'panel.guide.sessionOrch.title': 'Session orchestration (de_session)',
  'panel.guide.sessionOrch.desc': 'Let the AI create / wake DSH sessions programmatically — spawn builds a standard session (fully isomorphic to a manual one: system prompt / tools / memory snapshot / persistence, listed on the left and adoptable) that starts running immediately; wake resumes an existing session with a task (queued if busy); status / list report state. Discipline: the AI never bulk-wakes sessions — you stay in command. Off by default: enable "Session orchestration" under Config; pairs well with broadcast rooms.',
  'panel.guide.uiSettings.title': 'Web UI Settings',
  'panel.guide.uiSettings.desc': 'Style-level tweaks for the DSH web GUI (pure client-side injection): independent switches in the "Web UI Settings" tab "General" page — session filter (left list shows only active), wide conversation area, wide message bubbles, context-usage warning, Mermaid rendering. Off by default.',
  'panel.guide.canvas.title': 'Infinite canvas',
  'panel.guide.canvas.desc': 'Collect scattered files / images / audio onto one infinite canvas (the "Canvas" tab) — board by path / note / search (local path references, no copying), preview in-card, copy a reference string and give it to the AI to fetch by id; the AI can also drop notes via de_canvas (nothing is injected — it queries on demand). Off by default: enable "Infinite canvas" under Config.',
  'panel.guide.sync.title': 'Memory sync (cross-device)',
  'panel.guide.sync.desc': 'Keep project memory consistent across devices — share the same key facts / logs / archives / project todos between office and home machines. In the "Memory sync" tab enable "sync this project" and click start: by default it uses a dedicated branch of your code repo (zero config); or fill in a shared memory repo — one repo for all projects (global tracks too). Another machine recognizes the project automatically and pulls to continue. The module switch lives under Config; sync is always triggered by you, and projects with sync off are unaffected.',
  'panel.guide.confirm.title': 'The confirmation system (why the AI cannot write directly)',
  'panel.guide.confirm.desc': 'AI-proposed memory, todos and skills all enter a pending queue and take effect only after your confirmation. These writes genuinely change AI behavior: memory enters the context, todos are work assigned to you, skills alter the AI capability set — unchecked writes could canonize mistakes or assign you work unprompted. You are the final gate: the AI proposes, you decide.',
  'panel.guide.best.title': 'Tips for the best experience',
  'panel.guide.best.1': 'Session continuity: say "check the memory" and the AI picks up project conventions and progress from the logs — no need to repeat yourself.',
  'panel.guide.best.2': 'Capture on the fly: say "remember this / follow up on this" and the AI files it automatically; a word days later resumes the thread.',
  'panel.guide.best.3': 'Review periodically: glance at the memory / todo suggestion queues and approve or reject — that is the confirmation loop of memory evolution.',
  'panel.guide.best.4': 'Multi-device sync: work from office and home? Enable "Memory sync" and both machines share the same project memory — important conclusions never need repeating.',
  'panel.guide.loop': 'The loop: chat → record → review → distill → execute. This mechanism is the AI long-term working memory.',
  'panel.suggestions.approve': 'Approve',
  'panel.suggestions.archive': 'Archive',
  'panel.suggestions.archiveHint': 'Archive: kept out of the injected memory, can be promoted back later',
  'panel.suggestions.editHint': 'You may edit the text before approving; the edited text is what gets written.',
  'panel.suggestions.reject': 'Reject',
  'panel.suggestions.approveAll': 'Approve all',
  'panel.suggestions.rejectAll': 'Reject all',
  'panel.suggestions.hits': 'Suggested {count}×',
  'panel.suggestions.hitsHint': 'This fact resurfaced across several reviews — worth a careful look',
  'panel.suggestions.target.memory': 'Memory',
  'panel.suggestions.target.user': 'User profile',
  'panel.suggestions.target.key': 'Project key facts',
  'panel.suggestions.targetHint': 'Track to write on approve: defaults to the AI-recommended one; re-classify if it fits better (memory/user/key are injected into the prompt immediately)',
  'panel.suggestions.projectHint': 'This suggestion comes from the working directory: {path}',
  'panel.suggestions.done': 'Done: {text}',
  'panel.archive.title': 'Archived memory',
  'panel.archive.empty': 'No archived entries.',
  'panel.archive.help': 'Archived suggestions are never injected; they stay here for later — promote them back into the memory files when they matter, or delete them.',
  'panel.archive.promote': 'Promote to memory',
  'panel.archive.delete': 'Delete',
  'panel.archive.promoted': 'Promoted to memory',
  'panel.archive.deleted': 'Archived entry deleted',
  'panel.skills.title': 'Pending skill suggestions',
  'panel.skills.help': 'New skills produced by background review; approving moves them into the skill library (~/.agents/skills) where they are injected into system prompts.',
  'panel.skills.empty': 'No pending skill suggestions.',
  'panel.skills.pending': 'Pending',
  'panel.skills.approve': 'Approve',
  'panel.skills.reject': 'Reject',
  'panel.skills.done': 'Skill {op}',
  'panel.config.title': 'Config',
  'panel.config.help': 'Changes apply immediately and persist (overriding the config.yaml entries).',
  'panel.config.reviewEnabled': 'Background review',
  'panel.config.reviewEnabled.hint': 'Automatically review sessions and harvest experience; when off, the memory/skill tools and the snapshot still work — only the automatic review stops',
  'panel.config.reviewInterval': 'Review interval (turns)',
  'panel.config.reviewInterval.hint': 'One automatic review per N user turns',
  'panel.config.skillReviewEnabled': 'Skill auto-harvest',
  'panel.config.skillReviewEnabled.hint': 'Off (default): new skills from review go to the pending queue and only install when approved; On: review creates skills directly without confirmation (skills are injected into every session — enable with care)',
  'panel.config.perTurnProjectWrites': 'Per-turn project writes',
  'panel.config.perTurnProjectWrites.hint': 'Require the model to check at the end of every turn and record project-related facts (decisions/progress/pitfalls); when off, project memory is read on demand only. ⚠️ Relies on LLM instruction following — weaker models may not comply',
  'panel.config.perTurnDailyWrites': 'Per-turn daily writes',
  'panel.config.perTurnDailyWrites.hint': 'Require the model to check at the end of every turn and record the day\\'s progress; when off, the daily log is read on demand only. ⚠️ Relies on LLM instruction following — weaker models may not comply',
  'panel.config.perTurnKeyWrites': 'Per-turn key-fact check',
  'panel.config.perTurnKeyWrites.hint': 'Require the model to judge at the end of every turn whether an important project fact emerged (long-lived convention/decision/architecture/pitfall); if so, write it to target=key (injected into the context), otherwise skip. When off, key facts are only added manually or read. ⚠️ Relies on LLM instruction following',
  'panel.config.keyProgressiveDisclosure': 'Key-track progressive disclosure',
  'panel.config.keyProgressiveDisclosure.hint': 'Control how key-track memories are injected: auto = full injection for small data, summary injection for large data; off = always full injection (default); on = always summary injection (saves tokens)',
  'panel.config.keyProgressiveDisclosure.auto': 'Auto',
  'panel.config.keyProgressiveDisclosure.off': 'Off (always full, default)',
  'panel.config.keyProgressiveDisclosure.on': 'On (always summary)',
  'panel.config.keyFullInjectThreshold': 'Full-injection entry-count threshold',
  'panel.config.keyFullInjectThreshold.hint': 'In auto mode, full injection when entry count ≤ this value (default 3)',
  'panel.config.keyFullInjectCharLimit': 'Full-injection character limit',
  'panel.config.keyFullInjectCharLimit.hint': 'In auto mode, full injection when total characters ≤ this value (default 1500)',
  'panel.config.coiEnabled': 'COI dispatch',
  'panel.config.coiEnabled.hint': 'Enable the de_coi_* tools and the CLI Dispatch tab: unified dispatch of CLI agents (kimi/codex/grok/hermes…). Off by default — this plugin\\'s core is memory/todos/skills, dispatch is an on-demand add-on; when off, the tools and the tab are completely invisible',
  'panel.config.searchDocsEnabled': 'Local file search tool',
  'panel.config.searchDocsEnabled.hint': 'Lets the model search files across all local disks/directories. **Four modes**: all = name + content search; filename only = content/contentQuery parameters are ignored (never reads file contents — for people who use their own content-search implementation); content only = every call does content matching (query acts as the content keyword); off = the tool is completely invisible to the model. Content search: contentQuery="keyword" answers "which document mentions XX" (rg full-text match, returns hit snippets). Off by default',
  'panel.config.searchDocsMode.all': 'All (name + content)',
  'panel.config.searchDocsMode.filename': 'Filename only',
  'panel.config.searchDocsMode.content': 'Content only',
  'panel.config.searchDocsMode.off': 'Off (tool invisible)',
  'panel.config.advisorEnabled': 'Session review (Advisor)',
  'panel.config.advisorEnabled.hint': 'Master switch for the session-review module. With the switch on, every session still starts OFF — enable reviewing per session from the panel\\'s session switch (reviews consume extra model calls, turn them on only where needed; enabled sessions keep their choice across refreshes/restarts). With the switch off, reviewing stops and all review UI (header toggle / floating panel) is hidden; turn it back on to restore the module instantly',
  'panel.config.broadcastEnabled': 'Session broadcast',
  'panel.config.broadcastEnabled.hint': 'Enable session broadcast (de_broadcast): inter-session messaging — the "Session broadcast" unread hint in the snapshot (inbox-style rows: id+subject+sender+time) + the de_broadcast tool (send/list/read; read consumes and auto-deletes once all recipients read; >8KB spills to a file; 30-day cleanup) + the broadcast management panel tab. **Independent of COI dispatch** (off by default, can be enabled alone); when off, all of the above are invisible; the persistent "Your session ID" snapshot section is unaffected; the header "⧉ Copy session ID" / "✎ alias" buttons belong to "Session orchestration" (the panel top also has a copy entry)',
  'panel.config.notifyEnabled': 'Notifications',
  'panel.config.notifyEnabled.hint': 'Enable the notification module (de_notify): the AI proactively notifies you when a task is done — the de_notify manual tool (send anytime, no frequency limit; channels include feishu/qq/weixin/wecom/web) + automatic COI completion notify (pick channels via coiNotifyChannels). The web channel delivers to an in-app notification bell at the top-right: persisted + unread badge + a popover showing "which session sent what" + click to jump to that session. Independent module, off by default; IM channels require the matching channel plugin (dsh-feishu etc., missing ones reported honestly), the web channel is built in with zero deps; when off, the tool is not registered, the bell disappears, and COI auto-notify silently skips',
  'notify.title': 'Notifications',
  'notify.bellAria': 'In-app notifications',
  'notify.empty': 'No unread notifications',
  'notify.loading': 'Loading…',
  'notify.readAll': 'Mark all read',
  'notify.system': 'System',
  'notify.jump': 'Jump to session',
  'notify.delete': 'Delete',
  'notify.viewDetail': 'View details',
  'notify.close': 'Close',
  'notify.markRead': 'Mark read',
  'panel.config.syncEnabled': 'Memory sync',
  'panel.config.syncEnabled.hint': '**Module switch**: enables the Memory Sync module — the Memory Sync tab appears in conversations and /memory_sync works. **Note: this does NOT start syncing any project** — each project is opted in separately via the "Sync this project" switch in the Memory Sync tab (off by default; never-opted-in projects keep their pure-local state: no Git repo, no entry IDs). Sync moves project memory (KEY + project log + archive + project todos) over Git to one memory remote — leave the URL empty to use your main code repo by default (dedicated branch, zero config); paste a shared memory repo URL to use one private repo for all projects (global memory, phase 2, can only sync through it). Push always requires your explicit trigger',
  'panel.config.sessionSearchEnabled': 'Session search',
  'panel.config.sessionSearchEnabled.hint': 'Enable de_session_search: lets the model search historical sessions of other local AI tools (Codex for now: plain JSONL under ~/.codex/sessions and archived_sessions — rg prefilter keeps it millisecond-fast; DSH sessions not supported yet). Case-insensitive literal matching over user/assistant messages only; supports cwd project filter, relevance/newest/oldest sorting, and limit/window result control. **Independent submodule** (off by default, can be enabled alone — unrelated to COI dispatch/broadcast); zero resident state: no index, no cache, every call scans read-only in real time and never modifies session files; when off the tool is completely invisible to the model',
  'panel.config.canvasEnabled': 'Infinite canvas',
  'panel.config.canvasEnabled.hint': '**Module switch**: enables the Infinite Canvas — a Canvas tab in conversations + the de_canvas tool (the model can list the board, read nodes by id, and drop notes into the board\\'s center zone). Local path references, single-board with perspective filters (session/project/global + ownership badges), pull-based AI access (board content is never injected into context; query it on demand). **Independent submodule** (off by default): stored at <memoryDir>/canvas/boards.json (whole-board atomic writes + rev optimistic lock to prevent cross-session overwrites); when off the tab and tool are completely invisible, data files are kept',
  'panel.config.sessionEnabled': 'Session orchestration',
  'panel.config.sessionEnabled.hint': 'Enable session orchestration (de_session): lets AI **programmatically create/wake DSH sessions** — spawn creates a standard session (identical to one opened manually: system prompt/tools/memory snapshot/persistence, appears in the left session list and can be taken over), prompt = the full instruction text (role/task freely composed), it starts running immediately; optional cwd / join a broadcast room / model override; wake wakes an existing session (equivalent to sending a message on its behalf — its AI wakes up and processes it, auto-resumed after process restart); status/list inspect state; the header **"⧉ Copy session ID" / "✎ alias" buttons follow this switch** (session-identity features, previously mis-housed under broadcast). **Independent submodule** (off by default; depends on the DSH agents service, only same-process sessions can be woken; when off the tool is invisible to the model)',
  'panel.config.promptsEnabled': 'Prompt manager',
  'panel.config.promptsEnabled.hint': 'Enable the Prompts tab: a prompt library (user-written paradigms + built-in examples) plus an injection track (once / N consecutive turns / every M turns — count and cadence accept any integers; injected content is visible to the model next turn, expires automatically by turn counting, and can be stopped anytime; quick inject works without saving a prompt first, auto-saved to the Temp category). Off by default; when off the snapshot section, event listener and API are fully uninstalled and the tab hides after refresh',
  'panel.config.modelsEnabled': 'Model Settings',
  'panel.config.modelsEnabled.hint': 'Enable the "Model Settings" tab + de_models tool: a table of DSH providers/models with per-model settings (enabled, note, thinking support, allowed/recommended reasoning levels, custom levels); de_models lets the AI query the available model list. **Off by default** (registering takes a slot in the model tool list; turn it on when needed). ⚠️ These settings **only affect this plugin and never modify or affect DSH\\'s own model settings** (DSH side stays as the official "Settings → Models" says). When off the tab and tool hide and the API refuses access, settings data is kept',
  'panel.config.uiSettingsEnabled': 'Web UI Settings',
  'panel.config.uiSettingsEnabled.hint': 'Enable the "Web UI Settings" module: a filter bar appears above the left session list, showing only active sessions by default (generating / awaiting approval / awaiting answer / subagents running / error / finished-but-unviewed — purely idle ones collapse away), one click switches back to all; pure client-side styling (CSS + DOM injection, no DSH framework changes); the filter preference is remembered in the browser. **Off by default**; when off, the filter bar and injected styles are fully removed',
  'panel.config.save': 'Save config',
  'panel.reveal.title': 'Open files',
  'panel.reveal.help': 'Open the memory directories and files with your system tools. ⚠️ Careless edits can break the §-delimited format and corrupt memory reads — edit with caution.',
  'panel.reveal.memoryDir': 'Memory dir',
  'panel.reveal.memoryFile': 'Global memory',
  'panel.reveal.userFile': 'User profile',
  'panel.reveal.archiveMemoryFile': 'Archived memory',
  'panel.reveal.archiveUserFile': 'Archived user',
  'panel.reveal.dailyDir': 'Daily log dir',
  'panel.reveal.dailyFile': 'Today log',
  'panel.reveal.projectsDir': 'Project memory dir',
  'panel.reveal.skillDir': 'Skills dir',
  'panel.reveal.agentsFile': 'Global rules (AGENTS.md)',
  'panel.config.saved': 'Config saved. Refresh the page for newly enabled/disabled modules to take effect',
  'panel.config.failed': 'Failed: {message}',
  'panel.loading': 'Loading…',
}

/** English dictionary (alias of zh — both are now English). */
export const en: Record<MemoryEvolveKey, string> = {
  'tab.label': 'Skill Manager',
  'tab.label.alt': 'Skill Manager',
  'header.title': 'Skill Manager',
  'header.subtitle': 'Manage every skill · custom dirs · enable/disable · view & edit',
  'search.placeholder': 'Search skills by name, description, or when-to-use…',
  'search.empty': 'No matching skills',
  'filter.all': 'All',
  'status.enabled': 'Enabled',
  'disable': 'Disable',
  'enable': 'Enable',
  'disabled.badge': 'Disabled',
  'disabled.hint': 'Disabled: excluded from the model skill catalog',
  'protected.badge': 'System',
  'protected.hint': 'System skill (project source) — cannot be disabled',
  'toggle.failed': 'Toggle failed: {message}',
  'manage.dirs': 'Manage custom skill directories',
  'dirs.title': 'Custom Skill Directories',
  'dirs.help': 'Add directories containing skills (<dir>/<skill>/SKILL.md or <dir>/<skill>.md layouts). Directories persist in the plugin state.json and reload automatically after restart; paths overlapping an existing skill root are rejected.',
  'dirs.placeholder': 'Absolute path, e.g. ~/.hermes/skills/…',
  'dirs.add': 'Add',
  'dirs.remove': 'Remove',
  'dirs.empty': 'No custom directories yet',
  'dirs.missing': 'Directory missing',
  'pager.prev': 'Prev',
  'pager.next': 'Next',
  'pager.page': 'Page {page} / {total}',
  'skills.count': '{count} skills',
  'roots.count': '{count} roots',
  'pane.skills': 'Skills',
  'pane.files': 'Files',
  'pane.editor': 'Editor',
  'no.skill.selected': 'Select a skill on the left to start browsing',
  'no.root': 'This skill has no browsable local directory',
  'no.entries': 'Empty directory',
  'no.file': 'Select a text file to view or edit',
  'not.text': 'Not a text file — cannot preview',
  'too.large': 'File exceeds the 512 KiB read cap',
  'read.failed': 'Read failed: {message}',
  'write.failed': 'Save failed: {message}',
  'save': 'Save',
  'saving': 'Saving…',
  'saved': 'Saved',
  'edit': 'Edit',
  'cancel': 'Cancel',
  'discard': 'Discard',
  'dirty.hint': 'Unsaved changes',
  'readonly': 'Read-only',
  'bytes': '{size} B',
  'kib': '{size} KiB',
  'mib': '{size} MiB',
  'dir.up': 'Parent directory',
  'open.folder': 'Open directory',
  'source.badge': '{source}',
  'invocable': 'Invocable',
  'when.to.use': 'When to use',
  'description': 'Description',
  'resource.directory': 'Directory',
  'resource.url': 'Link',
  'resource.opaque': 'Resource',
  'refresh': 'Refresh',
  'loading.skills': 'Loading skills…',
  'loading.dir': 'Loading…',
  'tree.collapse': 'Collapse',
  'tree.expand': 'Expand',
  'path': 'Path',
  'root.label': 'Root',
  'editor.placeholder': 'Select a text file in the tree on the left to start editing.',
  'status.ready': 'Ready',
  'status.skill': 'Skill',
  'status.file': 'File',
  'status.unsaved': 'Unsaved',
  'status.saved': 'Saved',
  'confirm.discard.title': 'Discard unsaved changes?',
  'confirm.discard.body': 'Your changes to {name} are not saved. Switching files will lose them.',
  'confirm.discard.ok': 'Discard changes',
  'mtime.label': 'Modified {time}',
  'open.in.new.tab': 'Open in new tab',
  'preview': 'Preview',
  'memoryTab.label': 'Memory',
  'memoryTab.label.pending': '🔴 Memory ({count})',
  'skillsTab.label': 'Skills',
  'skillsTab.label.pending': '🔴 Skills ({count})',
  'todosTab.label': 'Todos',
  'todosTab.label.pending': '🔴 Todos ({count})',
  'coiTab.label': 'COI Dispatch',
  'coiTab.label.pending': '🔴 COI Dispatch ({count})',
  'broadcastTab.label': 'Broadcast',
  'broadcast.tab.guide': 'Guide',
  'broadcast.tab.messages': 'Messages',
  'broadcast.tab.rooms': 'Rooms',
  'broadcast.tab.settings': 'Settings',
  'broadcast.settings.wsCoord.title': 'Workspace coordination (ws-coord)',
  'broadcast.settings.wsCoord.desc': 'Resource-occupancy coordination for parallel sessions in one workspace — declare files you will modify (de_ws_declare), auto-register writes, write-conflict detection (soft warning / hard block switchable), and de_ws_status to see "who is running and what they are doing". These switches only control this sub-feature; the "Session broadcast" master switch lives under Memory Evolve Settings → Config.',
  'broadcast.settings.wsCoord.enabled': 'Enable workspace coordination',
  'broadcast.settings.wsCoord.enabled.hint': 'Registers de_ws_declare / de_ws_status / de_ws_release tools + write-conflict detection listeners + the activity snapshot section. Depends on the "Session broadcast" master switch (unavailable while broadcast is off). Off by default',
  'broadcast.settings.wsCoord.snapshot': 'Activity snapshot section',
  'broadcast.settings.wsCoord.snapshot.hint': 'When ≥2 sessions are active in the workspace, inject one 【Workspace activity】 line into the per-turn snapshot (with the current time and what each session is doing); zero cost with 0-1 active sessions',
  'broadcast.settings.wsCoord.enforce': 'Hard-block mode',
  'broadcast.settings.wsCoord.enforce.hint': 'Off by default (soft mode: trust the AI — conflicts warn but never block); when on, writes to files occupied by other sessions are denied at the tool layer (deny), and the AI sees the reason and adjusts on its own',
  'broadcast.guide.intro.title': 'What is Session Broadcast',
  'broadcast.guide.intro.body': 'Session broadcast = a message channel between DSH sessions: send messages to other sessions (the AI sends them via the de_broadcast send tool) and the receiver sees a "Session broadcast" notice in its next snapshot. Messages are managed like an inbox — subject + summary, auto-deleted once every recipient has read them.',
  'broadcast.guide.send.title': 'How to send',
  'broadcast.guide.send.body': 'Just tell the AI "broadcast to session XX…" (default is one-to-one; the recipient is the other session ID):',
  'broadcast.guide.send.item1': 'One-to-one: give the recipient session ID (send them your "copy session ID" result and their AI can reply to you);',
  'broadcast.guide.send.item2': 'Rooms: multi-member chat rooms that work across working directories — everyone in the room sees the message (send to room:<room-id>);',
  'broadcast.guide.send.item3': 'Project: visible to every session under that working directory (send to project:/absolute-path).',
  'broadcast.guide.inbox.title': 'Inbox (Messages tab)',
  'broadcast.guide.inbox.body': 'The list shows only unread non-room messages by default (read ones are hidden; room messages live inside the room):',
  'broadcast.guide.inbox.item1': 'Filter: unread / all / read; search subject, sender, content; paged 20 per page;',
  'broadcast.guide.inbox.item2': 'Click "expand" for the full text; the red "delete" is an admin delete (hidden from everyone);',
  'broadcast.guide.inbox.item3': 'One-to-one messages are auto-deleted once every recipient has read them (consumed, out of the list).',
  'broadcast.guide.room.title': 'Rooms tab: multi-member chat rooms',
  'broadcast.guide.room.body': 'Rooms = multi-member collaboration chat rooms:',
  'broadcast.guide.room.item1': 'Expand a room to see member presence: 🟢 running = generating right now (you can wait; it sees messages within its turn), ⚪ idle / unknown = turn over or unknown (do not just wait);',
  'broadcast.guide.room.item2': 'Room messages share the inbox filters / search / paging; the creator can kick members and dissolve the room (system notices are sent);',
  'broadcast.guide.room.item3': 'Dissolved rooms keep their records for traceability; members can no longer join or post.',
  'broadcast.guide.alias.title': 'Session aliases: recognize a session at a glance',
  'broadcast.guide.alias.body': 'Give a session a friendly name (≤10 chars) — shown in snapshots, lists and messages as an alias (short ID):',
  'broadcast.guide.alias.item1': 'The "My session" row on top: copy session ID / copy alias, then send it to the other side to start chatting;',
  'broadcast.guide.alias.item2': 'The ⧉ copy-session-ID / ✎ alias buttons at the top right of a session also work.',
  'broadcast.guide.switch.title': 'Switch',
  'broadcast.guide.switch.body': 'Session broadcast is off by default: enable "Session broadcast" under "Config" in the "Memory Evolve Settings" tab, then refresh to reveal this tab.',
  'broadcast.guide.wscoord.title': 'Workspace coordination: parallel work without collisions',
  'broadcast.guide.wscoord.body': 'When several sessions edit the same project in parallel, use the workspace coordination in the "Settings" page to avoid overwriting each other:',
  'broadcast.guide.wscoord.item1': 'Before starting, have the AI "declare which files you will change" (de_ws_declare) — others (and their AIs) can see who is editing what;',
  'broadcast.guide.wscoord.item2': 'Write-time conflict detection: soft mode warns first (default); hard mode can be enabled — writes into files claimed by others are rejected outright;',
  'broadcast.guide.wscoord.item3': 'The "activity" overview (de_ws_status) shows who is running and what they are doing; the switch lives in the Settings page (requires the Session broadcast master switch).',
  'broadcast.mySessionId': 'My session ID',
  'broadcast.copyId': 'Copy',
  'broadcast.copied': 'Copied',
  'broadcast.loading': 'Loading…',
  'broadcast.refresh': 'Refresh',
  'broadcast.messages.empty': '(no messages)',
  'broadcast.messages.sender': 'From',
  'broadcast.messages.to': 'To',
  'broadcast.messages.direct': 'direct',
  'broadcast.messages.room': 'room',
  'broadcast.messages.project': 'project',
  'broadcast.messages.unread': 'unread',
  'broadcast.messages.long': 'long',
  'broadcast.message.expand': 'Expand',
  'broadcast.message.collapse': 'Collapse',
  'broadcast.message.delete': 'Delete',
  'broadcast.message.deleteConfirm': 'Delete this message? (admin action, invisible to everyone)\n\n{subject}',
  'broadcast.message.deleted': 'Deleted',
  'broadcast.copyAlias': 'Copy alias',
  'broadcast.msg.unread': 'unread',
  'broadcast.msg.read': 'read',
  'broadcast.filter.unread': 'Unread',
  'broadcast.filter.all': 'All',
  'broadcast.filter.read': 'Read',
  'broadcast.searchPh': 'Search subject/sender/content…',
  'broadcast.pagePrev': 'Prev',
  'broadcast.pageNext': 'Next',
  'broadcast.pageInfo': 'Page {page}/{total}',
  'broadcast.room.detail': 'Details',
  'broadcast.room.messages': 'Room messages',
  'broadcast.room.messages.empty': '(no room messages)',
  'broadcast.messages.roomInRooms': 'Room messages live inside their room — open it from the Rooms view',
  'broadcast.rooms.empty': '(no rooms)',
  'broadcast.roomSearchPh': 'Search room name…',
  'broadcast.roomStatus.all': 'All',
  'broadcast.roomStatus.active': 'Active',
  'broadcast.roomStatus.dissolved': 'Dissolved',
  'broadcast.roomDays.0': 'Any time',
  'broadcast.roomDays.7': 'Last 7 days',
  'broadcast.roomDays.30': 'Last 30 days',
  'broadcast.room.status.active': 'active',
  'broadcast.room.status.idle': 'idle',
  'broadcast.room.status.dissolved': 'dissolved',
  'broadcast.room.online': '{online}/{total} online',
  'broadcast.room.members': 'Members',
  'broadcast.room.kick': 'Kick',
  'broadcast.room.kickConfirm': 'Kick member {member}? (a system notice is sent; the session loses room access)',
  'broadcast.room.dissolve': 'Dissolve',
  'broadcast.room.dissolveConfirm': 'Dissolve room "{name}"? (soft delete: record kept for traceability, members get a system notice, no further joins/messages)',
  'broadcast.room.dissolved': 'dissolved',
  'broadcast.room.copyId': 'Copy room id',
  'broadcast.room.lastActive': 'Last active',
  'broadcast.room.created': 'Created',
  'broadcast.room.presence.unknown': 'unknown · no activity recorded',
  'header.copySessionId': '⧉ Copy session ID',
  'header.copySessionId.done': '✓ Copied',
  'header.copySessionId.title': 'Copy this session\'s ID (send it to another session: tell its AI your session ID so it can broadcast to you via de_broadcast)',
  'header.setAlias': '✎ Alias',
  'header.setAlias.title': 'Set a session alias (≤10 chars) — shown as your friendly name in the snapshot / broadcast panel / messages',
  'header.setAlias.placeholder': 'alias (≤10 chars)',
  'header.setAlias.save': 'Save',
  'header.setAlias.clear': 'Clear',
  'header.setAlias.saved': 'Alias saved',
  'header.setAlias.cleared': 'Alias cleared',
  'advisor.header.toggle': 'Session Review',
  'advisor.header.toggle.title': 'Open or collapse the Advisor review panel',
  'promptTab.label': 'Prompts',
  'promptTab.label.active': '🔴 Prompts ({count})',
  'settingsTab.label': 'Memory Evolve Settings',
  'settingsTab.label.pending': '🔴 Memory Evolve Settings',
  'settingsTab.feature.guide': 'Guide',
  'settingsTab.feature.config': 'Config',
  'settingsTab.feature.version': 'Version',
  // —— version check & update (phase 1) ——
  'version.current': 'Current version',
  'version.latest': 'Latest version',
  'version.statusLabel': 'Status',
  'version.status.latest': 'Up to date',
  'version.status.outdated': 'Update available',
  'version.status.no-release': 'No releases yet',
  'version.status.unsupported': 'Auto-check unsupported',
  'version.status.unknown': 'Unknown',
  'version.loading': 'Checking…',
  'version.lastError': 'Last check failed',
  'version.checkTime': 'Last checked',
  'version.checking': 'Checking…',
  'version.checkNow': 'Check for updates',
  'version.updating': 'Updating…',
  'version.updateNow': 'Update to {tag}',
  'version.restart.title': 'Restart required',
  'version.restart.hint': 'New code is on disk. Restart dsh web first, then refresh the browser (a page refresh alone will not load the new code).',
  'version.releaseNotes': 'Release notes',
  'version.unsupported.hint': 'Auto-check requires a git clone install. Reinstall with `git clone git@github.com:csyangwen/maestro-memory.git` to enable it.',
  // status note codes (server sends codes only; text lives here).
  'version.note.no-release': 'No release tags (v0.x.y) on the remote yet.',
  'version.note.outdated': 'A new version is available — update below (restart dsh web afterwards).',
  'version.note.latest-exact': 'You are on the latest release.',
  'version.note.latest-contained': 'Your checkout already contains the latest release (dev-track ahead or synced).',
  'version.note.unsupported': 'Plugin dir is not a git repository or git is unavailable.',
  // error codes (P1-5 / P2-4: dictionary-mapped errors).
  'version.error.bad-request': 'Bad request: {message}',
  'version.error.dirty': 'Update rejected: {message}',
  'version.error.busy': 'Update rejected: {message}',
  'version.error.target-changed': 'Target version changed: {message}',
  'version.error.untrusted': 'Update rejected: {message}',
  'version.error.unsupported': 'Auto-check unsupported: {message}',
  'version.error.error': 'Update failed: {message}',
  'version.error.network': 'Network request failed: {message}',
  'version.error.unknown': 'Unknown error',
  'memoryTab.feature.guide': 'Guide',
  'memoryTab.feature.suggestions': 'Memory suggestions',
  'skillsTab.feature.guide': 'Guide',
  'skillsTab.feature.skills': 'Skill suggestions',
  'skillsTab.feature.skillBrowser': 'Skill manager',
  'todosTab.feature.guide': 'Guide',
  'todosTab.feature.todoSuggestions': 'Todo suggestions',
  'todosTab.feature.todo': 'Todos',
  'modelsTab.label': 'Model Settings',
  'modelsTab.feature.models': 'Model Settings',
  'modelsTab.feature.guide': 'Guide',
  'modelsTab.guide.what.title': 'What is Model Settings',
  'modelsTab.guide.what.body': 'A table view of every DSH provider and model, with per-model plugin-side settings (enabled state, note, reasoning levels). All settings belong to this plugin (models.json) — DSH configuration is never touched and nothing couples to other plugins:',
  'modelsTab.guide.what.item1': 'Columns: enabled switch, provider (with DSH activation state), model (name + ID), context / output capacity, reasoning levels, image-input marker (🖼), note; search and a "show reasoning levels" toggle;',
  'modelsTab.guide.what.item2': 'Per model: enable / disable (a plugin-side availability flag — DSH routing is untouched), note, thinking support, allowed reasoning levels, recommended level, custom levels;',
  'modelsTab.guide.what.item3': 'Settings persist immediately (<memoryDir>/models.json) across restarts.',
  'modelsTab.guide.config.title': 'Per-model settings',
  'modelsTab.guide.config.body': 'Expand a row ("configure levels") to edit reasoning settings:',
  'modelsTab.guide.config.item1': 'Enable / disable: decides which models the de_models tool lists by default (all enabled by default);',
  'modelsTab.guide.config.item2': 'Thinking support: when off the model cannot reason (only the off level remains);',
  'modelsTab.guide.config.item3': 'Recommended level: "auto" follows the model own recommendation by default; you can pin any available level;',
  'modelsTab.guide.config.item4': 'Allowed levels: tick which levels may be used (all by default); custom levels (e.g. ultra) can be added / removed;',
  'modelsTab.guide.config.item5': 'Image input: models explicitly declaring image support show the "🖼 image input" marker (from DSH model capability metadata, read-only); undeclared = unknown, no marker.',
  'modelsTab.guide.tool.title': 'de_models tool (for the AI)',
  'modelsTab.guide.tool.body': 'This module also registers the de_models tool so the AI can query the available model (endpoint) list:',
  'modelsTab.guide.tool.item1': 'Only "enabled" models are returned by default (all=true shows everything incl. disabled), filterable by provider;',
  'modelsTab.guide.tool.item2': 'Each model reports: enabled, DSH-activated, image input support (supportsImage: true / false / null=unknown), thinking support, allowed reasoning levels (incl. recommended and custom), note.',
  'modelsTab.guide.switch.title': 'Switch',
  'modelsTab.guide.switch.body': 'Model Settings are on by default; they can be turned off independently under "Config" in the "Memory Evolve Settings" tab like other modules — the tab and the de_models tool hide, settings data is kept.',
  'modelsTab.searchPh': 'Search provider, model, or note…',
  'modelsTab.showReasoning': 'Show reasoning levels',
  'modelsTab.refresh': 'Refresh',
  'modelsTab.loading': 'Loading…',
  'modelsTab.count': '{total} models · {enabled} enabled',
  'modelsTab.loadFailed': 'Load failed: {message}',
  'modelsTab.empty': '(No models)',
  'modelsTab.enabled': 'Enabled',
  'modelsTab.enable': 'Enable',
  'modelsTab.disable': 'Disable',
  'modelsTab.provider': 'Provider',
  'modelsTab.model': 'Model',
  'modelsTab.capacity': 'Context/Output',
  'modelsTab.reasoning': 'Reasoning',
  'modelsTab.note': 'Note',
  'modelsTab.notePh': 'Add a note…',
  'modelsTab.dormant': 'Inactive',
  'modelsTab.thinking': 'Support thinking',
  'modelsTab.thinkingHint': 'When off, this model cannot reason (only the off level stays available)',
  'modelsTab.thinkingOff': 'Thinking off',
  'modelsTab.supportsImage': '🖼 Image input',
  'modelsTab.supportsImageHint': 'This model explicitly declares image input support (from DSH model capability metadata inputModalities)',
  'modelsTab.recommendedLevel': 'Recommended level',
  'modelsTab.recommendedAuto': 'Auto (follow model recommendation)',
  'modelsTab.levelsNone': 'All disabled',
  'modelsTab.editLevels': 'Configure levels',
  'modelsTab.closeEditor': 'Collapse',
  'modelsTab.editorTitle': 'Available reasoning levels (check = allowed; recommended comes from the model)',
  'modelsTab.recommended': 'Recommended',
  'modelsTab.addLevel': 'Add',
  'modelsTab.removeLevel': 'Remove',
  'modelsTab.levelIdPh': 'Level ID (e.g. ultra)',
  'modelsTab.levelNamePh': 'Display name (e.g. Ultra)',
  'modelsTab.save': 'Save',
  'modelsTab.saving': 'Saving…',
  'modelsTab.cancel': 'Cancel',
  // DSH UI Settings tab (ui-settings-hub): module intro (guide sub-tab) +
  // future extension seat (themes etc.). The real feature (session filter)
  // is a global DOM enhancement independent of this tab; the feature
  // switches (uiSettings.feature.*) are consumed by the "General" sub-tab
  // and broadcast via event for apply() to sync DOM injection.
  'uiSettingsTab.label': 'Web UI Settings',
  'uiSettingsTab.feature.mixed': 'General',
  'uiSettingsTab.feature.guide': 'Guide',
  'uiSettingsTab.features.title': 'Feature switches',
  'uiSettingsTab.features.help': 'Every feature has its own small switch, **all off by default** — you turn them on deliberately; changes apply immediately (features stay under "General" until they mature and get their own categories).',
  'uiSettingsTab.guide.what.title': 'What is Web UI Settings',
  'uiSettingsTab.guide.what.body': 'Style-level tweaks for the DSH web GUI — no framework source changes, pure client-side injection (CSS + DOM enhancement) that survives DSH updates; future extensions (themes etc.) all land in this module.',
  'uiSettingsTab.guide.switch.title': 'Switches',
  'uiSettingsTab.guide.switch.body': 'The module switch lives under "Config" in the "Memory Evolve Settings" tab (off by default); the per-feature switches live in the "General" sub-tab — also all off by default, turned on deliberately.',
  'uiSettingsTab.guide.features.title': 'Features',
  'uiSettingsTab.guide.features.body': 'Each feature has an independent switch in the "General" page; it takes effect immediately:',
  'uiSettingsTab.guide.features.item1': 'Session filter: the left session list shows only active sessions; purely idle ones collapse, one click switches back to all;',
  'uiSettingsTab.guide.features.item2': 'Wide conversation: the middle transcript area widens from about half to about 95%, more comfortable for long messages;',
  'uiSettingsTab.guide.features.item3': 'Wide bubbles: the user message bubble grows from its 525px cap to about 80% width (pairs best with the wide conversation);',
  'uiSettingsTab.guide.features.item4': 'Context warning: the context ring turns yellow above 30% and red above 40% — a nudge to bookmark or start a fresh session;',
  'uiSettingsTab.guide.features.item5': 'Mermaid rendering: mermaid code blocks in messages render into diagrams; on failure they fall back to plain code blocks.',
  // Feature-switch row labels (rendered by the "General" sub-tab).
  'uiSettings.feature.sessionFilter': 'Session filter',
  'uiSettings.feature.sessionFilter.hint': 'The left session list shows only active sessions (purely idle ones collapse; one click switches back to all); the filter bar appears only while this is on',
  'uiSettings.feature.wideChat': 'Wide conversation area',
  'uiSettings.feature.wideChat.hint': 'Widen the conversation transcript/input area from roughly half to about 95% of the right pane (aligned with the tabs bar above)',
  'uiSettings.feature.wideBubble': 'Wide message bubble',
  'uiSettings.feature.wideBubble.hint': 'Widen the user message bubble from its 525px cap to about 80% of the content column (pairs well with "Wide conversation area")',
  'uiSettings.feature.contextWarn': 'Context usage warning',
  'uiSettings.feature.contextWarn.hint': 'The context-usage ring beside the input box turns yellow above 30% occupancy and red above 40%; back to its default color below the threshold',
  'uiSettings.feature.mermaidRender': 'Mermaid diagram rendering',
  'uiSettings.feature.mermaidRender.hint': 'Render mermaid code blocks in messages as diagrams (DSH itself does not render mermaid); the engine loads lazily on first diagram, works on PC and mobile alike, and falls back to the code block on failure',
  // Filter-bar button labels (consumed by session-filter.ts injected DOM).
  'uiSettings.filter.on': 'Running only',
  'uiSettings.filter.off': 'All',
  'uiSettings.running.label': '{count} running',
  'uiSettings.ungrouped': 'Ungrouped',
  // Session bookmarks (independent submodule, bookmarkEnabled off by default):
  'syncTab.label': 'Memory Sync',
  'syncTab.loading': 'Loading…',
  'syncTab.loadFailed': 'Failed to load status: {message}',
  'syncTab.tab.project': 'This project',
  'syncTab.tab.global': 'Global memory',
  'syncTab.tab.remote': 'Shared memory repo',
  'syncTab.section.project': 'Project memory (KEY + project log + archive + project todos)',
  'syncTab.section.global': 'Global memory (device-level, project-independent)',
  'syncTab.section.remote': 'Shared memory repo (device-level config)',
  'syncTab.project.mode.off': 'Disabled (local only)',
  'syncTab.project.mode.off.desc': 'Project memory stays on this machine: no repo, no entry IDs, no reconciliation with any remote',
  'syncTab.project.mode.main': 'Mode A: main code repo (zero config)',
  'syncTab.project.mode.main.desc': 'Project memory lives in a dedicated branch of your code repo (never touches your code). **A public code repo means public memory**',
  'syncTab.project.mode.shared': 'Mode B: shared memory repo',
  'syncTab.project.mode.shared.desc': 'Project memory lives in a dedicated branch of the shared memory repo, fully isolated from your code',
  'syncTab.project.mode.shared.needRemote': 'Shared memory repo is not enabled — switched to "Shared memory repo", please enable and save the URL first',
  'syncTab.status.title': 'Current memory remote',
  'syncTab.status.disabled': 'Disabled — enable sync for this project above to begin',
  'syncTab.status.notInit': 'Enabled, but this project is not initialized yet — pick Mode A or B above to initialize',
  'syncTab.status.remoteKind': 'Memory remote: {kind}',
  'syncTab.status.remoteKindMain': 'main code repo',
  'syncTab.status.remoteKindShared': 'shared memory repo',
  'syncTab.status.remoteKindNone': 'not mounted',
  'syncTab.status.originUrl': 'Remote URL: {url}',
  'syncTab.status.branch': 'Remote branch: {branch}',
  'syncTab.status.counts': '{pending} not pushed · {behind} behind · {conflicts} conflicts',
  'syncTab.status.migrate': 'Legacy memory dir found: {dir} — "Start sync" will migrate it',
  'syncTab.global.title': 'Global memory',
  'syncTab.global.uncommitted': '{n} tracks not pushed (uncommitted + unpushed commits)',
  'syncTab.global.trackMemory': 'Global memory (MEMORY.md)',
  'syncTab.global.trackUser': 'User profile (USER.md)',
  'syncTab.global.trackDaily': 'Daily logs (daily/*.md)',
  'syncTab.global.trackTodo': 'Todos: life/work/daily (TODOS-*.md)',
  'syncTab.global.hint': 'Global memory (user profile / daily logs / todos) belongs to no single project — all projects share this one set of switches; push always requires your explicit click',
  'syncTab.global.sync': 'Fetch & merge',
  'syncTab.global.push': 'Push',
  'syncTab.global.notInit': 'Shared memory repo is not enabled — global memory is unavailable; enable and save the URL on the "Shared memory repo" page first',
  'syncTab.remote.desc': 'One shared memory repo for the whole device: project Mode B and global memory (user profile / daily logs / todos) both reference it — enable and save the URL once.',
  'syncTab.remote.placeholder': 'Paste a shared memory repo URL (e.g. ssh://git@.../dsh-memories.git)',
  'syncTab.remote.save': 'Enable & save',
  'syncTab.remote.modify': 'Modify & save',
  'syncTab.remote.current': 'Current shared memory repo: {url}',
  'syncTab.remote.mode.off': 'Disabled',
  'syncTab.remote.mode.off.desc': 'Project Mode B and global memory unavailable; synced data and the URL are kept',
  'syncTab.remote.mode.on': 'Enabled',
  'syncTab.remote.mode.on.desc': 'Project Mode B and global memory available; save the repo URL first',
  'syncTab.remote.disable': 'Disable shared memory repo',
  'syncTab.remote.switchHint': 'Disabling turns off the shared memory repo (project Mode B and global memory become unavailable); synced data and the URL are kept, re-enable anytime.',
  'syncTab.actions.sync': 'Fetch & merge',
  'syncTab.actions.push': 'Push',
  'syncTab.actions.nothingToSync': 'Nothing to sync — enable this project or a global track first',
  'syncTab.conflicts.title': 'Conflicts ({count} — both devices edited the same entry)',
  'syncTab.conflicts.titleGlobal': 'Global {track}: {count} pending conflicts (both devices edited the same entry)',
  'syncTab.conflicts.base': 'Base',
  'syncTab.conflicts.ours': 'Ours',
  'syncTab.conflicts.theirs': 'Theirs',
  'syncTab.conflicts.oursBtn': 'Use ours',
  'syncTab.conflicts.theirsBtn': 'Use theirs',
  'syncTab.conflicts.bothBtn': 'Keep both',
  'syncTab.footnote': 'Writing memory stays real-time local (no Git touched); sync batches up. Conflict markers never hit disk; resolving auto-commits.',
  'bookmarkTab.label': 'Bookmarks',
  'bookmark.tab.list': 'List',
  'bookmark.tab.guide': 'Guide',
  'bookmark.list.title': 'Session bookmarks',
  'bookmark.list.help': 'Click a bookmark to jump to that turn; star ☆ at each turn tail to bookmark, ★ when bookmarked (rename/delete); searchable list; fork from any turn (official mid-turn branch buttons are taken over by Memory Evolve).',
  'bookmark.refresh': 'Refresh',
  'bookmark.loading': 'Loading…',
  'bookmark.empty': '(No bookmarks yet — click ☆ at a turn tail)',
  'bookmark.defaultLabel': 'Turn {n}',
  'bookmark.turn': 'Turn {n}',
  'bookmark.prompt.create': 'Bookmark name (editable):',
  'bookmark.prompt.rename': 'New name:',
  'bookmark.confirm.delete': 'Delete bookmark "{label}"?',
  'bookmark.noSession': 'Cannot determine the current session (refresh the page and retry)',
  'bookmark.search.placeholder': 'Search bookmarks…',
  'bookmark.search.empty': '(No matching bookmarks)',
  'bookmark.star.title.off': '☆ Bookmark this turn (Memory Evolve session bookmarks)',
  'bookmark.star.title.on': '★ Bookmarked: {label} (Memory Evolve — click to rename/delete)',
  'bookmark.menu.rename': 'Rename',
  'bookmark.menu.delete': 'Delete',
  'bookmark.action.jump': 'Jump',
  'bookmark.action.fork': 'Fork',
  'bookmark.action.rename': 'Rename',
  'bookmark.action.delete': 'Delete',
  'bookmark.fork.title': 'Fork from this turn (Memory Evolve enhancement)',
  'bookmark.fork.confirm': 'Officially you can only fork from the last message. Fork from this turn (seq {n}) anyway? (Memory Evolve enhancement)',
  'bookmark.fork.working': 'Creating fork session…',
  'bookmark.fork.ok': 'New session created: {id} (see the session list on the left)',
  'bookmark.jump.hint': 'Click to jump to this turn',
  'bookmark.jumping': 'Locating…',
  'bookmark.jump.ok': 'Jumped to "{label}"',
  'bookmark.jump.notFound': 'Could not find the message for "{label}" (may be compacted or outside the loaded window)',
  'bookmark.jump.noChat': 'Chat tab not found — cannot jump',
  'bookmark.renamed': 'Renamed',
  'bookmark.deleted': 'Deleted',
  'bookmark.error': 'Failed: {message}',
  'bookmark.guide.what.title': 'What are session bookmarks',
  'bookmark.guide.what.body': 'Star any completed turn, then jump back to it from the list in one click; you can also fork an official branch session from any turn — start a new line from a mid-way decision point. Data lives in a plugin sidecar (official session logs are never touched); the official mid-turn branch buttons are taken over by this plugin (a confirm dialog, then the official fork path).',
  'bookmark.guide.star.title': 'How to star',
  'bookmark.guide.star.body': 'Every completed turn has a ☆ button at its tail: click it, name it (default "Turn N") and it is bookmarked; ★ means bookmarked — click again to rename or delete. The small icon does not crowd Copy / Branch.',
  'bookmark.guide.list.title': 'List and jump',
  'bookmark.guide.list.body': 'This tab lists every bookmark of the current session (label, turn, time, summary). Click to jump: it switches back to the Chat tab and scrolls to that turn; if the target lies outside the loaded history window it fetches older messages first.',
  'bookmark.guide.switch.title': 'Switch',
  'bookmark.guide.switch.body': 'Off by default; enable "Session bookmarks" under Memory Evolve Settings → Config. When off, stars and this tab hide; the sidecar file is kept.',
  'panel.guide.bookmark.title': 'Session bookmarks',
  'panel.guide.bookmark.desc': 'Star any turn and jump back from the list; fork official branch sessions from any turn (including taking over official mid-turn branch buttons). Independent switch, off by default.',
  'panel.config.bookmarkEnabled': 'Session bookmarks',
  'panel.config.bookmarkEnabled.hint': 'Enable session bookmarks: a ☆ star on each completed turn tail + a Bookmarks tab for the list and jump; fork official branch sessions from any turn (list "Fork" button, or click the official branch button — mid-turn buttons are taken over with a confirm dialog). Data lives in <memoryDir>/session-bookmarks.json (per-session, keyed by turn seq). **Independent submodule** (off by default; pure UI + host API, no AI tools); when off, stars and the tab hide, the data file is kept.',
  'panel.config.todoEnabled': 'Todos',
  'panel.config.todoEnabled.hint': 'Enable the dtodo tool, Todos tab, and due reminders. When off, the tab hides immediately and todo writes stop; existing data and the sync track stay intact.',
  // Legacy keys kept for compatibility (old merged memory-tab layout).
  'memoryTab.feature.config': 'Config',
  'memoryTab.feature.todoSuggestions': 'Todo suggestions',
  'memoryTab.feature.skills': 'Skill suggestions',
  'memoryTab.feature.skillBrowser': 'Skill manager',
  'memoryTab.feature.todo': 'Todos',
  // Memory-tab guide (the "Guide" sub-tab: detailed intro of the memory feature itself).
  'memoryTab.guide.tracks.title': 'Five memory tracks: the AI long-term working memory',
  'memoryTab.guide.tracks.body': 'Memory is organized in five tiers by "who should see it"; injection scope narrows by tier and tiers never pollute each other — what should be injected is auto-injected, the rest is read on demand:',
  'memoryTab.guide.tracks.item1': 'User profile (user): who you are — preferences, habits, communication style. Injected into every session, so you never re-introduce yourself;',
  'memoryTab.guide.tracks.item2': 'Long-term memory (memory): global facts — environment, tools, general conventions. Injected into every session;',
  'memoryTab.guide.tracks.item3': 'Key project facts (key): conventions, decisions, architecture, pitfalls of the current project. Injected only into this project sessions, filtered by git branch — each branch keeps its own conventions;',
  'memoryTab.guide.tracks.item4': 'Project log (project): the running record of this project. Never injected; the AI reads it on demand, history is traceable;',
  'memoryTab.guide.tracks.item5': 'Daily log (daily): per-day progress notes. Never injected; read on demand — like a daily work report.',
  'memoryTab.guide.files.title': 'File tabs: read the memory files directly',
  'memoryTab.guide.files.body': 'This tab previews AGENTS.md (global rules) and every memory file. File tabs are read-only — edit through the memory tool or via the actions in this tab, to avoid breaking the §-delimited format:',
  'memoryTab.guide.files.item1': 'Beauty view: each entry is a card (time / branch / tag badges + content), searchable and filterable; a plain-text view shows the raw text;',
  'memoryTab.guide.files.item2': 'The KEY tab lets you manually add long-term project facts (optionally scoped to certain git branches); they are injected next turn after saving;',
  'memoryTab.guide.files.item3': 'Every entry can be edited (writes need confirmation), deleted (exact full-entry match, no accidental deletions), archived / restored to the main track.',
  'memoryTab.guide.branch.title': 'Git branch awareness: different branches, different conventions',
  'memoryTab.guide.branch.body': 'Different branches of the same project can carry completely different conventions; project-level memory tracks the current branch end to end:',
  'memoryTab.guide.branch.item1': 'Key entries can carry a branch-scope marker (no marker = visible on all branches); injection only includes "no marker" + "covers the current branch";',
  'memoryTab.guide.branch.item2': 'Log entries are automatically tagged with their source branch ([git branch name]), so cross-branch reviews never mix things up.',
  'memoryTab.guide.maintain.title': 'Edit & maintain: day-to-day care of the memory',
  'memoryTab.guide.maintain.body': 'All memory maintenance happens right here:',
  'memoryTab.guide.maintain.item1': 'Edit the body only — timestamps / branch / tags are maintained by the program;',
  'memoryTab.guide.maintain.item2': 'Delete: exact full-entry matching (long entries that contain others are never accidentally removed); deletion is irreversible;',
  'memoryTab.guide.maintain.item3': 'Archive / restore: move low-frequency entries out of the main track (kept for reference, no injection), restore them anytime.',
  'memoryTab.guide.suggestions.title': 'Memory suggestions: the AI proposes, you decide',
  'memoryTab.guide.suggestions.body': 'The background review distills "what is worth remembering" into a pending queue — the AI never writes into the memory on its own:',
  'memoryTab.guide.suggestions.item1': 'Approve: optionally edit the text first and pick the target track (long-term memory / user profile / key project facts); it is injected with the next snapshot;',
  'memoryTab.guide.suggestions.item2': 'Archive: no injection, kept for reference, restorable; Reject: discard.',
  'memoryTab.guide.confirm.title': 'The confirmation system: why your approval is required',
  'memoryTab.guide.confirm.body': 'Memory writes genuinely change the AI behavior — once written they enter the context and affect every later reply. So everything goes through your confirmation first: that is the gate of memory evolution. You are in charge.',
  // Skills-tab guide (the "Guide" sub-tab: detailed intro of the skill feature itself).
  'skillsTab.guide.what.title': 'What a skill is: a methodology manual for the AI',
  'skillsTab.guide.what.body': 'A skill = a methodology document for the AI (SKILL.md: name + description + steps). It is injected into every session system prompt — next time the AI meets the same kind of task it follows your process instead of re-inventing it:',
  'skillsTab.guide.what.item1': 'The skill library lives at ~/.agents/skills by default (one directory per skill);',
  'skillsTab.guide.what.item2': 'DSH also scans project skills, bundled skills and custom directories — all visible and manageable in this tab.',
  'skillsTab.guide.how.title': 'How skills form',
  'skillsTab.guide.how.body': 'Methodologies learned the hard way are solidified into skills through two main paths:',
  'skillsTab.guide.how.item1': 'Background review: when the AI notices a recurring pattern it creates a skill, which lands in "skill suggestions" — after your approval it moves into the library;',
  'skillsTab.guide.how.item2': 'The skill_manage tool: just tell the AI "save this process as a skill" and it creates / updates one;',
  'skillsTab.guide.how.item3': 'Create sparingly: only "recurring, hard-won, reusable" skills — every skill is injected into every session and affects the context.',
  'skillsTab.guide.pending.title': 'Skill suggestions',
  'skillsTab.guide.pending.body': 'Review-created skills wait for your confirmation here:',
  'skillsTab.guide.pending.item1': 'Approve: moved into the skill library (~/.agents/skills), injected with the system prompt, immediately usable in every session;',
  'skillsTab.guide.pending.item2': 'Reject: discard the skill.',
  'skillsTab.guide.manager.title': 'Skill manager: browse, edit, custom directories',
  'skillsTab.guide.manager.body': 'The full skill manager (three panes: skill list / directory tree / file view-edit):',
  'skillsTab.guide.manager.item1': 'All skills are grouped by source (user user-* / custom / bundled / project project-*), searchable and filterable;',
  'skillsTab.guide.manager.item2': 'Custom skill directories: add / remove any skill directory (<dir>/<skill>/SKILL.md or <dir>/<skill>.md layout);',
  'skillsTab.guide.manager.item3': 'File browsing & editing: directory tree + text view / edit (scoped to skill directories; out-of-bounds, binary and oversized files are rejected);',
  'skillsTab.guide.manager.item4': 'Disabled-list and custom directories persist across restarts.',
  'skillsTab.guide.disable.title': 'Disable / enable: hide skills you do not want',
  'skillsTab.guide.disable.body': 'One click removes a skill from the model skill catalog (the model no longer sees it and the skill tool refuses to load it):',
  'skillsTab.guide.disable.item1': 'Re-enable anytime; the choice persists;',
  'skillsTab.guide.disable.item2': 'System skills (project source) cannot be disabled by design.',
  'skillsTab.guide.dirs.title': 'Custom skill directories',
  'skillsTab.guide.dirs.body': 'Add / remove your own skill directories in "Skill manager" (e.g. ~/.hermes/skills); paths overlapping an existing skill root are rejected; persisted and reloaded after restart.',
  'skillsTab.guide.restraint.title': 'Creation discipline: restraint is what makes skills effective',
  'skillsTab.guide.restraint.body': 'Skills are injected into every session system prompt and affect context and cache — create sparingly:',
  'skillsTab.guide.restraint.item1': 'Only create skills for "hard, recurring problems you will meet again";',
  'skillsTab.guide.restraint.item2': 'Never create a skill for a one-off or trivial task.',
  // Todos-tab guide (the "Guide" sub-tab: detailed intro of the todo feature itself).
  'todosTab.guide.tracks.title': 'Four todo tracks: everything in its place',
  'todosTab.guide.tracks.body': 'Todos are filed by target, isomorphic to the memory system:',
  'todosTab.guide.tracks.item1': 'Life (life): personal errands;',
  'todosTab.guide.tracks.item2': 'Work (work): cross-project business;',
  'todosTab.guide.tracks.item3': 'This project (project): todos of the current working directory — invisible from other directories, isolated by cwd;',
  'todosTab.guide.tracks.item4': 'Today (daily): per-day todo files, with past days reviewable (grouped by date).',
  'todosTab.guide.add.title': 'How to add',
  'todosTab.guide.add.body': 'Two ways, pick either:',
  'todosTab.guide.add.item1': 'Tell the AI "remember / I need to do X" (optionally say work / life / this project / today) and it files the todo into the right track;',
  'todosTab.guide.add.item2': 'Add manually in this tab input (quadrant and due date optional).',
  'todosTab.guide.pending.title': 'Todo suggestions: the AI cannot assign you work on its own',
  'todosTab.guide.pending.body': 'AI-proposed todos enter a pending queue first, effective only after your confirmation:',
  'todosTab.guide.pending.item1': 'Approve: written into the target track (a todo stays a todo, never becomes memory);',
  'todosTab.guide.pending.item2': 'Archive: kept for reference; Reject: discard.',
  'todosTab.guide.attrs.title': 'Status & attributes',
  'todosTab.guide.attrs.body': 'Every todo carries full metadata to track:',
  'todosTab.guide.attrs.item1': 'Quadrant (important × urgent), due date, optional category;',
  'todosTab.guide.attrs.item2': 'Status: pending / doing / done (completion time stamped) / blocked / cancelled;',
  'todosTab.guide.attrs.item3': 'List / board views: list tabs by track with status / quadrant filters; board shows a 2×2 quadrant grid; each item can be done / restored, inline-edited, deleted (with confirm).',
  'todosTab.guide.view.title': 'Smart view: only what needs attention',
  'todosTab.guide.view.body': 'By default only items needing attention are shown (overdue / due today / current project / important-urgent, max 8) to avoid noise:',
  'todosTab.guide.view.item1': 'Past daily todos are read on demand — open the "past" tab to query history;',
  'todosTab.guide.view.item2': 'Check "show expired" to reveal overdue leftovers (hidden by default).',
  'todosTab.guide.remind.title': 'Due reminders: the AI keeps watch for you',
  'todosTab.guide.remind.body': 'The AI checks todos at the end of every turn and reminds you of overdue / due items in its reply — you never have to keep track yourself.',
  'todo.track.life': 'Life',
  'todo.track.all': 'All',
  'todo.track': 'Track',
  'todo.track.work': 'Work',
  'todo.track.project': 'This project',
  'todo.track.daily': 'Today',
  'todo.track.past': 'Past',
  'todo.projectHint': 'No working directory for this session — project todos unavailable (life/work/today only).',
  'todo.help': 'Four tracks: Life=personal errands; Work=cross-project tasks; This project=the current working directory\'s todos (invisible from other dirs); Today=today\'s tasks (one file per day). Past daily todos (earlier days) are not loaded by default — open the “Past” tab or tick “Show expired” to query history (expired leftovers stay hidden until then). To add: type content, optionally pick a quadrant (important × urgent) and a due date, then hit Add — or just tell me “add a todo, it\'s for work/life/this project/today” and I will file it in the right track.',
  'todo.showExpired': 'Show expired',
  'todo.pastHint': 'Past daily todos are mostly expired leftovers and are hidden by default; tick “Show expired” to view them.',
  'todo.addPlaceholder': 'Type a todo (multi-line ok), pick quadrant/due, add…',
  'todo.add': 'Add',
  'todo.added': 'Todo added',
  'todo.done': 'Done',
  'todo.undone': 'Restore',
  'todo.edit': 'Edit',
  'todo.save': 'Save',
  'todo.cancel': 'Cancel',
  'todo.updated': 'Updated',
  'todo.deleted': 'Deleted',
  'todo.deleteConfirm': 'Delete this todo? This cannot be undone.\n\n{snippet}',
  'todo.due': 'Due',
  'todo.overdue': 'Overdue',
  'todo.all': 'All',
  'todo.filterStatus': 'Status',
  'todo.filterQuadrant': 'Quadrant',
  'todo.status.active': 'Active',
  'todo.status.pending': 'Pending',
  'todo.status.doing': 'Doing',
  'todo.status.done': 'Done',
  'todo.status.blocked': 'Blocked',
  'todo.status.cancelled': 'Cancelled',
  'todo.quadrant': 'Quadrant',
  'todo.quadrant.none': 'Unclassified',
  'todo.quadrant.q1': 'Important & urgent',
  'todo.quadrant.q2': 'Important, not urgent',
  'todo.quadrant.q3': 'Urgent, not important',
  'todo.quadrant.q4': 'Neither',
  'todo.empty': '(No todos yet — add one)',
  // List / Eisenhower board view switch
  'todo.view.mode': 'View',
  'todo.view.list': 'List',
  'todo.view.board': 'Board',
  'todo.board.empty': 'No todos in this quadrant',
  'todo.board.cycleStatus': 'Click to cycle status',
  'memoryTab.cwd': 'Session working directory',
  'memoryTab.loading': 'Loading…',
  'memoryTab.warning': 'These files are §-delimited structured memory. If you open them with a system tool, edit with caution — careless changes can break the format and corrupt memory reads.',
  'memoryTab.readonly': 'Read-only',
  'memoryTab.open': 'Open file',
  'memoryTab.opened': 'Opened with the system tool',
  'memoryTab.empty': '(missing or empty)',
  'memoryTab.noCwd': '(no working directory for this session — project memory unavailable)',
  'memoryTab.truncated': '(content truncated for display)',
  'memoryTab.pagePrev': 'Previous',
  'memoryTab.pageNext': 'Next',
  'memoryTab.pageInfo': 'Page {page}/{total} · {count} entries',
  'memoryTab.viewPretty': 'Pretty view',
  'memoryTab.viewRaw': 'Raw text',
  'memoryTab.searchPlaceholder': 'Search content, time or tag…',
  'memoryTab.noResults': 'No matching entries — try another keyword.',
  'memoryTab.projectTag': 'Project tag',
  'memoryTab.entryCount': '{count} entries',
  'memoryTab.keyAddHelp': 'Manually add a durable project fact (convention/decision/architecture/pitfall); it is written to KEY.md and injected into the context from the next turn on.',
  'memoryTab.keyAddPlaceholder': 'Type a key project fact, e.g. this project uses pnpm workspaces…',
  'memoryTab.keyAdd': 'Save',
  'memoryTab.keyAdded': 'Key fact saved — it will be injected from the next turn',
  'memoryTab.delete': 'Delete',
  'memoryTab.deleteConfirm': 'Delete this memory entry? This cannot be undone.\n\n{snippet}',
  'memoryTab.deleted': 'Entry deleted',
  'memoryTab.edit': 'Edit',
  'memoryTab.save': 'Save',
  'memoryTab.cancel': 'Cancel',
  'memoryTab.updated': 'Entry updated',
  'memoryTab.editHint': 'Content only: timestamps and branch tags are program-maintained and cannot be changed; the § delimiter cannot be typed.',
  'memoryTab.editConfirm': 'This entry is injected into the session context (the model\'s prompt) right after saving. Save anyway?\n\n{snippet}',
  'memoryTab.archive': 'Archive',
  'memoryTab.archiveConfirm': 'Archive this entry? It leaves the main memory (no longer injected) and can be promoted back any time.\n\n{snippet}',
  'memoryTab.archived': 'Archived (no longer injected; can be promoted back)',
  'memoryTab.promote': 'Promote to memory',
  'memoryTab.promoted': 'Promoted back into the main memory',
  'memoryTab.keyScope': 'Branch scope',
  'memoryTab.keyScopeLabel': 'Branch',
  'memoryTab.keyScopeAll': 'All branches',
  'memoryTab.keyScopeAllHint': 'All branches = visible everywhere',
  'memoryTab.keyScopeAllWeight': '(checking it clears branch picks)',
  'memoryTab.keyScopeHint': 'Click to change the branch scope',
  'memoryTab.keyScopeSaved': 'Branch scope updated',
  'memoryTab.keyScopeSave': 'Save',
  'memoryTab.keyScopeCancel': 'Cancel',
  'memoryTab.keyBranchInfo': 'current branch: {branch} — only untagged entries or entries covering this branch are injected',
  'memoryTab.gitBranch': 'The git branch this record belongs to',
  'memoryTab.dshOnly': 'DSH-only',
  'memoryTab.dshOnlyHint': 'This entry is injected into DSH sessions only; external executors (COI tasks) skip it — for DSH-specific discipline/rules/architecture facts',
  'memoryTab.dshOnlyOn': 'DSH-only',
  'memoryTab.dshOnlyOff': 'Unmark DSH-only',
  'memoryTab.dshOnlySet': 'Marked DSH-only (skipped when injecting into external executors)',
  'memoryTab.dshOnlyRemoved': 'DSH-only mark removed (visible to external executors)',
  'memoryTab.dshOnlyToggleHint': 'Toggle the DSH-only mark: the entry reaches DSH sessions only, external executors (COI) skip it',
  'memoryTab.dshOnlyAdd': 'DSH-only (do not inject into external executors)',
  'memoryTab.desc.project': 'Project log: auto-recorded per turn; never injected, read on demand by the model.',
  'memoryTab.desc.key': 'Key project facts: conventions/decisions/pitfalls, injected into this project\'s sessions; written when important, addable/deletable manually.',
  'memoryTab.desc.daily': 'Daily log: per-day progress records with program-tagged project labels; never injected, read on demand.',
  'memoryTab.desc.user': 'User profile: preferences and habits, injected into every session; writes need review + confirmation.',
  'memoryTab.desc.memory': 'Long-term memory: global environment/project facts, injected into every session; writes need review + confirmation.',
  'memoryTab.desc.archive-user': 'Archived user facts: not good enough for the main track, never injected; can be promoted back or deleted.',
  'memoryTab.desc.archive-memory': 'Archived memory facts: not good enough for the main track, never injected; can be promoted back or deleted.',
  'memoryTab.desc.archive-key': 'Archived key project facts: not good enough for the main track (or paused from injection), never injected; can be promoted back or deleted.',
  'memoryTab.desc.agents': 'Global rules: cross-session user rules (AGENTS.md), injected with the system prompt.',
  'panel.suggestions.title': 'Pending memory suggestions',
  'panel.suggestions.empty': 'No pending suggestions.',
  'panel.suggestions.help': 'Global-track suggestions produced by the background review: approve writes them into the memory files (injected with the snapshot); archive keeps them aside (never injected); reject drops them.',
  'panel.todoSuggestions.title': 'Pending todo suggestions',
  'panel.todoSuggestions.empty': 'No pending todo suggestions.',
  'panel.todoSuggestions.help': 'Todo suggestions from the background review: approve writes into the matching todo track (a todo stays a todo); archive keeps aside; reject drops.',
  'panel.guide.title': 'Guide',
  'panel.guide.intro': 'maestro-memory is a "memory & self-evolution" toolkit: it turns conversations into durable memory, todos and skills — the AI gets to know you better over time and never loses context across sessions. Here is what each module does and how to use it.',
  'panel.guide.memory.title': 'Memory read/write (memory tool)',
  'panel.guide.memory.desc': 'Five tracks: global memory, user profile, key project facts (auto-injected and git-branch aware — only facts relevant to the current branch reach the context), project log, daily log. How to use: just chat — the AI logs progress every turn; for important facts say "remember: the deploy port is 8080"; when resuming days later ask "check the memory" and it picks up seamlessly.',
  'panel.guide.review.title': 'Memory review (self-evolution)',
  'panel.guide.review.desc': 'Every N turns (10 by default, configurable) the AI reviews the conversation and distills what is worth remembering into suggestions for your confirmation — it never writes into the memory on its own. Just approve or reject in the Memory tab queue from time to time.',
  'panel.guide.todo.title': 'Todo management (dtodo)',
  'panel.guide.todo.desc': 'Say "remember / I need to do X" and it becomes a structured todo (auto-filed into life / work / project / daily, with important-urgent flags and due dates); the AI reminds you of due items at the end of its replies. AI-proposed todos land in a pending queue first. Manage everything in the Todos tab.',
  'panel.guide.skill.title': 'Skill accumulation (skill_manage)',
  'panel.guide.skill.desc': 'Methodologies learned the hard way can be solidified into skills; next time the same kind of task follows the process. Just say "save this process as a skill"; keep creation restrained and high-value. Browse, search and enable / disable skills in the Skills tab.',
  'panel.guide.search.title': 'Local file search (memory_evolve_search_local_files)',
  'panel.guide.search.desc': 'When the memory has no answer and you need local material, tell the AI "search the machine for XX" — by filename (documents only by default, all types on request); "which document mentioned XX" searches file content and returns hits with snippets. Four modes under "Config": filename + content / filename only / content only / off. Off by default — the tool is invisible to the model until enabled.',
  'panel.guide.coi.title': 'COI dispatch (de_coi)',
  'panel.guide.coi.desc': 'Dispatch tasks to external CLI agents (kimi / codex / grok / hermes…): unified scheduling without blocking, live progress, layered sessions with one-click resume, cross-COI chaining, results archived and distilled into memory. Say "dispatch XX to kimi / codex" or use the COI Dispatch tab. Off by default: enable "COI dispatch" under Config.',
  'panel.guide.prompt.title': 'Prompt manager',
  'panel.guide.prompt.desc': 'Turn recurring working patterns into prompt assets: pick one and inject — the model sees it next turn without interrupting the reply; supports one-shot, N turns, or every-M-turns reminders (numbers freely editable, auto-expiring by turn count), stoppable anytime; ad-hoc injection works without creating a prompt first. Off by default: enable "Prompt manager" under Config.',
  'panel.guide.models.title': 'Model settings (de_models)',
  'panel.guide.models.desc': 'The "Model settings" tab + de_models tool: a table of DSH providers and models with plugin-side per-model settings (enabled, note, thinking support, allowed / recommended reasoning levels incl. custom levels) — these settings only affect this plugin (de_models queries and tab display); DSH own model settings stay untouched. Off by default: enable "Model settings" under Config.',
  'panel.guide.advisor.title': 'Session review (Advisor)',
  'panel.guide.advisor.desc': `Attach an independent reviewer to every session — it only observes what you see in the UI (no thinking / tool calls), reviews each turn in real time and nudges you as "user instructions" when needed (info / nit / concern / blocker; info is record-only by default; in the chat flow these appear as collapsed [severity] lines so you can tell them apart). It works as a persistent session — full context, never truncated; the panel supports starting a fresh reviewer, asking it directly, and four levels of constraints (system prompt / project / session / reviewer-session, most-local wins). Off by default: open the master switch under Config, then enable per session in the floating panel; the reviewer model inherits the session model by default and can be set separately.`,
  'panel.guide.broadcast.title': 'Session broadcast (de_broadcast)',
  'panel.guide.broadcast.desc': 'Message passing between DSH sessions: copy your session ID (⧉ button in the session header), send it to another session and let its AI use de_broadcast send to reach you — the receiver snapshot gets a targeted unread notice (visible only to the receiver), the AI reads the full text via list / read, auto-deleted once everyone has read it; very long content is stored to a file. Rooms support multi-member collaboration across working directories; project groups reach a whole directory. Off by default: enable "Session broadcast" under Config.',
  'panel.guide.session.title': 'Session search (de_session_search)',
  'panel.guide.session.desc': 'Let the AI search the history of other AI tools (Codex currently) — "when did we do XX in Codex" just works: keyword hits with message snippets and context windows; scope by cwd, control scale with sort / limit / window; zero resident state — no index, no cache, read-only live scans. Off by default: enable "Session search" under Config.',
  'panel.guide.sessionOrch.title': 'Session orchestration (de_session)',
  'panel.guide.sessionOrch.desc': 'Let the AI create / wake DSH sessions programmatically — spawn builds a standard session (fully isomorphic to a manual one: system prompt / tools / memory snapshot / persistence, listed on the left and adoptable) that starts running immediately; wake resumes an existing session with a task (queued if busy); status / list report state. Discipline: the AI never bulk-wakes sessions — you stay in command. Off by default: enable "Session orchestration" under Config; pairs well with broadcast rooms.',
  'panel.guide.uiSettings.title': 'Web UI Settings',
  'panel.guide.uiSettings.desc': 'Style-level tweaks for the DSH web GUI (pure client-side injection): independent switches in the "Web UI Settings" tab "General" page — session filter (left list shows only active), wide conversation area, wide message bubbles, context-usage warning, Mermaid rendering. Off by default.',
  'panel.guide.canvas.title': 'Infinite canvas',
  'panel.guide.canvas.desc': 'Collect scattered files / images / audio onto one infinite canvas (the "Canvas" tab) — board by path / note / search (local path references, no copying), preview in-card, copy a reference string and give it to the AI to fetch by id; the AI can also drop notes via de_canvas (nothing is injected — it queries on demand). Off by default: enable "Infinite canvas" under Config.',
  'panel.guide.sync.title': 'Memory sync (cross-device)',
  'panel.guide.sync.desc': 'Keep project memory consistent across devices — share the same key facts / logs / archives / project todos between office and home machines. In the "Memory sync" tab enable "sync this project" and click start: by default it uses a dedicated branch of your code repo (zero config); or fill in a shared memory repo — one repo for all projects (global tracks too). Another machine recognizes the project automatically and pulls to continue. The module switch lives under Config; sync is always triggered by you, and projects with sync off are unaffected.',
  'panel.guide.confirm.title': 'The confirmation system (why the AI cannot write directly)',
  'panel.guide.confirm.desc': 'AI-proposed memory, todos and skills all enter a pending queue and take effect only after your confirmation. These writes genuinely change AI behavior: memory enters the context, todos are work assigned to you, skills alter the AI capability set — unchecked writes could canonize mistakes or assign you work unprompted. You are the final gate: the AI proposes, you decide.',
  'panel.guide.best.title': 'Tips for the best experience',
  'panel.guide.best.1': 'Session continuity: say "check the memory" and the AI picks up project conventions and progress from the logs — no need to repeat yourself.',
  'panel.guide.best.2': 'Capture on the fly: say "remember this / follow up on this" and the AI files it automatically; a word days later resumes the thread.',
  'panel.guide.best.3': 'Review periodically: glance at the memory / todo suggestion queues and approve or reject — that is the confirmation loop of memory evolution.',
  'panel.guide.best.4': 'Multi-device sync: work from office and home? Enable "Memory sync" and both machines share the same project memory — important conclusions never need repeating.',
  'panel.guide.loop': 'The loop: chat → record → review → distill → execute. This mechanism is the AI long-term working memory.',
  'panel.suggestions.approve': 'Approve',
  'panel.suggestions.archive': 'Archive',
  'panel.suggestions.archiveHint': 'Archive: kept out of the injected memory, can be promoted back later',
  'panel.suggestions.editHint': 'You may edit the text before approving; the edited text is what gets written.',
  'panel.suggestions.reject': 'Reject',
  'panel.suggestions.approveAll': 'Approve all',
  'panel.suggestions.rejectAll': 'Reject all',
  'panel.suggestions.hits': 'Suggested {count}×',
  'panel.suggestions.hitsHint': 'This fact resurfaced across several reviews — worth a careful look',
  'panel.suggestions.target.memory': 'Memory',
  'panel.suggestions.target.user': 'User profile',
  'panel.suggestions.target.key': 'Project key facts',
  'panel.suggestions.targetHint': 'Track to write on approve: defaults to the AI-recommended one; re-classify if it fits better (memory/user/key are injected into the prompt immediately)',
  'panel.suggestions.projectHint': 'This suggestion comes from the working directory: {path}',
  'panel.suggestions.done': 'Done: {text}',
  'panel.archive.title': 'Archived memory',
  'panel.archive.empty': 'No archived entries.',
  'panel.archive.help': 'Archived suggestions are never injected; they stay here for later — promote them back into the memory files when they matter, or delete them.',
  'panel.archive.promote': 'Promote to memory',
  'panel.archive.delete': 'Delete',
  'panel.archive.promoted': 'Promoted to memory',
  'panel.archive.deleted': 'Archived entry deleted',
  'panel.skills.title': 'Pending skill suggestions',
  'panel.skills.help': 'New skills produced by background review; approving moves them into the skill library (~/.agents/skills) where they are injected into system prompts.',
  'panel.skills.empty': 'No pending skill suggestions.',
  'panel.skills.pending': 'Pending',
  'panel.skills.approve': 'Approve',
  'panel.skills.reject': 'Reject',
  'panel.skills.done': 'Skill {op}',
  'panel.config.title': 'Config',
  'panel.config.help': 'Changes apply immediately and persist (overriding the config.yaml entries).',
  'panel.config.reviewEnabled': 'Background review',
  'panel.config.reviewEnabled.hint': 'Automatically review sessions and harvest experience; when off, the memory/skill tools and the snapshot still work — only the automatic review stops',
  'panel.config.reviewInterval': 'Review interval (turns)',
  'panel.config.reviewInterval.hint': 'One automatic review per N user turns',
  'panel.config.skillReviewEnabled': 'Skill auto-harvest',
  'panel.config.skillReviewEnabled.hint': 'Off (default): new skills from review go to the pending queue and only install when approved; On: review creates skills directly without confirmation (skills are injected into every session — enable with care)',
  'panel.config.perTurnProjectWrites': 'Per-turn project writes',
  'panel.config.perTurnProjectWrites.hint': 'Require the model to check at the end of every turn and record project-related facts (decisions/progress/pitfalls); when off, project memory is read on demand only. ⚠️ Relies on LLM instruction following — weaker models may not comply',
  'panel.config.perTurnDailyWrites': 'Per-turn daily writes',
  'panel.config.perTurnDailyWrites.hint': 'Require the model to check at the end of every turn and record the day\'s progress; when off, the daily log is read on demand only. ⚠️ Relies on LLM instruction following — weaker models may not comply',
  'panel.config.perTurnKeyWrites': 'Per-turn key-fact check',
  'panel.config.perTurnKeyWrites.hint': 'Require the model to judge at the end of every turn whether an important project fact emerged (long-lived convention/decision/architecture/pitfall); if so, write it to target=key (injected into the context), otherwise skip. When off, key facts are only added manually or read. ⚠️ Relies on LLM instruction following',
  'panel.config.keyProgressiveDisclosure': 'Key-track progressive disclosure',
  'panel.config.keyProgressiveDisclosure.hint': 'Control how key-track memories are injected: auto = full injection for small data, summary injection for large data; off = always full injection (default); on = always summary injection (saves tokens)',
  'panel.config.keyProgressiveDisclosure.auto': 'Auto',
  'panel.config.keyProgressiveDisclosure.off': 'Off (always full, default)',
  'panel.config.keyProgressiveDisclosure.on': 'On (always summary)',
  'panel.config.keyFullInjectThreshold': 'Full-injection entry-count threshold',
  'panel.config.keyFullInjectThreshold.hint': 'In auto mode, full injection when entry count ≤ this value (default 3)',
  'panel.config.keyFullInjectCharLimit': 'Full-injection character limit',
  'panel.config.keyFullInjectCharLimit.hint': 'In auto mode, full injection when total characters ≤ this value (default 1500)',
  'panel.config.coiEnabled': 'COI dispatch',
  'panel.config.coiEnabled.hint': 'Enable the de_coi_* tools and the CLI Dispatch tab: unified dispatch of CLI agents (kimi/codex/grok/hermes…). Off by default — this plugin\'s core is memory/todos/skills, dispatch is an on-demand add-on; when off, the tools and the tab are completely invisible',
  'panel.config.searchDocsEnabled': 'Local file search tool',
  'panel.config.searchDocsEnabled.hint': 'Lets the model search files across all local disks/directories. **Four modes**: all = name + content search; filename only = content/contentQuery parameters are ignored (never reads file contents — for people who use their own content-search implementation); content only = every call does content matching (query acts as the content keyword); off = the tool is completely invisible to the model. Content search: contentQuery="keyword" answers "which document mentions XX" (rg full-text match, returns hit snippets). Off by default',
  'panel.config.searchDocsMode.all': 'All (name + content)',
  'panel.config.searchDocsMode.filename': 'Filename only',
  'panel.config.searchDocsMode.content': 'Content only',
  'panel.config.searchDocsMode.off': 'Off (tool invisible)',
  'panel.config.advisorEnabled': 'Session review (Advisor)',
  'panel.config.advisorEnabled.hint': 'Master switch for the session-review module. With the switch on, every session still starts OFF — enable reviewing per session from the panel\'s session switch (reviews consume extra model calls, turn them on only where needed; enabled sessions keep their choice across refreshes/restarts). With the switch off, reviewing stops and all review UI (header toggle / floating panel) is hidden; turn it back on to restore the module instantly',
  'panel.config.broadcastEnabled': 'Session broadcast',
  'panel.config.broadcastEnabled.hint': 'Enable session broadcast (de_broadcast): inter-session messaging — the "Session broadcast" unread hint in the snapshot (inbox-style rows: id+subject+sender+time) + the de_broadcast tool (send/list/read; read consumes and auto-deletes once all recipients read; >8KB spills to a file; 30-day cleanup) + the broadcast management panel tab. **Independent of COI dispatch** (off by default, can be enabled alone); when off, all of the above are invisible; the persistent "Your session ID" snapshot section is unaffected; the header "⧉ Copy session ID" / "✎ alias" buttons belong to "Session orchestration" (the panel top also has a copy entry)',
  'panel.config.notifyEnabled': 'Notifications',
  'panel.config.notifyEnabled.hint': 'Enable the notification module (de_notify): the AI proactively notifies you when a task is done — the de_notify manual tool (send anytime, no frequency limit; channels include feishu/qq/weixin/wecom/web) + automatic COI completion notify (pick channels via coiNotifyChannels). The web channel delivers to an in-app notification bell at the top-right: persisted + unread badge + a popover showing "which session sent what" + click to jump to that session. Independent module, off by default; IM channels require the matching channel plugin (dsh-feishu etc., missing ones reported honestly), the web channel is built in with zero deps; when off, the tool is not registered, the bell disappears, and COI auto-notify silently skips',
  'notify.title': 'Notifications',
  'notify.bellAria': 'In-app notifications',
  'notify.empty': 'No unread notifications',
  'notify.loading': 'Loading…',
  'notify.readAll': 'Mark all read',
  'notify.system': 'System',
  'notify.jump': 'Jump to session',
  'notify.delete': 'Delete',
  'notify.viewDetail': 'View details',
  'notify.close': 'Close',
  'notify.markRead': 'Mark read',
  'panel.config.syncEnabled': 'Memory sync',
  'panel.config.syncEnabled.hint': '**Module switch**: enables the Memory Sync module — the Memory Sync tab appears in conversations and /memory_sync works. **Note: this does NOT start syncing any project** — each project is opted in separately via the "Sync this project" switch in the Memory Sync tab (off by default; never-opted-in projects keep their pure-local state: no Git repo, no entry IDs). Sync moves project memory (KEY + project log + archive + project todos) over Git to one memory remote — leave the URL empty to use your main code repo by default (dedicated branch, zero config); paste a shared memory repo URL to use one private repo for all projects (global memory, phase 2, can only sync through it). Push always requires your explicit trigger',
  'panel.config.sessionSearchEnabled': 'Session search',
  'panel.config.sessionSearchEnabled.hint': 'Enable de_session_search: lets the model search historical sessions of other local AI tools (Codex for now: plain JSONL under ~/.codex/sessions and archived_sessions — rg prefilter keeps it millisecond-fast; DSH sessions not supported yet). Case-insensitive literal matching over user/assistant messages only; supports cwd project filter, relevance/newest/oldest sorting, and limit/window result control. **Independent submodule** (off by default, can be enabled alone — unrelated to COI dispatch/broadcast); zero resident state: no index, no cache, every call scans read-only in real time and never modifies session files; when off the tool is completely invisible to the model',
  'panel.config.canvasEnabled': 'Infinite canvas',
  'panel.config.canvasEnabled.hint': '**Module switch**: enables the Infinite Canvas — a Canvas tab in conversations + the de_canvas tool (the model can list the board, read nodes by id, and drop notes into the board\'s center zone). Local path references, single-board with perspective filters (session/project/global + ownership badges), pull-based AI access (board content is never injected into context; query it on demand). **Independent submodule** (off by default): stored at <memoryDir>/canvas/boards.json (whole-board atomic writes + rev optimistic lock to prevent cross-session overwrites); when off the tab and tool are completely invisible, data files are kept',
  'panel.config.sessionEnabled': 'Session orchestration',
  'panel.config.sessionEnabled.hint': 'Enable session orchestration (de_session): lets AI **programmatically create/wake DSH sessions** — spawn creates a standard session (identical to one opened manually: system prompt/tools/memory snapshot/persistence, appears in the left session list and can be taken over), prompt = the full instruction text (role/task freely composed), it starts running immediately; optional cwd / join a broadcast room / model override; wake wakes an existing session (equivalent to sending a message on its behalf — its AI wakes up and processes it, auto-resumed after process restart); status/list inspect state; the header **"⧉ Copy session ID" / "✎ alias" buttons follow this switch** (session-identity features, previously mis-housed under broadcast). **Independent submodule** (off by default; depends on the DSH agents service, only same-process sessions can be woken; when off the tool is invisible to the model)',
  'panel.config.promptsEnabled': 'Prompt manager',
  'panel.config.promptsEnabled.hint': 'Enable the Prompts tab: a prompt library (user-written paradigms + built-in examples) plus an injection track (once / N consecutive turns / every M turns — count and cadence accept any integers; injected content is visible to the model next turn, expires automatically by turn counting, and can be stopped anytime; quick inject works without saving a prompt first, auto-saved to the Temp category). Off by default; when off the snapshot section, event listener and API are fully uninstalled and the tab hides after refresh',
  'panel.config.modelsEnabled': 'Model Settings',
  'panel.config.modelsEnabled.hint': 'Enable the "Model Settings" tab + de_models tool: a table of DSH providers/models with per-model settings (enabled, note, thinking support, allowed/recommended reasoning levels, custom levels); de_models lets the AI query the available model list. **Off by default** (registering takes a slot in the model tool list; turn it on when needed). ⚠️ These settings **only affect this plugin and never modify or affect DSH\'s own model settings** (DSH side stays as the official "Settings → Models" says). When off the tab and tool hide and the API refuses access, settings data is kept',
  'panel.config.uiSettingsEnabled': 'Web UI Settings',
  'panel.config.uiSettingsEnabled.hint': 'Enable the "Web UI Settings" module: a filter bar appears above the left session list, showing only active sessions by default (generating / awaiting approval / awaiting answer / subagents running / error / finished-but-unviewed — purely idle ones collapse away), one click switches back to all; pure client-side styling (CSS + DOM injection, no DSH framework changes); the filter preference is remembered in the browser. **Off by default**; when off, the filter bar and injected styles are fully removed',
  'panel.config.save': 'Save config',
  'panel.reveal.title': 'Open files',
  'panel.reveal.help': 'Open the memory directories and files with your system tools. ⚠️ Careless edits can break the §-delimited format and corrupt memory reads — edit with caution.',
  'panel.reveal.memoryDir': 'Memory dir',
  'panel.reveal.memoryFile': 'Global memory',
  'panel.reveal.userFile': 'User profile',
  'panel.reveal.archiveMemoryFile': 'Archived memory',
  'panel.reveal.archiveUserFile': 'Archived user',
  'panel.reveal.dailyDir': 'Daily log dir',
  'panel.reveal.dailyFile': 'Today log',
  'panel.reveal.projectsDir': 'Project memory dir',
  'panel.reveal.skillDir': 'Skills dir',
  'panel.reveal.agentsFile': 'Global rules (AGENTS.md)',
  'panel.config.saved': 'Config saved. Refresh the page for newly enabled/disabled modules to take effect',
  'panel.config.failed': 'Failed: {message}',
  'panel.loading': 'Loading…',
}

/** Badge poll interval (ms). */
const BADGE_POLL_MS = 30_000

/**
 * The plugin entry: register locale and stylesheet, then the session memory
 * tab (default ON) with a red-dot pending count on its label. The former
 * settings-panel section (MemoryPanel) is gone — the tab now hosts the
 * suggestion/skill queues and the runtime config as sub-tabs. 'conversation'
 * is an ordering edge for the session memory tab (its 'conversation.view'
 * slot is declared by ui-conversation).
 * @param ctx - the client plugin context (`slots`, `locale` injected).
 */
/**
 * Mobile adaptation declaration (dsh-android-edapp adaptation protocol path B — `dshMobile` is the single source of truth).
 *
 * ## Protocol purpose
 * dsh-android-edapp (mobile adaptation plugin) phase 2 defines the "ADAPTER PROTOCOL" (
 * v1, docs: dsh-android-edapp/docs/ADAPTER-PROTOCOL.md): third-party plugins declare
 * a `dshMobile` field on their ./client export surface; dsh-android-edapp scans
 * `ctx.modules.loadCache` at boot and discovers lazily when this plugin materializes (page load / first UI use),
 * automatically wrapping the css in `@media (max-width: 767px)` and injecting it.
 * Field name `dshMobile` is the single source of truth — **do not rename**; export surface errors / missing field
 * are silently skipped and do not affect the plugin itself.
 *
 * ## Why on the export surface instead of injecting in apply()
 * The protocol lets dsh-android-edapp centrally discover and inject (including lifecycle /
 * ordering with the generic fallback layer); the plugin no longer injects mobile styles into <head> itself.
 * 2026-08-09 decision: the 9+1 Tab mobile adaptations for memory-evolve (~330 lines,
 * previously in dsh-android-edapp/src/client/mobile-tabs.css) were moved back into this plugin;
 * adaptation travels with the plugin — upgrades touch only this repo; dsh-android-edapp keeps only the shell + generic fallback
 * + adaptation manager.
 *
 * ## CSS authoring discipline (see src/client/mobile.css header)
 * Do not write @media (wrapped centrally by dsh-android-edapp); every selector must carry
 * the `html[data-dsh-mobile]` prefix; override layout/size only, not colors; rules opposite to the generic fallback
 * (mobile-fallback.css) must use !important to signal intent.
 */
export const dshMobile = {
  /** Mobile CSS fragment (string, inlined at build via esbuild --loader:.css=text). */
  css: mobileCss,
  /** Mobile DOM enhancement: input-bar bottom sheet (injects a "..." entry button + toggles
   * the data-dsh-mobile-sheet attribute; mobile.css renders .tools + model picker
   * as a fixed bottom bar; send/ring/... stay resident). Protocol: call once when
   * mobile mode activates, returns a dispose handle. */
  enhance: createInputSheetEnhance,
}

export const inject = ['slots', 'locale', 'conversation', 'sessions']

/**
 * Client plugin body: register the session memory tab when the host switch
 * is on (default ON; flipping it in the tab's runtime-config sub-tab takes
 * effect after a page reload).
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS) as unknown as Translate

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'memory-evolve: dictionaries')

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-memory-evolve-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.memoryEvolveCss = '1'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: stylesheet')

  // Skill-browser styles (merged from the standalone dsh-skill-browser
  // plugin): sb- prefixed, injected alongside the panel styles.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-skill-browser-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.skillBrowserCss = '1'
    tag.textContent = skillBrowserStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: skill browser stylesheet')

  // COI dispatch styles (coi- prefix, injected independently).
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-coi-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.coiCss = '1'
    tag.textContent = coiStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: coi stylesheet')

  // Session broadcast styles (bb- prefix, injected independently).
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-broadcast-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.broadcastCss = '1'
    tag.textContent = broadcastStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: broadcast stylesheet')

  // Prompt styles (pm- prefix, injected independently).
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-prompt-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.promptCss = '1'
    tag.textContent = promptStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: prompt stylesheet')

  // Web UI Settings styles (ui- prefix, injected independently). Styles alone have no side effects: filter rules
  // depend on html[data-dsh-ui-filter] (set after session-filter.ts activates);
  // no attribute = no effect — so styles are injected persistently (like other modules); the real switch
  // lives below: filter + tab activate only after probing /api/ui-settings/state succeeds.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-ui-settings-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.uiSettingsCss = '1'
    tag.textContent = uiSettingsStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: ui-settings stylesheet')

  // Mermaid rendering styles (me-mermaid- prefix, injected persistently). Styles alone have no side effects
  // (.me-mermaid-wrap appears only after the renderer replaces a code block), persistently injected like ui-settings;
  // real toggle lives below: after probing /api/ui-settings/state, enable/disable the observer per
  // the mermaidRender feature flag.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-me-mermaid-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.meMermaidCss = '1'
    tag.textContent = mermaidStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: mermaid stylesheet')

  // Session bookmark styles (bm- prefix, injected persistently). Styles are persistent with no side effects; real switch
  // lives below: star + Bookmarks tab register only after probing /api/bookmarks/state succeeds.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-bookmark-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.bookmarkCss = '1'
    tag.textContent = bookmarkStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: bookmark stylesheet')

  // Advisor floating panel styles (advisor- prefix): panel portals to body, so styles
  // must be injected persistently from the client entry, not tied to any conversation.view Tab lifecycle.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-advisor-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.advisorCss = '1'
    tag.textContent = advisorStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: advisor stylesheet')

  // In-app notification bell styles (me-notify- prefix): bell portals to body, styles must
  // be injected persistently from the client entry (like the Advisor panel, not tied to any Tab).
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const existing = document.querySelector('style[data-notify-css]')
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.notifyCss = '1'
    tag.textContent = notificationStyles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'memory-evolve: notification stylesheet')

  // In-app notification bell (top-right): probe host /api/notifications/unread — mount only on success
  // (mounted only when notifyEnabled exposes the API; 404 keeps the bell hidden).
  // "Jump to session" goes through DSH client sessions service ctx.sessions.open(sessionId)
  // (2026-08-13 research: the single official switch entry, same path as ui-workspace).
  let notifyBellCancelled = false
  let disposeNotifyBell: (() => void) | undefined
  void fetch('/memory-evolve/api/notifications/unread')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(() => {
      if (notifyBellCancelled) return
      disposeNotifyBell = createNotificationBell({
        openSession: (sessionId) => { ctx.sessions.open(sessionId) },
        t,
      }).dispose
    })
    .catch(() => { /* Notifications disabled: keep bell hidden */ })
  ctx.effect(() => () => {
    notifyBellCancelled = true
    disposeNotifyBell?.()
  }, 'memory-evolve: notification bell')

  // Conversation page top tab order (2026-08-11 decision: Memory / Skills / Todos / COI Dispatch / Broadcast
  // Prompts / Infinite Canvas / Memory Sync / Model Settings / Bookmarks / Web UI Settings / Maestro Memory Settings; order
  // steps by 10, leaving gaps):
  //   10 Memory / 20 Skills / 30 Todos / 40 COI Dispatch / 50 Broadcast / 60 Prompts /
  //   80 Infinite Canvas / 80 Memory Sync / 90 Model Settings / 100 Bookmarks / 110 Web UI Settings /
  //   120 Maestro Memory Settings
  // Each label carries its pending red-dot count (Memory=memory suggestions, Skills=skill suggestions,
  // Todos=todo suggestions); label re-evaluates on badge change via re-registration.
  let tabCancelled = false
  let memoryBadgeCount = 0
  // Version-check red dot (0/1): when a new release exists, the Settings tab label shows \uD83D\uDD34.
  // Independent from count badges — driven by the update field in /api/badge.
  let updateBadgeCount = 0
  let skillsBadgeCount = 0
  let todosBadgeCount = 0
  let disposeMemoryTab: (() => void) | undefined
  let disposeSkillsTab: (() => void) | undefined

  const registerMemoryTab = (): void => {
    disposeMemoryTab?.()
    disposeMemoryTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'memory-files',
        order: 10,
        label: () => (memoryBadgeCount > 0 ? t('memoryTab.label.pending', { count: memoryBadgeCount }) : t('memoryTab.label')),
      }, (props) => MemoryTabView({ ...props, t })))
  }
  const registerSkillsTab = (): void => {
    disposeSkillsTab?.()
    disposeSkillsTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'skills-hub',
        order: 20,
        label: () => (skillsBadgeCount > 0 ? t('skillsTab.label.pending', { count: skillsBadgeCount }) : t('skillsTab.label')),
      }, (props) => SkillsTabView({ ...props, t })))
  }
  // Todos tab lifecycle (todoEnabled runtime switch): enabled by default; after saving in the config panel,
  // it hides/restores instantly via RUNTIME_CONFIG_CHANGED without a page refresh.
  const todoTabLifecycle = createTodoTabLifecycle(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'todos-hub',
      order: 30,
      label: () => (todosBadgeCount > 0 ? t('todosTab.label.pending', { count: todosBadgeCount }) : t('todosTab.label')),
    }, (props) => TodosTabView({ ...props, t }))))
  const onRuntimeConfigChanged = (event: Event): void => {
    const detail = (event as CustomEvent<{ todoEnabled?: boolean }>).detail
    todoTabLifecycle.setEnabled(detail?.todoEnabled !== false)
  }
  window.addEventListener(RUNTIME_CONFIG_CHANGED, onRuntimeConfigChanged)
  ctx.effect(() => () => window.removeEventListener(RUNTIME_CONFIG_CHANGED, onRuntimeConfigChanged), 'memory-evolve: todo tab runtime listener')
  // Settings tab (Maestro Memory Settings, order 120 at the end): guide + config + version.
  // Red dot: when a new release is detected the label switches to the \uD83D\uDD34 variant (driven by updateBadgeCount, re-register
  // takes effect; one registration is enough when no dot, re-register only on badge change).
  let disposeSettingsTab: (() => void) | undefined
  const registerSettingsTab = (): void => {
    disposeSettingsTab?.()
    disposeSettingsTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'settings-hub',
        order: 120,
        label: () => (updateBadgeCount > 0 ? t('settingsTab.label.pending') : t('settingsTab.label')),
      }, (props) => SettingsTabView({ ...props, t })))
  }
  // Model Settings tab (order 90, after Bookmarks): table of DSH providers/models +
  // per-model enable/note/reasoning config (web surface for the de_models tool).
  // Independent switch modelsEnabled like other modules (on by default): toggled under Settings tab
  // -> Config; appears after refresh when on; hidden when off (host /api/models returns "disabled"
  // when the module is off).
  let disposeModelsTab: (() => void) | undefined
  const registerModelsTab = (): void => {
    disposeModelsTab?.()
    disposeModelsTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'models-hub',
        order: 90,
        label: () => t('modelsTab.label'),
      }, (props) => ModelsTabView({ ...props, t })))
  }
  // Memory Sync tab (order 80): follows the syncEnabled runtime switch
  // (appears after refresh when on, hidden when off).
  let disposeSyncTab: (() => void) | undefined
  const registerSyncTab = (): void => {
    disposeSyncTab?.()
    disposeSyncTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'memory-sync-hub',
        order: 80,
        label: () => t('syncTab.label'),
      }, (props) => SyncView({ ...props, t })))
  }
  const pollBadge = (): void => {
    // Do not poll before the three tabs are registered (registerMemoryTab signals probe success).
    if (tabCancelled || disposeMemoryTab === undefined) return
    void fetch('/memory-evolve/api/badge')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { suggestions?: number; skills?: number; todoSuggestions?: number; update?: number }) => {
        const suggestions = data.suggestions ?? 0
        const skills = data.skills ?? 0
        const todoSuggestions = data.todoSuggestions ?? 0
        // Version dot handled separately (not part of count semantics; badge cache is read-only, never triggers git).
        const update = data.update ?? 0
        if (update !== updateBadgeCount) {
          updateBadgeCount = update
          registerSettingsTab()
        }
        if (suggestions !== memoryBadgeCount) {
          memoryBadgeCount = suggestions
          registerMemoryTab()
        }
        if (skills !== skillsBadgeCount) {
          skillsBadgeCount = skills
          registerSkillsTab()
        }
        if (todoSuggestions !== todosBadgeCount) {
          todosBadgeCount = todoSuggestions
          todoTabLifecycle.refresh()
        }
      })
      .catch(() => { /* badge is best-effort; the tab still works */ })
  }

  void fetch('/memory-evolve/api/config')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: { config?: { memoryTabEnabled?: boolean; modelsEnabled?: boolean } }) => {
      // Model Settings tab: follows modelsEnabled runtime switch (on by default, like other modules)
      // independent switch toggled under Settings -> Config; appears after refresh when on).
      if (!tabCancelled && data.config?.modelsEnabled === true && disposeModelsTab === undefined) {
        registerModelsTab()
      }
      // Memory Sync tab: follows syncEnabled runtime switch (off by default, enabled via Settings panel / command)
      // appears after refresh once enabled)
      if (!tabCancelled && data.config?.syncEnabled === true && disposeSyncTab === undefined) {
        registerSyncTab()
      }
      // memoryTabEnabled is a read-only field of /api/config (default true;
      // only config.yaml can turn it off — deliberately NOT a runtime key,
      // since switching it off from inside the tab would hide the tab itself).
      if (tabCancelled || data.config?.memoryTabEnabled !== true) return
      // Register the four core tabs together: Memory / Skills / Todos / Settings (order 10/20/30/120).
      // Todos tab is additionally gated by the todoEnabled runtime switch (on by default; hidden when off).
      registerMemoryTab()
      registerSkillsTab()
      todoTabLifecycle.setEnabled(data.config?.todoEnabled !== false)
      registerSettingsTab()
      pollBadge()
      const timer = setInterval(pollBadge, BADGE_POLL_MS)
      ctx.effect(() => () => clearInterval(timer), 'memory-evolve: memory tab badge poller')
      // Version check: one lazy check on entering the Web UI (skip git within the 24h cache).
      // On completion sync updateBadgeCount + re-register immediately (30s polling is too slow);
      // badge-change listener is already registered; later VersionTabView actions go through the event channel.
      void fetch('/memory-evolve/api/update/status')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data: { ok?: boolean; status?: string }) => {
          if (tabCancelled) return
          const hasUpdate = data?.status === 'outdated' ? 1 : 0
          if (hasUpdate !== updateBadgeCount) {
            updateBadgeCount = hasUpdate
            registerSettingsTab()
          }
        })
        .catch(() => { /* best-effort: keep no dot on check failure; version sub-tab can retry manually */ })
      // The tab's own queue actions (approve/archive/reject skills too) fire
      // this event after a mutation — re-poll immediately so the red-dot
      // label updates without waiting for the next 30s poll.
      const onTabChanged = (): void => pollBadge()
      window.addEventListener('maestro-memory:badge-change', onTabChanged)
      ctx.effect(() => () => window.removeEventListener('maestro-memory:badge-change', onTabChanged), 'memory-evolve: memory tab badge listener')
    })
    .catch(() => { /* the tab is optional; a failure just leaves it hidden */ })
  ctx.effect(() => () => {
    tabCancelled = true
    disposeMemoryTab?.()
    disposeSkillsTab?.()
    todoTabLifecycle.dispose()
    disposeSettingsTab?.()
  }, 'memory-evolve: memory tabs')

  // Memory Sync tab cleanup (registration happens after probing /api/config;
  // registerSyncTab already removes the old slot on re-register; this covers plugin unload —
  // P1-2 review: without it the Sync tab slot leaks on unload/hot-reload).
  ctx.effect(() => () => {
    disposeSyncTab?.()
  }, 'memory-evolve: sync tab')

  // Model Settings tab cleanup (registration happens after probing /api/config —
  // same independent switch modelsEnabled as other modules).
  ctx.effect(() => () => {
    disposeModelsTab?.()
  }, 'memory-evolve: models tab')

  // COI Dispatch tab (second conversation.view slot): probe the host COI API
  // and register only if it exists (coiEnabled=false yields 404 and the tab stays hidden). Label carries a red dot
  // count: when running/queued tasks exist (filtered by current session visibility) it shows "\uD83D\uDD34 COI Dispatch (N)"
  // — poll task list every 30s + listen for badge-change (refresh immediately after dispatch);
  // re-register on count change so the label re-evaluates (same mechanism as Memory/Skills/Todos tabs).
  let coiCancelled = false
  let disposeCoiTab: (() => void) | undefined
  let coiRunningCount = 0
  /** Current session id: cached when the COI tab renders (basis for task visibility filtering). */
  let currentCoiSessionId: string | undefined

  const registerCoiTab = (): void => {
    disposeCoiTab?.()
    disposeCoiTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'coi-hub',
        order: 40,
        label: () => (coiRunningCount > 0 ? t('coiTab.label.pending', { count: coiRunningCount }) : t('coiTab.label')),
      }, (props) => {
        currentCoiSessionId = (props as { sessionId?: string }).sessionId
        return CoIView({ ...props, t })
      }))
  }

  const pollCoiRunning = (): void => {
    if (coiCancelled || disposeCoiTab === undefined) return
    // Query with session perspective (same rules as the task list: temporary/session=this session, project=this
    // workspace, global=all); limit raised to 200 — running tasks cannot exceed it.
    const q = currentCoiSessionId !== undefined
      ? `?limit=200&sessionId=${encodeURIComponent(currentCoiSessionId)}`
      : '?limit=200'
    void fetch(`/memory-evolve/api/coi/tasks${q}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { tasks?: Array<{ status?: string }> }) => {
        const running = (data.tasks ?? []).filter((t) => t.status === 'running' || t.status === 'queued').length
        if (running !== coiRunningCount) {
          coiRunningCount = running
          registerCoiTab()
        }
      })
      .catch(() => { /* Red dot is best-effort; the tab itself is unaffected */ })
  }

  void fetch('/memory-evolve/api/coi/config')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(() => {
      if (coiCancelled) return
      registerCoiTab()
      pollCoiRunning()
      const coiTimer = setInterval(pollCoiRunning, BADGE_POLL_MS)
      ctx.effect(() => () => clearInterval(coiTimer), 'memory-evolve: coi tab badge poller')
      // Re-check the red dot immediately after dispatch / task status changes (CoIView fires badge-change).
      const onCoiBadgeChange = (): void => pollCoiRunning()
      window.addEventListener('maestro-memory:badge-change', onCoiBadgeChange)
      ctx.effect(() => () => window.removeEventListener('maestro-memory:badge-change', onCoiBadgeChange), 'memory-evolve: coi tab badge listener')
    })
    .catch(() => { /* COI disabled: keep tab hidden */ })
  ctx.effect(() => () => {
    coiCancelled = true
    disposeCoiTab?.()
  }, 'memory-evolve: coi tab')

  // Advisor occupies only strict-session header.actions: the same component renders the header toggle
  // and portals the floating panel via createPortal(document.body); it must not register a conversation.view Tab.
  // Dispose registration (P1-1 review): remove the slot on plugin unload / hot-reload,
  // otherwise AdvisorHost polling would keep hitting /events after the UI is gone.
  let disposeAdvisor: (() => void) | undefined
  disposeAdvisor = ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'advisor-review-panel',
      order: 30,
    }, (props) => AdvisorHost({ ...props, t })))
  ctx.effect(() => () => {
    disposeAdvisor?.()
  }, 'memory-evolve: advisor panel')

  // DSH reconnects change the host in-memory ring / connection generation; after converting to a browser event,
  // each session store cancels the old request, clears the after cursor and immediately re-syncs.
  ctx.effect(() => ctx.on('connection/reset', () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ADVISOR_CONNECTION_RESET_EVENT))
  }), 'memory-evolve: advisor connection reset')

  // Session identity: header "⧉ Copy session ID" / "✎ Alias" buttons — **belong to session
  // orchestration / identity** (2026-08-09 decision: not a broadcast feature; moved from broadcastEnabled
  // to sessionEnabled). The user copies the current session ID/alias to another session
  // and the other AI broadcasts via de_broadcast or orchestrates via de_session; the broadcast panel has its own
  // "My session ID — copy" at the top, so copying works even with broadcast off and orchestration on.
  let sessionHeaderCancelled = false
  let disposeCopyId: (() => void) | undefined
  void fetch('/memory-evolve/api/config')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: { config?: { sessionEnabled?: boolean } }) => {
      if (sessionHeaderCancelled || data.config?.sessionEnabled !== true) return
      // Header actions is a strict-session slot: the entry component automatically receives sessionId.
      disposeCopyId = ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'copy-session-id',
          order: 0,
        }, (props) => HeaderActions({ ...props, t })))
    })
    .catch(() => { /* Session orchestration disabled: keep header buttons hidden */ })
  ctx.effect(() => () => {
    sessionHeaderCancelled = true
    disposeCopyId?.()
  }, 'memory-evolve: session header buttons')

  // Session Broadcast management tab (conversation.view): follows broadcastEnabled — probe
  // /memory-evolve/api/broadcast and register only if present (404 when disabled, tab stays hidden).
  let broadcastTabCancelled = false
  let disposeBroadcastTab: (() => void) | undefined
  void fetch('/memory-evolve/api/broadcast/messages')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(() => {
      if (broadcastTabCancelled) return
      disposeBroadcastTab = ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({
          name: 'conversation.view',
          id: 'broadcast-hub',
          order: 50,
          label: () => t('broadcastTab.label'),
        }, (props) => BroadcastView({ ...props, t })))
    })
    .catch(() => { /* Broadcast disabled: keep tab hidden */ })
  ctx.effect(() => () => {
    broadcastTabCancelled = true
    disposeBroadcastTab?.()
  }, 'memory-evolve: broadcast tab')

  // Web UI Settings module (dsh-ui-settings): **independent submodule**. Probe host
  // /api/ui-settings/state (uiSettingsEnabled switch, off by default) — on success:
  //  Web UI Settings module (dsh-ui-settings): **independent submodule**. Probe host
  //  /api/ui-settings/state (uiSettingsEnabled switch, off by default) — on success:
  //   1. Activate features (global DOM enhancements, independent of any tab):
  //      - Session filter (session-filter.ts: filter bar + MutationObserver keep-alive +
  //        localStorage preference, showing only active sessions by default);
  //      - Wide conversation (wide-chat.ts: --dsh-chat-content-width override);
  //      Each feature has an **independent switch** ("General" sub-tab, localStorage + event
  //      broadcast): apply initial state via readFeatures(), sync instantly on FEATURES_EVENT;
  //   2. Register the "Web UI Settings" tab (conversation.view, General/Guide).
  //  When the module is off (404), nothing is injected; cleanup effect unloads everything.
  let uiSettingsCancelled = false
  let disposeUiSettingsTab: (() => void) | undefined
  let disposeSessionFilter: (() => void) | undefined
  let disposeWideChat: (() => void) | undefined
  let disposeWideBubble: (() => void) | undefined
  let disposeContextMeterWarn: (() => void) | undefined
  let disposeMermaidRender: (() => void) | undefined
  void fetch('/memory-evolve/api/ui-settings/state')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: { enabled?: boolean }) => {
      if (uiSettingsCancelled || data.enabled !== true) return
      // 1. Create feature controllers (create first, then setEnabled per switch).
      const sessionFilter = createSessionFilter({
        barTitle: t('uiSettings.feature.sessionFilter'),
        on: t('uiSettings.filter.on'),
        off: t('uiSettings.filter.off'),
        runningLabel: t('uiSettings.running.label'),
        ungroupedLabel: t('uiSettings.ungrouped'),
      })
      disposeSessionFilter = sessionFilter.dispose
      const wideChat = createWideChat()
      disposeWideChat = wideChat.dispose
      const wideBubble = createWideBubble()
      disposeWideBubble = wideBubble.dispose
      const contextMeterWarn = createContextMeterWarn()
      disposeContextMeterWarn = contextMeterWarn.dispose
      const mermaidRenderer = createMermaidRenderer()
      disposeMermaidRender = mermaidRenderer.dispose
      // Apply initial state from the "General" sub-tab independent switches.
      const features = readFeatures()
      sessionFilter.setEnabled(features.sessionFilter)
      wideChat.setEnabled(features.wideChat)
      wideBubble.setEnabled(features.wideBubble)
      contextMeterWarn.setEnabled(features.contextWarn)
      mermaidRenderer.setEnabled(features.mermaidRender)
      // Switch-change events (broadcast after UiSettingsTabView toggles) -> sync injection instantly.
      const onFeaturesChanged = (event: Event): void => {
        const next = (event as CustomEvent<ReturnType<typeof readFeatures>>).detail
        if (next === undefined) return
        sessionFilter.setEnabled(next.sessionFilter)
        wideChat.setEnabled(next.wideChat)
        wideBubble.setEnabled(next.wideBubble)
        contextMeterWarn.setEnabled(next.contextWarn)
        mermaidRenderer.setEnabled(next.mermaidRender)
      }
      window.addEventListener(FEATURES_EVENT, onFeaturesChanged)
      ctx.effect(() => () => window.removeEventListener(FEATURES_EVENT, onFeaturesChanged), 'memory-evolve: ui-settings features listener')
      // 2. Register the "Web UI Settings" tab.
      disposeUiSettingsTab = ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({
          name: 'conversation.view',
          id: 'ui-settings-hub',
          order: 110,
          label: () => t('uiSettingsTab.label'),
        }, (props) => UiSettingsTabView({ ...props, t })))
    })
    .catch(() => { /* Web UI Settings disabled: inject nothing */ })
  ctx.effect(() => () => {
    uiSettingsCancelled = true
    disposeUiSettingsTab?.()
    disposeSessionFilter?.()
    disposeWideChat?.()
    disposeWideBubble?.()
    disposeContextMeterWarn?.()
    disposeMermaidRender?.()
  }, 'memory-evolve: ui-settings tab')

  // Prompts tab (fourth conversation.view entry): Prompt Manager. Follow host
  // API probe to register (prompts is a permanent plugin capability, no independent switch). Label carries a red-dot
  // count: shows "\uD83D\uDD34 Prompts (N)" when active injections exist — poll injection track every 30s + listen
  // for badge-change (PromptView fires immediately after inject/stop) to refresh.
  let promptCancelled = false
  let disposePromptTab: (() => void) | undefined
  let promptBadgeCount = 0
  const registerPromptTab = (): void => {
    disposePromptTab?.()
    disposePromptTab = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'prompt-hub',
        order: 60,
        label: () => promptBadgeCount > 0
          ? t('promptTab.label.active', { count: promptBadgeCount })
          : t('promptTab.label'),
      }, (props) => PromptView({ ...props, t })))
  }
  const pollPromptBadge = (): void => {
    if (promptCancelled || disposePromptTab === undefined) return
    void fetch('/memory-evolve/api/prompts/injections')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { injections?: unknown[] }) => {
        const count = data.injections?.length ?? 0
        if (count !== promptBadgeCount) {
          promptBadgeCount = count
          registerPromptTab()
        }
      })
      .catch(() => { /* badge is best-effort; the tab still works */ })
  }
  void fetch('/memory-evolve/api/prompts/sources')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(() => {
      if (promptCancelled) return
      registerPromptTab()
      pollPromptBadge()
      const promptBadgeTimer = setInterval(pollPromptBadge, BADGE_POLL_MS)
      ctx.effect(() => () => clearInterval(promptBadgeTimer), 'memory-evolve: prompt tab badge poller')
      const onPromptBadgeChange = (): void => pollPromptBadge()
      window.addEventListener('maestro-memory:badge-change', onPromptBadgeChange)
      ctx.effect(() => () => window.removeEventListener('maestro-memory:badge-change', onPromptBadgeChange), 'memory-evolve: prompt tab badge listener')
    })
    .catch(() => { /* Host unavailable: keep tab hidden */ })
  ctx.effect(() => () => {
    promptCancelled = true
    disposePromptTab?.()
  }, 'memory-evolve: prompt tab')

  // Session bookmarks (session bookmarks): **independent submodule**. Probe host
  // /api/bookmarks/state (bookmarkEnabled switch, off by default) — on success:
  //   1. Star-button DOM injector (plan B, decision: **do not occupy** conversation.chat.
  //      turnTail chain slot — that slot is mutually exclusive with the official produced-files line (first-wins),
  //      occupying it would squeeze out the official "generated files" row; instead use a MutationObserver to attach
  //      the star next to the turn-tail action area; the official row is preserved and both coexist);
  //   2. Session-id capturer (a hidden entry in the conversation.session.header.actions list slot:
  //      entry: strict-session slot automatically carries sessionId; render null for zero UI, just
  //      write the current session id into a module variable for the injector — DOM injection cannot read the id);
  //   3. Register the "Bookmarks" tab (conversation.view, list + jump + guide).
  // When off, the endpoint is 404 and nothing is injected on the client.
  let bookmarkCancelled = false
  let disposeBookmarkTab: (() => void) | undefined
  let disposeBookmarkCapture: (() => void) | undefined
  let disposeBookmarkInjector: (() => void) | undefined
  let currentBookmarkSessionId = '' // written by the capturer, read on injector click
  let bookmarkInjectorStarted = false // guard against duplicate creation (capturer may render multiple times)
  void fetch('/memory-evolve/api/bookmarks/state')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: { enabled?: boolean }) => {
      if (bookmarkCancelled || data.enabled !== true) return
      // 1. Session-id capturer (header.actions is a list slot, coexists with official/other plugin buttons).
      disposeBookmarkCapture = ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'bookmark-session-catcher',
          order: 100, // end: hidden entry, zero UI
        }, (props) => {
          // strict-session slot: props carry sessionId.
          const sid = (props as { sessionId?: string }).sessionId
          if (typeof sid === 'string' && sid !== '') currentBookmarkSessionId = sid
          // Start the injector after capturing the id (lazy start, ensures getSessionId is readable).
          if (!bookmarkInjectorStarted) {
            bookmarkInjectorStarted = true
            disposeBookmarkInjector = createBookmarkInjector(
              () => currentBookmarkSessionId,
              { t },
            ).dispose
          }
          return null // render no UI
        }))
      // 2. "Bookmarks" tab (order 100: after Model Settings 90, before Web UI Settings 110).
      disposeBookmarkTab = ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({
          name: 'conversation.view',
          id: 'bookmarks-hub',
          order: 100,
          label: () => t('bookmarkTab.label'),
        }, (props) => BookmarksView({ ...props, t })))
    })
    .catch(() => { /* Bookmarks disabled: inject nothing */ })
  ctx.effect(() => () => {
    bookmarkCancelled = true
    disposeBookmarkInjector?.()
    disposeBookmarkCapture?.()
    disposeBookmarkTab?.()
  }, 'memory-evolve: bookmarks')

  // Infinite canvas (canvas-hub): frontend phase-1 Grok implementation (2026-08-13 decision).
  // cg- prefix. Registration params id: canvas-hub / label: Canvas / order: 80 (final).
  // ctx asserted as CanvasTabHost: cordis Context type lacks slots (existing project type
  // limitation; all slots calls share the same origin), injected at runtime by the client runtime.
  // openSession (2026-08-14): footer "Jump" button navigates to the owning session —
  // same path as the web notification bell ctx.sessions.open(sessionId) (the single official
  // switch entry).
  // ⚠️ 2026-08-14 fix: tab registration must follow the canvasEnabled switch (like bookmarks
  // probe mode) — previously registered unconditionally, so the tab remained when the switch was off (only backend
  // sync was off), violating the expectation that "off = canvas invisible"; now it probes
  // /api/canvas/state (200 {enabled:true} when on); when off,
  // the endpoint is 404 and the tab is not injected at all.
  let canvasCancelled = false
  let disposeCanvasTab: (() => void) | undefined
  void fetch('/memory-evolve/api/canvas/state')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: { enabled?: boolean }) => {
      if (canvasCancelled || data.enabled !== true) return
      disposeCanvasTab = registerCanvasTab(
        ctx as unknown as import('./canvas-grok/index.ts').CanvasTabHost,
        { t, openSession: (sessionId) => { ctx.sessions.open(sessionId) } },
      )
    })
    .catch(() => { /* Canvas disabled: inject nothing */ })
  ctx.effect(() => () => {
    canvasCancelled = true
    disposeCanvasTab?.()
  }, 'memory-evolve: canvas-tab')
}
