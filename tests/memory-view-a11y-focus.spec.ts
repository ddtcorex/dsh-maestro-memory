import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Accessibility fixes for the Memory view, measured live on DSH Web
// 0.2.2-alpha.2 (2026-10-28 design audit, findings F2, F10, F15).
//
// F2: the panel painted its focus ring with --dsw-alias-interactive-bg-active,
// a translucent SURFACE token. Composite contrast was 1.20:1 in light theme and
// 1.51:1 in dark, while the host's own ring (outline: auto) measures 4.25:1 and
// 7.90:1 in the same themes. The panel was therefore erasing a visible ring and
// replacing it with an invisible one.
//
// F10: the queue badge painted #fff on --dsw-alias-state-error-primary, which
// measures 3.29:1 in dark (#f25a5a) for 11px bold text (4.5:1 required).
//
// F15: the badge animation is declared in HEADER_BADGE_CSS, which lives in
// <head> for the whole session, but its prefers-reduced-motion override lived
// in MEM_CSS, which only mounts while the Memory section is active. On Chat the
// badge kept pulsing with reduce motion requested.
const client = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

const memCss = client.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
const badgeCss = client.match(/const HEADER_BADGE_CSS = `([\s\S]*?)`/)?.[1] ?? ''

/** Declarations only — comments cannot cascade, so they must not match. */
const memRules = memCss.replace(/\/\*[\s\S]*?\*\//g, '')
const badgeRules = badgeCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('memory view focus ring is visible in both themes', () => {
  it('never paints the ring with the translucent surface token', () => {
    // the ring is focus chrome: a 6-14% alpha surface token composites to
    // 1.2-1.5:1 against the panel background in both themes
    const ringRules = memRules.match(/[^{}]*:focus[^{}]*\{[^}]*\}/g) ?? []
    expect(ringRules.length).toBeGreaterThan(0)
    for (const rule of ringRules) {
      expect(rule).not.toMatch(/--dsw-alias-interactive-bg-active/)
    }
  })

  it('delegates keyboard focus to the platform ring the host itself uses', () => {
    const focused = memRules.match(/[^{}]*button:focus-visible[^{}]*\{[^}]*\}/)?.[0] ?? ''
    expect(focused).toMatch(/outline:\s*auto/)
  })

  it('keeps a visible border affordance for pointer focus on fields', () => {
    // :focus (mouse) has no platform ring, so the border has to carry the state;
    // border-l1 is 4-6% alpha and reads as no change at all
    const fieldRule = memRules.match(/[^{}]*input:focus[^{}]*\{[^}]*\}/)?.[0] ?? ''
    expect(fieldRule).toMatch(/border-color:\s*var\(--dsw-alias-label-secondary\)/)
    expect(fieldRule).not.toMatch(/box-shadow:\s*0 0 0 2px var\(--dsw-alias-interactive-bg-active\)/)
  })
})

describe('memory tab badge keeps its count readable', () => {
  it('darkens the error fill so white text clears 4.5:1 in both themes', () => {
    const rule = badgeRules.match(/\n\.dshmem-header-badge \{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toBe('')
    // white on the raw token is 3.29:1 in dark; a 22% black mix lands ~5.0:1
    expect(rule).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--dsw-alias-state-error-primary\)[^)]*\)/)
    expect(rule).toMatch(/color:\s*#fff/)
  })

  it('keeps a plain token fallback for engines without color-mix', () => {
    const rule = badgeRules.match(/\n\.dshmem-header-badge \{[^}]*\}/)?.[0] ?? ''
    const decls = rule.split(';').map((d) => d.trim())
    const bgDecls = decls.filter((d) => d.startsWith('background:'))
    expect(bgDecls.length).toBeGreaterThanOrEqual(2)
    // the fallback declaration keeps the token's own hex guard, the color-mix
    // declaration above it must resolve the bare token so the mix is theme-aware
    expect(bgDecls[0]).toMatch(/var\(--dsw-alias-state-error-primary(?:,#[0-9a-fA-F]{3,8})?\)\s*$/)
  })
})

describe('reduced motion covers the badge while it lives in the host tab strip', () => {
  it('HEADER_BADGE_CSS, which is always mounted, switches the pulse off', () => {
    const block = badgeRules.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(block).toContain('.dshmem-header-badge')
    expect(block).toMatch(/animation:\s*none\s*!important/)
  })

  it('the panel stylesheet no longer owns that override', () => {
    // the panel style only exists while the Memory section is the active view,
    // so an override parked there leaves the badge pulsing on every other tab
    const block = memRules.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\}/)?.[0] ?? ''
    expect(block).not.toContain('.dshmem-header-badge')
  })
})
