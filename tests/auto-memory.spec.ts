import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MaestroMemoryStore } from '../src/host/memory/store.ts'
import { installAutoMemoryHooks, DEFAULT_AUTO_MEMORY } from '../src/host/auto-memory.ts'

function fakeCtx() {
  const handlers = new Map<string, any>()
  return {
    on: (ev: string, fn: any) => {
      handlers.set(ev, fn)
      return () => handlers.delete(ev)
    },
    _emit: (ev: string, ...args: any[]) => {
      const fn = handlers.get(ev)
      if (fn) fn(...args)
    },
  }
}

describe('auto-memory hook', () => {
  it('disabled by default → no write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-'))
    try {
      const store = new MaestroMemoryStore(dir)
      const ctx: any = fakeCtx()
      installAutoMemoryHooks(ctx, store, { ...DEFAULT_AUTO_MEMORY, enabled: false })
      ctx._emit('session/event', { header: { cwd: '/tmp/proj' } }, { type: 'user/message', data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } })
      expect(store.list('project', '/tmp/proj')).toHaveLength(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('userMessage true writes desensitized', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-'))
    try {
      const store = new MaestroMemoryStore(dir)
      const ctx: any = fakeCtx()
      installAutoMemoryHooks(ctx, store, { ...DEFAULT_AUTO_MEMORY, enabled: true, userMessage: true, desensitize: true })
      ctx._emit('session/event', { header: { cwd: '/tmp/proj' } }, { type: 'user/message', data: { content: [{ type: 'text', text: 'my api_key: secret123 please remember' }], source: { kind: 'user' } } })
      const entries = store.list('project', '/tmp/proj')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toContain('[Filtered:API key]')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('filters non-user source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-'))
    try {
      const store = new MaestroMemoryStore(dir)
      const ctx: any = fakeCtx()
      installAutoMemoryHooks(ctx, store, { ...DEFAULT_AUTO_MEMORY, enabled: true, userMessage: true })
      ctx._emit('session/event', { header: { cwd: '/tmp/proj' } }, { type: 'user/message', data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'system' } } })
      expect(store.list('project', '/tmp/proj')).toHaveLength(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('dedupe not duplicated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-'))
    try {
      const store = new MaestroMemoryStore(dir)
      const ctx: any = fakeCtx()
      installAutoMemoryHooks(ctx, store, { ...DEFAULT_AUTO_MEMORY, enabled: true, userMessage: true })
      const ev = { type: 'user/message', data: { content: [{ type: 'text', text: 'hello world' }], source: { kind: 'user' } } }
      const sess = { header: { cwd: '/tmp/proj' } }
      ctx._emit('session/event', sess, ev)
      ctx._emit('session/event', sess, ev)
      expect(store.list('project', '/tmp/proj')).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('pure credential skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-'))
    try {
      const store = new MaestroMemoryStore(dir)
      const ctx: any = fakeCtx()
      installAutoMemoryHooks(ctx, store, { ...DEFAULT_AUTO_MEMORY, enabled: true, userMessage: true, desensitize: true })
      ctx._emit('session/event', { header: { cwd: '/tmp/proj' } }, { type: 'user/message', data: { content: [{ type: 'text', text: 'sk-abcdefgh12345678' }], source: { kind: 'user' } } })
      expect(store.list('project', '/tmp/proj')).toHaveLength(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
