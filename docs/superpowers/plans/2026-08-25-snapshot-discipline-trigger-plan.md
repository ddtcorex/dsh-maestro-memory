# Snapshot Discipline Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khôi phục contract snapshot đã ghi trong README/architecture nhưng code hiện tại chưa implement — bổ sung session header + end-of-turn discipline note vào systemPrompt snapshot, đảm bảo agent được nhắc ghi memory sau mỗi turn/phiên.

**Architecture:** Tách logic render snapshot ra `src/host/prompt/snapshot.ts` (pure function, không import Cordis), giữ `MaestroMemoryStore.snapshot()` làm data layer, thêm presentation layer `renderSnapshot()` trả về header + 3 sections + discipline note. `src/host/index.ts` đổi `systemPrompt.context` để gọi `renderSnapshot()` thay vì `store.snapshot()` trực tiếp. Không thêm event listener hay timer — trigger là prompt-level instruction (đúng contract docs), không phải hook tự động ghi.

**Tech Stack:** TypeScript 5.x ESM, Vitest 3.x, Cordis 4.x (`ctx.systemPrompt.context`), `MaestroMemoryStore` (existing), Node `fs` layout helpers

**Spec:** `README.md` § System Prompt Snapshot + `docs/architecture.md` § 4.3 Snapshot row + `docs/plans/2026-08-24-dsh-maestro-memory-plan.md` § Target architecture Host units (prompt/snapshot.ts)

## Global Constraints

- Node >= 20, TypeScript ESM (`"type": "module"`), `pnpm` workspace — follow existing `tsconfig.json` / `vitest.config.ts`
- Snapshot phải bounded & deterministic: chỉ USER + global MEMORY + current-project KEY (branch-filtered), daily/project KHÔNG inject — vi phạm là bug
- Snapshot text phải port verbatim contract: session header + discipline note + dtodo reminder — thiếu là agent silent stop writing logs
- Mọi host registration qua `ctx.effect` với disposer — không leak khi plugin unload
- `link:` plugin: sau `git pull` chỉ `pnpm run build` tại checkout, không `pnpm install`, không restart `dsh web` cho host change thì báo user chọn thời điểm restart (safe-dsh-web-update)
- Conventional Commits (`feat:`, `fix:`, `chore:`) — một TDD task = một commit
- `daily` date guard: chỉ `YYYY-MM-DD`, reject path traversal (`../../etc/passwd`)

---

### Task 1: Tạo `prompt/snapshot.ts` — pure snapshot renderer với header + discipline note

**Files:**
- Create: `src/host/prompt/snapshot.ts`
- Test: `tests/snapshot.spec.ts`

**Interfaces:**
- Consumes: `MaestroMemoryStore` (methods `list(target,cwd,opts)` + `snapshot(cwd,opts)` existing) — chỉ đọc, không ghi
- Produces: `export function renderSnapshot(store: MaestroMemoryStore, ctx: { cwd: string | null; branch?: string; sessionId?: string; sessionName?: string }): string` — pure string builder, không import Cordis

- [ ] **Step 1: Viết failing test cho renderSnapshot — header + discipline + bounded sections**

