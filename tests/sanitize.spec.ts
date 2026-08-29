import { describe, it, expect } from 'vitest'
import { desensitize, sanitizeInput } from '../src/host/memory/sanitize.ts'

describe('sanitize desensitize', () => {
  it('filters sk- key', () => {
    const r = desensitize('my API key is sk-abc123def456 keep secret')
    expect(r).not.toBeNull()
    expect(r!).toContain('[Filtered:API key]')
    expect(r!).not.toContain('sk-abc')
  })
  it('filters api_key pattern', () => {
    const r = desensitize('api_key: hunter2value do not leak')
    expect(r!).toContain('[Filtered:API key]')
  })
  it('filters password', () => {
    const r = desensitize('password: hunter2 should be hidden')
    expect(r!).toContain('[Filtered:password]')
    expect(r!).not.toContain('hunter2')
  })
  it('filters Bearer token', () => {
    const r = desensitize('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')
    expect(r!).toContain('[Filtered:token]')
  })
  it('filters ID number', () => {
    const r = desensitize('my ID is 11010119900307789X check')
    expect(r!).toContain('[Filtered:ID number]')
  })
  it('filters phone', () => {
    const r = desensitize('call me 13800138000 ok')
    expect(r!).toContain('[Filtered:phone number]')
  })
  it('pure credential → null (skip)', () => {
    expect(desensitize('sk-abcdefgh12345678')).toBeNull()
  })
  it('normal content passthrough', () => {
    const t = 'user likes cats, discussed bubble sort'
    expect(desensitize(t)).toBe(t)
  })
  it('mixed: sensitive replaced but body kept', () => {
    const r = desensitize('password: 123456 and we ship next week')
    expect(r!).toContain('[Filtered:password]')
    expect(r!).toContain('ship next week')
  })
  it('sanitizeInput disabled passthrough', () => {
    const r = sanitizeInput('sk-abcdefgh12345678', false)
    expect(r.filtered).toBe(false)
    expect(r.sanitized).toBe('sk-abcdefgh12345678')
  })
  it('sanitizeInput enabled pure → filtered', () => {
    const r = sanitizeInput('sk-abcdefgh12345678', true)
    expect(r.filtered).toBe(true)
    expect(r.sanitized).toBeNull()
  })
})
