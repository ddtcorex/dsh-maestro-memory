# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Versioned whole-store repair** (`storage/repair.ts`, `memory/repair-runner.ts`, endpoint
  `memory.repair`) — a pure planner splits entries glued without the `§` delimiter, drops exact
  duplicates and moves a trailing `[summary:…]` to its canonical header position. A boot pass
  (`delimiter-repaired-v3`) applies it to every store file; the v1 pass covered `KEY.md` only, which
  is why the global `MEMORY.md` kept a glued duplicate that consumed the whole `# Global Memory`
  section and pushed a hard rule out of every prompt. Measured on the live store: **480 redundant
  entries across 38 files**, and 111 of 150 `KEY.md` entries carrying an unreadable summary tag.
- **`memory.maintenance`** — a preview-first archive planner (`memory/maintenance.ts`). Oldest
  entries beyond a track's keep-bytes or max-age move to the track's `*-archive.md`; `dryRun`
  defaults to true and `confirm: true` is required to write. Live preview: `key` 149 → 38 live
  entries (106 KB archived), `project` 870 → 209 (267 KB).
- **Snapshot cost statistics** (`cost-tracker.ts`) — per-section bytes, entry counts, excluded-entry
  counts and truncations, reported as `cost` on `/dsh-maestro-memory-health`. Baseline before this
  existed: 25.9 MB of memory text injected across 1,300 sessions, median 12.6 KB per render, largest
  single session 1.76 MB.

### Changed
- **Section caps are hard in both dimensions** — each section now has an entry budget
  (`SNAPSHOT_SECTION_MAX_ENTRIES`), and an untagged entry larger than twice its byte cap is
  truncated with an explicit marker instead of silently owning the section.
- **`daily` entries carry `[summary:…]`** — the exemption made the smallest section (512 B) the only
  one that could not compact.
- **One entry-body predicate** (`entryBodyKey`) shared by `add()`, the file guard and the sync
  merge. `isDuplicate()` now strips `[summary:…]` as well as `[id:…]` — the file-level guard was
  strictly weaker than its caller.
- `add()` reports the final stored text as `entry`, so a caller that must undo a write has a token
  that actually matches what was written.

### Fixed
- **Auto-summaries were unreadable to the compactor.** `ensureAutoSummary` appended `[summary:…]` at
  the END of an entry, but the grammar — and `parseEntrySummary`, `stripEntrySummary`,
  `compactToHead` — only reads the tag at the header position. Every auto-summarized entry was
  therefore un-compactable: the 512 B `# Recent Daily` section rendered 1,518 B and the global
  section 2,303 B against a 2,048 B cap. New writes insert the tag after the header; repair
  relocates existing ones.
- **The sync merge re-created duplicates on every sync.** `merge.ts`'s `contentHash()` stripped only
  `[id:…]`, so an entry and its summary-tagged twin hashed differently and the union merge kept both
  (480 redundant entries across 38 files after the 2026-09-14 two-machine sync). It now uses the
  shared body predicate.
- **A `§` glued to content is now repaired on every track.** The v1 KEY-only boot pass was a silent
  no-op — it was called with a bogus cwd, so it resolved `projects/<sha1('')>/KEY.md`, found nothing and
  returned `{repaired: 0}` — and `repairKeyDelimiter()` now aliases `repairFile()` instead of carrying a
  second copy of the split logic. It also reports entries *recovered* rather than the file's total entry
  count, which made a no-op on a clean file look like a 2-entry repair.
- **`applyBatch` rollback missed entries.** It removed by matching the caller's raw content as a
  substring of the stored entry, which stops matching once the summary tag moves to the header; the
  batch now removes by the final stored text `add()` reports.

### Removed
- **`pruneGlobalMemory()`** — unused, and it fitted the live global file to the snapshot cap by
  **dropping** the overflow. It also carried a second `fitSection` that disagreed with the
  renderer's. Archiving (`memory.maintenance`) keeps those entries queryable instead.

## [2.0.0] - 2026-09-14

