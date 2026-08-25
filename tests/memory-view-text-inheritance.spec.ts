import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The Memory view must inherit DSH text styles through CSS inheritance from
// the host panel instead of stamping its own font on every element. The
// container (.dshmem) declares NO font-family / font-size / line-height of its
// own, and no component CSS re-declares them — children resolve typography
// from the DSH tree above (e.g. font-size 16px / line-height 28px /
// --dsw-alias-label-primary).
const client = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

describe('memory view inherits DSH text styles', () => {
  it('the .dshmem container sets no own typography', () => {
    const css = client.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
    expect(css).toContain('.dshmem {')
    // the container rule must not carry font-family/font-size/line-height
    const rootRule = css.match(/\.dshmem \{[^}]*\}/)?.[0] ?? ''
    expect(rootRule).not.toMatch(/font-family|font:|font-size|line-height/)
  })

  it('no scoped rule or inline style stamps a hard font size', () => {
    const css = client.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
    // badges keep their explicit sizes (fixed chrome, not flowing content)
    const badgeRules = css.match(/[^}]*\{/g) ?? []
    for (const rule of badgeRules) {
      if (/tabbadge|header-badge/.test(rule)) continue
      expect(rule).not.toMatch(/font:\s*\d+px/)
    }
    // inline fontSize literals are gone except in the fixed-size badges
    const inlineSizes = client.match(/fontSize:\s*(\d+)/g) ?? []
    expect(inlineSizes.length).toBe(0)
  })

  it('buttons and inputs inherit instead of declaring font shorthand', () => {
    const css = client.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
    expect(css).not.toMatch(/\.dshmem button \{[^}]*font:/)
    expect(css).not.toMatch(/input, \.dshmem textarea[^}]*font:/)
    expect(css).not.toMatch(/\.dshmem \.tab \{[^}]*font:/)
    expect(css).not.toMatch(/\.dshmem \.pill \{[^}]*font:/)
    expect(css).not.toMatch(/\.dshmem \.ghost \{[^}]*font:/)
    expect(css).not.toMatch(/\.dshmem \.tracklabel \{[^}]*font:/)
  })
})