```typescript
// tests/snapshot.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { renderSnapshot } from '../src/host/prompt/snapshot.ts'

let root: string
let store: MaestroMemoryStore
const cwd = '/tmp/demo-project'

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'snap-')); store = new MaestroMemoryStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('renderSnapshot contract', () => {
  it('includes session header when sessionId/name provided', () => {
    store.add('memory', '[2026-08-10] global entry')
    const text = renderSnapshot(store, { cwd, sessionId: 'abc123', sessionName: 'my-session' })
    expect(text).toContain('abc123')
    expect(text).toContain('my-session')
  })

  it('includes end-of-turn discipline note (daily+project + dtodo)', () => {
    const text = renderSnapshot(store, { cwd: '/tmp/x', sessionId: 's1' })
    expect(text).toMatch(/End of every turn/i)
    expect(text).toMatch(/daily.*project/i)
    expect(text).toMatch(/dtodo list/i)
  })

  it('bounded: includes USER+MEMORY+KEY, excludes daily/project', () => {
    store.add('memory', '[2026-08-10] global')
    store.add('user', '[2026-08-10] user')
    store.add('key', '[2026-08-10] key entry', cwd)
    store.add('daily', '[08:30] daily log')
    store.add('project', '[2026-08-10 10:00] project log', cwd)
    const text = renderSnapshot(store, { cwd })
    expect(text).toContain('global')
    expect(text).toContain('user')
    expect(text).toContain('key entry')
    expect(text).not.toContain('daily log')
    expect(text).not.toContain('project log')
  })

  it('branch-filtered: only matching key entries appear', () => {
    store.add('key', '[2026-08-10] all branches', cwd)
    store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
    const mainSnap = renderSnapshot(store, { cwd, branch: 'main' })
    expect(mainSnap).toContain('main only')
    const devSnap = renderSnapshot(store, { cwd, branch: 'dev' })
    expect(devSnap).not.toContain('main only')
    expect(devSnap).toContain('all branches')
  })

  it('handles null cwd gracefully — no key section, no crash', () => {
    store.add('memory', '[2026-08-10] global')
    const text = renderSnapshot(store, { cwd: null })
    expect(text).toContain('global')
    expect(text).not.toContain('Project Key')
  })
})
```

- [ ] **Step 2: Chạy test — phải FAIL vì file chưa tồn tại**

Run: `pnpm test tests/snapshot.spec.ts -v`
Expected: FAIL — `Failed to resolve import "../src/host/prompt/snapshot.ts"` hoặc `renderSnapshot is not defined`

- [ ] **Step 3: Implement minimal `src/host/prompt/snapshot.ts`**

```typescript
// src/host/prompt/snapshot.ts
import type { MaestroMemoryStore } from '../memory/store.ts'

export interface SnapshotContext {
  cwd: string | null
  branch?: string
  sessionId?: string
  sessionName?: string
}

/**
 * Bounded snapshot renderer — contract từ README § System Prompt Snapshot:
 * Header (sessionId/sessionName) + USER + global MEMORY + current-project KEY
 * (branch-filtered) + end-of-turn discipline note.
 * daily và project KHÔNG inject.
 */
export function renderSnapshot(
  store: MaestroMemoryStore,
  ctx: SnapshotContext,
): string {
  const parts: string[] = []

  // Header
  if (ctx.sessionId || ctx.sessionName) {
    const header = [
      ctx.sessionId ? `sessionId: ${ctx.sessionId}` : null,
      ctx.sessionName ? `sessionName: ${ctx.sessionName}` : null,
    ].filter(Boolean).join(' | ')
    if (header) parts.push(`# Session\n${header}`)
  }

  // Bounded memory sections — delegate branch filtering to store.list
  const mem = store.list('memory')
  const user = store.list('user')
  const key = ctx.cwd ? store.list('key', ctx.cwd, ctx.branch ? { branch: ctx.branch } : {}) : []

  if (mem.length) parts.push(`# Global Memory\n${mem.join('\n---\n')}`)
  if (user.length) parts.push(`# User Memory\n${user.join('\n---\n')}`)
  if (key.length) parts.push(`# Project Key Memory\n${key.join('\n---\n')}`)

  // End-of-turn discipline note — verbatim contract
  parts.push(
    `---\nEnd of every turn you must: 1. Write daily+project via memory entries (daily+project in one call) 2. Check dtodo list (bounded, max 8)`,
  )

  return parts.join('\n\n')
}
```

- [ ] **Step 4: Chạy lại test — phải PASS**

Run: `pnpm test tests/snapshot.spec.ts -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/host/prompt/snapshot.ts tests/snapshot.spec.ts
git commit -m "feat(prompt): add bounded snapshot renderer with header and discipline note"
```

---

### Task 2: Wire `renderSnapshot` vào `src/host/index.ts` — thay thế inline `store.snapshot()` trong systemPrompt context

**Files:**
- Modify: `src/host/index.ts` (import `renderSnapshot`, đổi `systemPrompt.context` text callback)
- Test: `tests/snapshot.spec.ts` (thêm integration test cho context injection) + `tests/smoke.spec.ts` (đảm bảo tool registration không vỡ)

**Interfaces:**
- Consumes: `renderSnapshot` từ Task 1
- Produces: `ctx.systemPrompt.context` vẫn order 500, nhưng text giờ bao gồm header + discipline

- [ ] **Step 1: Viết failing test cho integration — context text phải chứa discipline note**

```typescript
// Thêm vào tests/snapshot.spec.ts
import { renderSnapshot } from '../src/host/prompt/snapshot.ts'

