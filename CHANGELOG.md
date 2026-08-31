# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
