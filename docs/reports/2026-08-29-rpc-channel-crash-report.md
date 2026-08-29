# Báo cáo sự cố dsh web crash — RPC channel không hợp lệ

**Ngày:** 2026-08-29  
**Plugin:** `@ddtcorex/dsh-maestro-memory` (`packages/dsh-maestro-memory`)  
**Mức độ:** P1 — `dsh web` không khởi động được (crash loop)  
**Commit gây lỗi:** `d72b80f` `feat(memory): follow-up — gate key via suggest, recent daily, Health propose (#24)`  
**Người xử lý:** Muse Spark (fix tối thiểu)

## 1. Tóm tắt

Sau khi merge PR #24, `dsh web` rơi vào crash loop. Log `~/.dsh/dsh-web.log` ghi:

```
Error: connection: invalid or reserved RPC channel "/maestro-memory/health"
    at assertChannel (packages/client/connection/src/rpc-host.ts:281:11)
    at Proxy.register (packages/client/connection/src/rpc-host.ts:157:5)
    at Fiber.<anonymous> (packages/dsh-maestro-memory/src/host/index.ts:639:32)
```

`supervisor` (systemd `dsh-web.service` + daemon `dsh-web-supervisor`) liên tục restart nhưng plugin tree không load được nên cổng `:3080`/`:3000` lúc thì `EADDRINUSE`, lúc thì sập hẳn (`ss -tlnp` trống).

**Fix tối thiểu:** đổi 2 channel chứa `/` thành tên hợp lệ theo regex Cordis, rebuild `lib/`, `systemd` tự khôi phục `up: true (401)`.

## 2. Triệu chứng chi tiết

- `ss -tlnp | grep 3080` trống, `ps aux | grep dsh` không còn `MainThread`.
- `~/.dsh/dsh-web.log` lặp lại 2 lỗi xen kẽ:
  1. `EADDRINUSE: address already in use :::3000` tại `packages/dsh-maestro-review/src/providers/gitlab.ts:185:10` (webhook server).
  2. `EADDRINUSE: address already in use 127.0.0.1:3080` tại `packages/boot/app-boot/src/index.ts:817` (webserver).
  3. Sau khi stale `MainThread` được kill, lỗi gốc lộ ra: `invalid or reserved RPC channel "/maestro-memory/health"` và `"/maestro-memory/propose"`.
- `node deepseek-harness/apps/cli/lib/bin.js --profile web --dump-config` fail với cùng `assertChannel` trước fix, pass sau fix.
- `node packages/dsh-maestro-supervisor/lib/bin.js status` báo `up: false` trước fix, `up: true, httpCode: 401` sau fix.

## 3. Nguyên nhân gốc (Root Cause)

Cordis quy ước channel tại `packages/client/connection/src/rpc-host.ts:281`:

```ts
assertChannel(channel) // must match /^\/[A-Za-z0-9._~-]+$/
```

Chỉ cho phép **một** dấu `/` đầu dòng, các ký tự còn lại là `[A-Za-z0-9._~-]`. PR #24 thêm 2 handler mới vi phạm:

| File | Dòng | Channel sai | Lý do vi phạm |
|------|------|-------------|---------------|
| `src/host/index.ts:603` | `const healthChannel = '/maestro-memory/health'` | chứa `/` thứ 2 | regex fail |
| `src/host/index.ts:665` | `conn3.rpc.handle('/maestro-memory/propose', ...)` | chứa `/` thứ 2 + thiếu prefix `dsh-` | regex fail |
| `src/client/index.tsx:843` | `conn.rpc.call('/maestro-memory/health', ...)` | client gọi channel sai | đồng bộ với host |
| `src/client/index.tsx:888` | `conn.rpc.call('/maestro-memory/propose', ...)` | client gọi channel sai | đồng bộ với host |

Channel hợp lệ duy nhất trước đó là `src/host/index.ts:325` `'/dsh-maestro-memory'` (đúng regex). Hai channel Health/Propose copy nhầm pattern HTTP REST (`/resource/sub`) thay vì pattern Cordis flat (`/dsh-maestro-memory-health`).

Không có test nào assert tên channel, nên `pnpm verify` và `pnpm test` vẫn xanh, lỗi chỉ nổ lúc boot `dsh web` (Cordis `Fiber._reload`).

## 4. Ảnh hưởng

- Toàn bộ `dsh web` không lên được → UI, webhook `:3000` (review), memory/todo/sync đều mất.
- Supervisor ghi `~/.dsh/.supervisor/failed/2026-08-29T06-5*` và `reports/` liên tục, LKG `2026-08-29T06-4*` vẫn giữ bản trước PR.
- Không mất dữ liệu memory (`~/.dsh/memories` nguyên vẹn, atomic-store không ghi trong lúc crash).

## 5. Giải pháp (Minimal Fix)