it('integration: systemPrompt context text delegates to renderSnapshot', async () => {
  // Đọc source index.ts để verify nó import renderSnapshot
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8')
  expect(src).toContain('renderSnapshot')
  expect(src).toContain("name: 'memory:snapshot'")
  expect(src).toContain('order')
})
```

- [ ] **Step 2: Chạy test — FAIL vì index.ts chưa import renderSnapshot**

Run: `pnpm test tests/snapshot.spec.ts -v`
Expected: FAIL — assertion `src to contain renderSnapshot` fails

- [ ] **Step 3: Sửa `src/host/index.ts`**

Thay block `ctx.systemPrompt.context` hiện tại:

```typescript
// TRƯỚC (dòng ~49-62):
text: (promptCtx: any) => {
  const cwd: string | null = promptCtx?.agent?.session?.header?.cwd ?? null
  const branch: string | undefined = promptCtx?.agent?.session?.header?.branch ?? undefined
  return store.snapshot(cwd, branch ? { branch } : {})
},
```

Thành:

```typescript
import { renderSnapshot } from './prompt/snapshot.ts'

// TRONG apply():
text: (promptCtx: any) => {
  const cwd: string | null = promptCtx?.agent?.session?.header?.cwd ?? null
  const branch: string | undefined = promptCtx?.agent?.session?.header?.branch ?? undefined
  const sessionId: string | undefined = promptCtx?.agent?.session?.header?.sessionId
    ?? promptCtx?.agent?.session?.id
    ?? undefined
  const sessionName: string | undefined = promptCtx?.agent?.session?.header?.sessionName
    ?? promptCtx?.agent?.session?.name
    ?? undefined
  return renderSnapshot(store, { cwd, branch, sessionId, sessionName })
},
```

Giữ `order` nguyên 500, giữ `ctx.effect` disposer pattern.

- [ ] **Step 4: Chạy test — PASS**

Run: `pnpm test tests/snapshot.spec.ts tests/smoke.spec.ts -v`
Expected: PASS

- [ ] **Step 5: Build & verify**

Run: `pnpm run build && pnpm test -v`
Expected: build OK, tất cả tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/host/index.ts tests/snapshot.spec.ts
git commit -m "feat(host): wire snapshot renderer into systemPrompt context with session header"
```

---

### Task 3: Edge cases & contract hardening — empty memory, oversized discipline, branch undefined

**Files:**
- Modify: `src/host/prompt/snapshot.ts` (handle empty store, tránh duplicate discipline khi test double-call)
- Test: `tests/snapshot.spec.ts` (thêm edge cases)
- Test: `tests/memory-m2.spec.ts` (đảm bảo snapshot cũ vẫn pass — regression guard)

**Interfaces:**
- Consumes: `renderSnapshot` (Task 1-2)
- Produces: identical signature, hardened behavior

- [ ] **Step 1: Viết failing edge-case tests**

```typescript
it('empty store still emits discipline note (never empty prompt)', () => {
  const text = renderSnapshot(store, { cwd: null })
  expect(text).toMatch(/End of every turn/i)
})

it('does not duplicate discipline note on repeated calls', () => {
  const a = renderSnapshot(store, { cwd })
  const b = renderSnapshot(store, { cwd })
  expect((a.match(/End of every turn/g) || []).length).toBe(1)
  expect((b.match(/End of every turn/g) || []).length).toBe(1)
})

it('branch undefined does not filter out any key entries', () => {
  store.add('key', '[2026-08-10] all', cwd)
  store.add('key', '[2026-08-10] main only', cwd, { branches: 'main' })
  const text = renderSnapshot(store, { cwd }) // no branch
  expect(text).toContain('all')
  expect(text).toContain('main only') // no filter => all visible
})
```

- [ ] **Step 2: Chạy — FAIL nếu chưa handle empty**

Run: `pnpm test tests/snapshot.spec.ts -v`
Expected: có thể đã PASS (vì discipline luôn push), nhưng test `branch undefined` sẽ kiểm tra behavior — nếu FAIL thì sửa filter logic

