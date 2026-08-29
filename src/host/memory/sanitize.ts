/**
 * memory/sanitize.ts — desensitize sensitive fragments before persistence.
 * Ported from FuRongJun-1999/dsh-memory src/hooks.ts desensitize().
 * English labels, same 7 patterns, same residue→null semantics.
 */

export const SENSITIVE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[A-Za-z0-9_-]{8,}/g, label: 'API key' },
  { re: /\b(?:api[_-]?key|apikey|access[_-]?token)\b\s*[:=]\s*[^\s,，。;；]+/gi, label: 'API key' },
  { re: /\b(?:password|passwd|pwd)\b\s*[:=]\s*[^\s,，。;；]+/gi, label: 'password' },
  { re: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, label: 'token' },
  // Chinese password: value must be credential-like (non-CJK run) to avoid false positives on "password is important"
  { re: /密码\s*[:：是]\s*[A-Za-z0-9_@#$%^&*!.-]{4,}/g, label: 'password' },
  { re: /\b\d{17}[\dXx]\b/g, label: 'ID number' },
  { re: /\b1[3-9]\d{9}\b/g, label: 'phone number' },
]

/**
 * Replace sensitive fragments with [Filtered:<label>].
 * Returns null when the residue after stripping placeholders is empty
 * (pure-credential message should be skipped, not persisted).
 */
export function desensitize(text: string): string | null {
  let out = text
  for (const { re, label } of SENSITIVE_PATTERNS) {
    out = out.replace(re, `[Filtered:${label}]`)
  }
  const residue = out.replace(/\[Filtered:[^\]]+\]/g, '').trim()
  if (!residue) return null
  return out
}

/**
 * Convenience wrapper for store integration: sanitize or return original
 * when disabled. Returns { filtered, sanitized } where filtered indicates
 * the input was pure-sensitive and should be rejected.
 */
export function sanitizeInput(text: string, enabled: boolean): { filtered: boolean; sanitized: string | null } {
  if (!enabled) return { filtered: false, sanitized: text }
  const r = desensitize(text)
  if (r === null) return { filtered: true, sanitized: null }
  return { filtered: false, sanitized: r }
}