### Changed
- **BREAKING — the durable todo tool is renamed `maestro_todo`** (#52). The tool
  was `dtodo`, and there is no alias: any existing prompt, preset, or doc that
  still refers to `dtodo` must be updated, or the durable store becomes
  unreachable from it. Two different "Todos" reached the model in one session —
  the harness's own in-session plan `todo_write` and this plugin's durable
  cross-session store — and neither description said what it was *not*, so the
  model had to guess: a real todo could land in a throwaway session list while
  the agent's own plan landed in the human's store. The tool's description now
  opens with what it is and names `todo_write`, a new `memory:task-systems`
  prompt context names both systems on every turn, and the Memory view tab reads
  `Todo store` instead of `Todos`.
- **Docs corrected against the code** (#48, #49) — `lib/` is documented as
  gitignored build output that has to be refreshed locally (a `link:` install
  loads it from disk) rather than committed, and the hard-coded suite counts are
  gone from `AGENTS.md`, `CONTRIBUTING.md`, and `README.md`: a count written
  into a doc goes stale on the very next test.

### Fixed
- **The Memory tab keeps its own 13px scale on iOS** (#51, correcting #50) — the
  mobile plugin holds every text field on the page at a 16px floor under
  `html[data-mobile-nav-ios]`, which left the tab's placeholders and typed text
  3px larger than the cards and labels around them. The panel now opts its own
  `input`/`textarea`/`select` out of that floor instead of raising the whole
  panel to 16px. Accepted trade-off: iOS magnifies the visual viewport while one
  of these fields has focus — the behaviour the floor exists to prevent. Desktop
  and touch-Android were never affected and keep the 13px design.

### Removed
- **`storage/legacy-format.ts`** (#53) — a duplicate left over from before the
  `src/host` reorg: nothing imported it, and both tsconfigs compile only
  `src/host/**` and `src/client/**`, so it was dead code that still carried a
  stale copy of the entry grammar (including the retired tool name).

## [1.3.0] - 2026-09-12

### Added
- **Per-turn write watchdog** (`src/host/memory/write-guard.ts`, opt-in via `config.writeGuard`) — counts consecutive human turns in which no `daily`/`project` entry was written, and escalates in the snapshot once the gap reaches `threshold` (default 2). Long sessions gradually dilute the fixed end-of-turn discipline note, and a missed write used to be dropped silently; the watchdog tracks compliance on the program side so the snapshot itself escalates until the model writes.
  - Counts only turns opened by a direct human prompt — goal-continuation rounds (`source.kind === 'goal'`) and injected context (`'plugin'`, e.g. wake notices) carry no per-turn duty.
  - Counts only turns that **dispatched at least one tool call**. A turn that merely answered a question did no work, so no debt accrues: without this gate the watchdog fired on ordinary question/answer exchanges and pressured the model into writing filler entries — exactly what the discipline note forbids ("never write entries containing only 'Idle' or placeholders"). `readTurnFacts(agent)` reads origin and tool activity from the session log in one scan.
  - `noteWrite` marks the turn and the reset happens at `turn-stopping`, never at write time: resetting mid-turn would count the writing turn itself as a gap and misfire on every healthy turn.
  - Only a write that actually recorded something discharges the duty — a deduplicated add does not — so `applyBatch` now reports which entries it really added.
  - The listener is registered through `ctx.effect` and isolates every error: a pacing aid must never fail a turn.
  - In-memory only; a host restart clears gaps.
- **Write-backlog snapshot alert** — a `# ⚠️ Memory Write Backlog` section rendered immediately before the end-of-turn discipline note, which stays the snapshot's final instruction. Its text is static (threshold only, never the live count), so one open gap costs at most two tail snapshots: appear, then disappear.
- **Manual add composer in the Memory tab** — each track now has an add box posting to the existing `memory.mutate` RPC (`action: 'add'`), so recording a durable fact no longer needs a model round-trip. Drafts are bucketed per track, and the button stays disabled while the entry is empty or while `key`/`project` has no cwd.

### Changed
- **Subagent sessions get a per-achievement cadence** — a subagent reports to a parent session rather than to the human, so its snapshot now carries a restrained turn-end note (one entry per independent achievement, nothing when there is nothing to report) instead of the per-turn duty, and never the backlog alert. The shared memory context (MEMORY / USER / KEY / Project Context) is still injected.
- `config.writeGuard` is resolved once at `apply()` time; a threshold below 1 reads as 1 rather than disabling the watchdog or firing on every turn.

### Fixed
- Removed a stale upstream repository name from `AGENTS.md` (public-doc hygiene).

## [1.2.5] - 2026-09-05

### Fixed
- **KEY.md delimiter** — repaired malformed `§\n` delimiters; 19 invariant entries now readable in snapshot via `repairKeyDelimiter(cwd)` one-time migration.
- **Global memory corruption recovery** — restored `MEMORY.md` from sync remote after accidental `pruneGlobalMemory()` removed 4 of 5 entries during testing.
- **Discipline note** — updated to match actual write behavior (daily-only + `memory_suggest target=key` for decisions; removed `project` reference).
- **User Memory** — auto-bootstrap from session context when `USER.md` missing/empty.

### Added
- **REFERENCE.md slice in snapshot** — bounded `# Project Knowledge` section (2048 bytes cap) injects curated project reference.
- `MaestroMemoryStore.repairKeyDelimiter(cwd)` — one-time repair for legacy `§\n` delimiters in KEY.md.
- `MaestroMemoryStore.pruneGlobalMemory()` — keeps newest entries fitting 2048-byte snapshot cap.
- `projectReferencePath(root, cwd)` resolver in storage layout.
- `MaestroMemoryStore.resolveRoot()` — public accessor for memories root.

### Changed
- `renderSnapshot` now includes `# Project Knowledge` from REFERENCE.md and auto-creates `USER.md` from session context.
- Discipline note updated to `Write daily via memory entries` + `memory_suggest target=key` for decisions.

## [1.2.4] - 2026-09-02

### Fixed

- **Auto scroll** — prevent auto scroll down when clicking Memory tab (#37).


## [1.2.3] - 2026-08-31

### Fixed

- **Memory tab overlay bleed (3)** — `viewArea` bumped to `z-index:9` and `widthHandle` (`z-index:8`) hidden via `:has(.memx) {display:none}` + JS fallback on mount/unmount so Memory fully covers chat transcript; hover glow no longer bleeds through. Keeps flex layout so composer remains visible below. Verify 268/268 green.

## [1.2.2] - 2026-08-30

### Fixed

- **Memory tab overlay bleed (2)** — add `contain: paint` + `overflow:hidden` to `[class*="viewArea"]`/`[data-slot="conversation.view"]`/`[data-slot="conversation.session"]` and `.memx`, force `.memx` `background !important` + `z-index:2`, `pointer-events:auto`, `overflow-x:clip`/`overflow-y:auto` so hover no longer leaks to chat/composer/widthHandle behind.
- **Mobile tab content overlap** — `.memx` now `box-sizing:border-box` + `max-width:100%`/`overflow-wrap`, `.memx-layout`/`memx-panel`/`memx-grid`/`memx-card`/`memx-form` all `min-width:0` + `max-width:100%`, `grid-template-columns:200px minmax(0,1fr)`, `formrow` flex `1 1 0`, mobile `@1023px` forces `1fr` + `min-width:0`, `@480px` stacks `memx-field`. Fixes right-side overlap on 375px (verify 268/268 green).

## [1.2.1] - 2026-08-30

### Fixed

- **Memory tab overlay bleed** — `conversation.view` content now fully opaque over chat. `.memx` gets `background: var(--dsw-alias-bg-base)`, `isolation: isolate`, `z-index:1`, `min-height:100%` + `flex:1`, parent `[data-slot="conversation.view"]` forced opaque; inline `style` also carries bg/isolation to cover slot gaps that leaked chat hover effects.

## [1.2.0] - 2026-08-29

### Added

- **Memory tab redesign** (`src/client/index.tsx`, maestro-design Minimalism + Bento Grid, DSH tokens only). Desktop `200px nav rail + bento` (`≥1024px`), mobile horizontal `tablist` with `44px` touch, safe-area insets, `header` Refresh inline with title.

### Changed

- Align `memx-layout`/`memx-nav` breakpoint to `1024px` (match `dsh-maestro-mobile` `1023px` drawer), fix `memx-search`/`memx-field` `min-width:0` overflow on 375px.

### Fixed

- Client a11y: `prefers-reduced-motion` typo (`.card` → `.memx-card` + badge), `search:focus-within` ring, `aria-label` on cwd/todo/review inputs, `role=tablist/tab/tabpanel` with `aria-selected`.
- Host `renderSnapshot` Recent Daily timezone: use local calendar (`getMonth/getDate`) instead of UTC `toISOString` to match `store.todayStamp` (fixes midnight ICT flake, 268/268 green).

## [1.1.0] - 2026-08-29

Adopts proven mechanisms from `FuRongJun-1999/dsh-memory` in file-native form (no Python). Live-validated in chat, 268 tests.

### Added

- **Desensitize sanitizer** (`src/host/memory/sanitize.ts`, 7 patterns: `sk-`, `api_key`, `password`, `Bearer`, `ID`, `phone` with English `[Filtered:...]`; pure-credential → `content filtered`).
- **Opt-in auto-memory hook** (`src/host/auto-memory.ts`, `config.autoMemory`, `session/event` → project/daily, desensitize + dedupe, default `enabled:false`).
- **Snapshot auto-recall top-4** (`src/host/prompt/snapshot.ts`, new `Project Context` section, newest 4 project entries 600 chars each, cap `autoRecall:1024`, keeps `recentDaily:512`).
- **Concurrency + abort gating** (`READ_ACTIONS`, `isMemoryConcurrencySafe`, `isConcurrencySafe` for `memory`/`dtodo`/`memory_suggest` + `signal.aborted` checks).
- **Health 5-dim scoring** (`src/host/health-score.ts`, `S/R/J/C/Safety` 0-10, `composite = min*0.4+mean*0.6`, client `HealthView` 5 cards).

### Changed

- `store.add` desensitizes by default (`{desensitize:false}` to opt-out for tests).
- Snapshot caps now `2K/4K/6K+0.5K+1K` (autoRecall) with bounded `Project Context`.

## [1.0.1] - 2026-08-25

Fix a live gap in the `memory` tool: the `daily` track only honored an explicit
`date` for `add`/`list`, so an entry on an older day could never be removed or
edited through the tool (it always targeted today's file). Verified on a real
session after restart.

### Fixed

- **`date` now applies to `remove`/`replace` on the `daily` track.** The store
  methods accept an optional `{ date }` and thread it through
  `fileFor(target, cwd, date)`, and the host tool `execute` + `memory.mutate`
  RPC pass it through. A non-`YYYY-MM-DD` value returns an error via the
  existing `dailyPath` → `assertDate` guard.
- Updated the `date` schema description to cover add/list/replace/remove.

### Notes

- TDD regression tests added in `tests/memory-m2.spec.ts`; full suite 202 pass,
  `pnpm run build` / `pnpm run verify` green.

## [1.0.0] - 2026-08-24

Initial release of `@ddtcorex/dsh-maestro-memory`, a from-scratch TypeScript
rebrand of `dsh-memory-evolve` that runs as a DeepSeek Harness plugin and
preserves the existing `~/.dsh/memories` files in place.

### Added

- **Memory tool (`memory`)** across five durable tracks: global `memory`,
  `user`, per-project `key` / `project`, and date-stamped `daily`. Entries are
  stored verbatim in the same `§`-delimited layout as the legacy files; archived
  entries split to `*-archive.md`.
- **Todos tool (`dtodo`)** across `life` / `work` / `project` / `daily` with a
  bounded 8-item smart view, category and quadrant fields, and a per-day
  `YYYY-MM-DD.todo.md` file.
- **`memory_suggest` tool** (confirmation-gated): proposals are queued in
  `SUGGESTIONS.jsonl` and only written to memory after explicit user approval.
- **`memory:snapshot` system-prompt context** at configurable `snapshotOrder`
  (default 500): injects session-id header, global + current-project `KEY`,
  the end-of-turn daily/project write discipline, and the todos reminder.
- **In-place adoption migration** (`scripts/migrate.mjs`, RPC
  `migration.*`): read-only `inspect` → `--apply` backs up a SHA-256 manifest
  and adopts `schema.json`; `--verify` compares digests and blocks writes on
  drift via `write-block.json`; `rollback(root, runId)` restores byte-identical
  files.
- **Confirmation-gated review queue** (`queue.*`): review decisions are queued
  and applied via an explicit, user-facing decision flow; the review tool is
  registered dynamically and only when the runtime switch is on.
- **Read-first skills browser** (`skills.list`, host `skills-browser`):
  metadata/origin-only listing of the default maestro-skills checkout, no
  mutation and no body content.
- **Web UI** in a single `conversation.view` slot (`id: maestro-memory`,
  order 40) with Memory / Review / Todos / Skills tabs, DSH-themed controls, and
  package-private RPC over `/dsh-maestro-memory`.
- **M5 Git sync** (opt-in): project-scoped `sync.enable/disable/status/fetch/
  push/pull/resolve/listConflicts`. Disabled means zero network activity; pushes
  are explicit and a conflict never silently drops either version.

### Fixed

- Hard-coded light-then-dark theme styles replaced with `--dsw-alias-*` tokens
  (the active-tab highlight uses `--dsw-alias-interactive-bg-active`, which
  flips correctly on both themes).
- Track/navigation controls made visually distinct and height-consistent so
  switching between memory tracks never reflows the toolbar.
- The memory tool's `date` parameter is now honored for the `daily` track
  (previously declared but unused) with an invalid-date guard.
- Key-track entries always carry an id even without a summary, so
  `expand(id)` targets any key entry.
- Daily memory stamps the local calendar date (matching the todos store) instead
  of UTC, so daily logs land on the same day.
- `skills.list` no longer reads an arbitrary client-supplied directory; it is
  constrained to the resolved default maestro-skills checkout.

### Removed

- All legacy `dsh-memory-evolve` features not carried into the rebrand: COI /
  broadcast, advisor, notify/`de_channel_send`, search, prompt library, model
  registry, bookmarks/mermaid/canvas, and the old `/memory-evolve` HTTP server.

### Notes

- The package is consumed as a DSH plugin via `cordis.patch.yml`
  (`id: maestro-memory`) and is installed with a `link:` dependency or the
  `github:ddtcorex/dsh-maestro-memory#<sha>` form. Live `lib/` is committed so a
  rebuild is only needed after editing `src/`.

[1.0.0]: https://github.com/ddtcorex/dsh-maestro-memory/releases/tag/v1.0.0
[1.0.1]: https://github.com/ddtcorex/dsh-maestro-memory/releases/tag/v1.0.1