- [ ] **Step 3: Harden nếu cần — đảm bảo discipline luôn cuối cùng và chỉ một lần**

Không cần đổi nhiều; chỉ confirm `parts.push(discipline)` không bị lặp. Nếu test nào fail, sửa `renderSnapshot` để discipline luôn là phần tử cuối.

- [ ] **Step 4: Regression — chạy toàn bộ memory tests**

Run: `pnpm test tests/memory-m2.spec.ts tests/snapshot.spec.ts -v`
Expected: PASS — đặc biệt `M2 keep project/daily logs out of snapshot` vẫn pass (vì logic loại daily/project nằm trong renderSnapshot)

- [ ] **Step 5: Commit**

```bash
git add src/host/prompt/snapshot.ts tests/snapshot.spec.ts
git commit -m "fix(prompt): harden snapshot edge cases and keep bounded contract"
```

---

### Task 4: Tài liệu & verification checklist — đóng vòng lặp

**Files:**
- Modify: `README.md` (§ System Prompt Snapshot — cập nhật mô tả để khớp code, hoặc giữ nguyên nếu đã đúng)
- Create: không cần file mới — chỉ verification steps trong plan

**Interfaces:**
- Consumes: Tasks 1-3
- Produces: release-ready state

- [ ] **Step 1: Đối chiếu README contract với code — sửa nếu lệch**

Kiểm tra `README.md` dòng ~174-180: nếu mô tả discipline note chưa khớp verbatim với string trong `snapshot.ts`, chỉnh README để hai nơi đồng nhất. Nếu đã khớp thì skip.

- [ ] **Step 2: Build + full test suite**

Run: `pnpm run build && pnpm test -v`
Expected: PASS toàn bộ, `lib/prompt/snapshot.js` được sinh ra

- [ ] **Step 3: Manual verification trên DSH Web (không restart nếu chưa cần)**

1. Build client nếu có đổi client: `pnpm run build:client` (task này không đổi client — skip)
2. Kiểm tra snapshot thực tế: mở session mới, prompt rỗng, inspect system prompt — phải thấy header + discipline note
3. Nếu host change cần reload: load skill `safe-dsh-web-update` trước khi restart `dsh web` (detached script, user consent)

- [ ] **Step 4: Commit (nếu có README change)**

```bash
git add README.md
git commit -m "docs: align snapshot contract description with implementation"
```

---

## Self-Review

**1. Spec coverage:**
- README contract "header + discipline note" → Task 1+2
- Bounded USER+MEMORY+KEY, loại daily/project → Task 1 (test bounded) + Task 3 (regression)
- Branch filter → Task 1 + 3
- `prompt/snapshot.ts` như `docs/plans/2026-08-24` đã dự kiến → Task 1
- Wire qua `systemPrompt.context` order 500 → Task 2
- Không thêm auto-write trigger ngoài prompt — đúng scope (trigger = prompt instruction, không phải event hook)

**2. Placeholder scan:** Không có TBD/TODO — mọi step có code cụ thể, lệnh chạy cụ thể, expected output cụ thể.

**3. Type consistency:** `renderSnapshot(store: MaestroMemoryStore, ctx: SnapshotContext)` dùng trong cả Task 1 và 2 với cùng signature; `SnapshotContext` có `cwd`, `branch?`, `sessionId?`, `sessionName?` đồng nhất.

**Gap cố ý để lại cho follow-up (không thuộc plan này):**
- Event-driven trigger thực sự (ví dụ `ctx.on('agent/turn-stopping', ...)` tự động nhắc model ghi memory) — cần design riêng vì liên quan agent loop và có thể gây spam. Plan này chỉ khôi phục prompt-level discipline note như docs đã cam kết.

---

## Execution Handoff

Plan complete and saved to `dsh-maestro-memory/docs/superpowers/plans/2026-08-25-snapshot-discipline-trigger-plan.md` (và copy tại `docs/plans/2026-08-25-snapshot-discipline-trigger-plan.md`).

**Two execution options:**

**1. Subagent-Driven (recommended)** - dispatch fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - execute tasks in this session using executing-plans, batch với checkpoints

Which approach?
