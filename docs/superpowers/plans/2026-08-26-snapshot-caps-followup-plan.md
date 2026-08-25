# Snapshot caps + batch add + feedback — P1 Follow-up Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Per amendment `docs/plans/2026-08-26-actuals-amendment.md` §3 — byte-capped snapshot
sections, atomic batch `memory add`, and `[Feedback]` line support. One PR, stacked on
`feat/snapshot-discipline-trigger` (PR #9) because `src/host/prompt/snapshot.ts` lives there.

**Worktree:** `/home/kai/Work/htdocs/maestro-harness-worktrees/dsh-maestro-memory-snapshot-caps`
(branch `feat/snapshot-caps` → base `feat/snapshot-discipline-trigger`).

## Task 1 — Per-track byte caps in renderSnapshot (TDD)

- [ ] **RED** (`tests/snapshot.spec.ts` new cases):
  - memory section capped: seed 5 entries, small cap → only newest kept, oldest dropped.
  - user/key sections enforce their own caps independently.
  - newest entry is ALWAYS kept even when it alone exceeds the cap.
  - oversize newest entry containing `[summary:` renders as its ENTRY_HEAD_RE head only.
  - `opts.caps` override respected; default `SNAPSHOT_SECTION_CAPS = { memory: 2048, user: 4096, key: 6144 }`.
  - daily/project stay excluded (existing regression untouched and green).
- [ ] **GREEN:** implement in `src/host/prompt/snapshot.ts`: per-section selection walking
  entries newest→oldest accumulating UTF-8 bytes (+`\n---\n` separators), stop at cap;
  summary-head fallback for tagged oversize newest; export `SNAPSHOT_SECTION_CAPS`.
- [ ] README §System Prompt Snapshot: document caps + fallback (same commit).
- [ ] Commit `feat(prompt): per-track byte caps for snapshot sections`.

## Task 2 — Batch add through store.add atomically (TDD)

- [ ] **RED** (`tests/batch-add.spec.ts`): pure `applyBatch(store, entries)`:
  - adds all `{target:'daily'|'project'|…, content}` sequentially; returns ids[].
  - failure mid-batch (empty content / bad target) rolls back previously added ids
    (store.remove by id) and returns `{ ok:false, index, error }`.
  - empty array → `{ ok:true, ids:[] }`.
- [ ] **GREEN:** implement `applyBatch` (new `src/host/memory/batch.ts`) using existing
  `store.add` / `store.remove`; wire into the memory tool handler: accept optional
  `entries:[…]` param on action=add; single-entry path untouched.
- [ ] Commit `feat(memory): atomic batch add with rollback`.

## Task 3 — [Feedback] line on add when sentiment present (TDD)

- [ ] **RED** (`tests/batch-add.spec.ts` additions or `tests/feedback.spec.ts`):
  - pure `buildFeedbackLine({sentiment, category?, quote?, note?})`:
    `[Feedback] sentiment=positive; category="…"; quote="…"; note="…"` — omit absent fields,
    require sentiment; unknown sentiment rejected.
  - tool add with `sentiment` appends the line to stored content; without → content unchanged.
  - batch entry carrying `sentiment` gets the same treatment.
- [ ] **GREEN:** implement `buildFeedbackLine` (in batch.ts or feedback.ts); wire into both
  single-add and batch paths before calling store.add.
- [ ] Commit `feat(memory): [Feedback] line on add with sentiment`.

## Final validation

- [ ] `pnpm verify && pnpm test` green in worktree; regression
      “bounded: includes USER+MEMORY+KEY, excludes daily/project” stays green untouched.
- [ ] `pnpm build` then commit lib artifacts (repo convention commits lib/ on feature branches).
- [ ] Push branch; open PR with **base = `feat/snapshot-discipline-trigger`** (retarget to master after #9 merges).