Không đổi logic handler, chỉ đổi tên channel cho hợp regex và thống nhất prefix `dsh-`:

```diff
// src/host/index.ts:603
- const healthChannel = '/maestro-memory/health'
+ const healthChannel = '/dsh-maestro-memory-health'

// src/host/index.ts:665
- const d3 = conn3.rpc.handle('/maestro-memory/propose', wrapped, { authority: 'loopback' })
+ const d3 = conn3.rpc.handle('/dsh-maestro-memory-propose', wrapped, { authority: 'loopback' })

// src/client/index.tsx:843
- const res: any = await conn.rpc.call('/maestro-memory/health', 'get', { cwd })
+ const res: any = await conn.rpc.call('/dsh-maestro-memory-health', 'get', { cwd })

// src/client/index.tsx:888
- const res: any = await conn2.rpc.call('/maestro-memory/propose', 'add', { content: it.preview, ... })
+ const res: any = await conn2.rpc.call('/dsh-maestro-memory-propose', 'add', { content: it.preview, ... })
```

Build:

```sh
pnpm --dir packages/dsh-maestro-memory build
# tsc -p tsconfig.json && tsc -p tsconfig.client.json && node scripts/build-client.mjs
# → lib/index.js:638,711 và lib/client.js:610,639 đã cập nhật
pnpm --dir packages/dsh-maestro-memory verify # OK
```

Khôi phục runtime (không cần can thiệp thủ công, systemd/supervisor tự làm sau khi `lib/` được build):

```sh
node deepseek-harness/apps/cli/lib/bin.js --profile web --dump-config # EXIT 0
systemctl --user status dsh-web.service # active (running) MainThread pid 195968
ss -tlnp | grep 3080 # 127.0.0.1:3080 LISTEN
curl -s -w "%{http_code}" http://127.0.0.1:3080/ # 401 (healthy, cần token)
```

Trạng thái hiện tại: `dsh web: http://127.0.0.1:3080/?token=63hbkN...` đã log, `supervisor status` `up: true, httpCode: 401, error: none, latest LKG valid: true`.

## 6. File thay đổi

```
M packages/dsh-maestro-memory/src/host/index.ts
M packages/dsh-maestro-memory/src/client/index.tsx
M packages/dsh-maestro-memory/lib/index.js
M packages/dsh-maestro-memory/lib/index.js.map
M packages/dsh-maestro-memory/lib/client.js
```

Diff xem `git diff src/host/index.ts src/client/index.tsx`.

## 7. Bài học & phòng ngừa

1. **Lint channel name:** thêm test `assertChannel` cho mọi `rpc.handle`/`rpc.call` trong `dsh-maestro-memory`. Ví dụ:
   ```ts
   // tests/rpc-channel.spec.ts
   expect('/dsh-maestro-memory-health').toMatch(/^\/[A-Za-z0-9._~-]+$/)
   ```
   Hoặc grep CI: `grep -R "rpc\.(handle|call)" src/ | grep -vE "/[A-Za-z0-9._~-]+"` phải rỗng.

2. **Dry-boot bắt buộc trước merge:** `DSH_HOME=$(mktemp -d) node deepseek-harness/apps/cli/lib/bin.js --profile web --dump-config` và `DSH_HOME=$(mktemp -d) ... web --port 0` (skill `dsh-safe-web-update`) — quy định đã có trong `AGENTS.md` nhưng PR #24 bỏ qua.

3. **Không để client/host lệch channel:** định nghĩa hằng `HEALTH_CHANNEL = '/dsh-maestro-memory-health'` dùng chung host+client, tránh hardcode string rời rạc.

4. **Đặt tên channel theo convention:** `AGENTS.md` — "RPC channel names must match `/^\/[A-Za-z0-9._~-]+$/` (leading `/` mandatory) — use sibling convention `/dsh-maestro-<name>`". Với sub-resource dùng suffix `-health`, `.health` hoặc `-propose` thay vì `/health`.

5. **Supervisor đã cứu:** systemd `Restart=always` + daemon poll 3s đã tự rollback/retry, nhưng log `EADDRINUSE` che lấp lỗi gốc. Cần ưu tiên đọc `assertChannel` trước `EADDRINUSE` khi triage.

## 8. Tham chiếu

- Log: `~/.dsh/dsh-web.log` (tail 300 dòng cuối trước fix chứa `assertChannel`, sau fix chỉ `dsh web: http://127.0.0.1:3080/?token=...`)
- Supervisor: `~/.dsh/.supervisor/supervisor.log`, `~/.dsh/.supervisor/lkg/2026-08-29T06-57-10-325Z/`
- Spec liên quan: `docs/specs/2026-08-30-memory-followup-design.md` (đề xuất `/maestro-memory/health` trong spec, cần sửa spec theo channel hợp lệ), `packages/dsh-maestro-memory/docs/architecture.md` §2 (RPC `/dsh-maestro-memory`)
